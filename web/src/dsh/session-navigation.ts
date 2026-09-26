import type { ISessions, SessionListState, SubagentAddress } from './services.ts'
import { RemoteCallError } from './remote-result.ts'

type NavigationSessions = Pick<ISessions, 'list' | 'open' | 'openSubagent' | 'subagentAddress' | 'refreshSubagents'>
const catalogRefreshes = new WeakMap<NavigationSessions, Map<string, Promise<void>>>()

function catalogAddress(list: SessionListState, parentSessionId: string, childSessionId: string): SubagentAddress | undefined {
  const catalog = list.subagentsByParent[parentSessionId]
  if (catalog?.state !== 'ready' || !Array.isArray(catalog.entries)) return undefined
  const entry: unknown = catalog.entries.find((value: unknown) => typeof value === 'object' && value !== null && 'id' in value && value.id === childSessionId)
  if (typeof entry !== 'object' || entry === null || !('kind' in entry) || entry.kind !== 'child' || !('mode' in entry)
    || (entry.mode !== 'one-shot' && entry.mode !== 'continuable')) return undefined
  return { parentSessionId, childSessionId, mode: entry.mode }
}

function refreshCatalog(sessions: NavigationSessions, parentSessionId: string): Promise<void> {
  let refreshes = catalogRefreshes.get(sessions)
  if (!refreshes) { refreshes = new Map(); catalogRefreshes.set(sessions, refreshes) }
  const existing = refreshes.get(parentSessionId)
  if (existing) return existing
  const pending = sessions.refreshSubagents(parentSessionId).finally(() => { refreshes.delete(parentSessionId) })
  refreshes.set(parentSessionId, pending)
  return pending
}

function isSelected(list: SessionListState, address: SubagentAddress): boolean {
  return list.current === address.childSessionId
    && list.currentAddress?.childSessionId === address.childSessionId
    && list.currentAddress.parentSessionId === address.parentSessionId
    && list.currentAddress.mode === address.mode
}

/** Resolve a child's catalog before selecting it. False means the caller left. */
export async function openConversationSession(
  sessions: NavigationSessions,
  sessionId: string,
  isActive: () => boolean = () => true,
): Promise<boolean> {
  if (!isActive()) return false
  const list = sessions.list.getSnapshot()
  const row = list.byId[sessionId]
  const retained = sessions.subagentAddress(sessionId)
  if (row?.origin !== 'subagent' && retained === undefined) {
    if (!row) throw new Error('会話が見つかりません。')
    if (list.current !== sessionId) sessions.open(sessionId)
    return true
  }
  const parentSessionId = row?.parentId ?? retained?.parentSessionId
  if (!parentSessionId) throw new Error('親の会話が見つかりません。')
  let address = catalogAddress(list, parentSessionId, sessionId)
  if (!address) {
    try { await refreshCatalog(sessions, parentSessionId) }
    catch (error) { if (!isActive()) return false; throw error }
    if (!isActive()) return false
    const latest = sessions.list.getSnapshot()
    const failure = latest.subagentsByParent[parentSessionId]?.error
    if (failure) throw new RemoteCallError(failure)
    if (latest.byId[sessionId]?.parentId !== undefined && latest.byId[sessionId]?.parentId !== parentSessionId) {
      throw new Error('親の会話の情報が変わりました。もう一度お試しください。')
    }
    address = catalogAddress(latest, parentSessionId, sessionId)
  }
  if (!address) throw new Error('子の会話の情報を読み込めませんでした。')
  if (!isActive()) return false
  if (!isSelected(sessions.list.getSnapshot(), address)) sessions.openSubagent(address)
  return true
}
