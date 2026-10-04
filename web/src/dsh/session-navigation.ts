import type { ISessions, SessionListState, SessionTarget, SubagentAddress } from './services.ts'
import { RemoteCallError } from './remote-result.ts'
import { conversationSelection } from './conversation-selection.ts'

const refreshes = new WeakMap<ISessions['list'], Map<string, Promise<void>>>()
function refresh(sessions: Pick<ISessions, 'list' | 'refreshProjections'>, id: string): Promise<void> {
  let pending = refreshes.get(sessions.list)
  if (!pending) { pending = new Map(); refreshes.set(sessions.list, pending) }
  const existing = pending.get(id)
  if (existing) return existing
  const request = sessions.refreshProjections(id).finally(() => pending.delete(id))
  pending.set(id, request)
  return request
}

export function subagentCatalogAddress(list: SessionListState, parentSessionId: string, childSessionId: string): SubagentAddress | undefined {
  const projection = list.projectionsBySession[parentSessionId]
  if (!projection || projection.state === 'error' || projection.state === 'loading') return undefined
  const entry = projection.values.subagentCatalog?.find(value => value.id === childSessionId)
  if (entry?.mode !== 'one-shot' && entry?.mode !== 'continuable') return undefined
  return { parentSessionId, childSessionId, mode: entry.mode }
}

/** Resolve without owning anything. A closed picker never reaches retain. */
export async function resolveConversationTarget(sessions: Pick<ISessions, 'list' | 'subagentAddress' | 'refreshProjections'>, sessionId: string, isActive: () => boolean = () => true): Promise<SessionTarget | undefined> {
  if (!isActive()) return undefined
  const list = sessions.list.getSnapshot()
  const row = list.byId[sessionId]
  const retained = sessions.subagentAddress(sessionId)
  if (row?.origin !== 'subagent' && retained === undefined) {
    if (!row) throw new Error('会話が見つかりません。')
    return sessionId
  }
  const parentSessionId = row?.parentId ?? retained?.parentSessionId
  if (!parentSessionId) throw new Error('親の会話が見つかりません。')
  let address = subagentCatalogAddress(list, parentSessionId, sessionId)
  if (!address) {
    try { await refresh(sessions, parentSessionId) } catch (error) { if (!isActive()) return undefined; throw error }
    if (!isActive()) return undefined
    const latest = sessions.list.getSnapshot()
    const failure = latest.projectionsBySession[parentSessionId]?.error
    if (failure) throw new RemoteCallError(failure)
    const current = latest.byId[sessionId]
    if (row && (!current || current.origin !== row.origin || current.parentId !== row.parentId)) throw new Error('子の会話の情報が変わりました。もう一度お試しください。')
    address = subagentCatalogAddress(latest, parentSessionId, sessionId)
  }
  if (!address) throw new Error('子の会話の情報を読み込めませんでした。')
  return isActive() ? address : undefined
}

export async function openConversationSession(sessions: ISessions, sessionId: string, isActive: () => boolean = () => true): Promise<boolean> {
  const target = await resolveConversationTarget(sessions, sessionId, isActive)
  if (target === undefined || !isActive()) return false
  return conversationSelection(sessions).select(target)
}
