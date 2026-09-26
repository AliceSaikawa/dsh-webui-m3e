import type { ISessions, SessionListState, SessionSummary, SubagentAddress } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'

function catalogAddress(list: SessionListState, row: SessionSummary): SubagentAddress | undefined {
  if (!row.parentId) return undefined
  const catalog = list.subagentsByParent[row.parentId]
  if (catalog?.state !== 'ready' || !Array.isArray(catalog.entries)) return undefined
  const entry: unknown = catalog.entries.find((value: unknown) => typeof value === 'object' && value !== null && 'id' in value && value.id === row.id)
  if (typeof entry !== 'object' || entry === null || !('kind' in entry) || entry.kind !== 'child' || !('mode' in entry)
    || (entry.mode !== 'one-shot' && entry.mode !== 'continuable')) return undefined
  return { parentSessionId: row.parentId, childSessionId: row.id, mode: entry.mode }
}

/** Follow home/session-navigation's selection order until foundation exposes a shared entry. */
export async function openInboxSession(
  sessions: Pick<ISessions, 'list' | 'refreshSubagents' | 'openSubagent'>,
  sessionId: string,
  navigate: (path: string) => void,
  isActive: () => boolean = () => true,
): Promise<void> {
  if (!isActive()) return
  const row = sessions.list.getSnapshot().byId[sessionId]
  if (!row) throw new Error('会話が見つかりません。')
  if (row.origin === 'subagent') {
    if (!row.parentId) throw new Error('親の会話が見つかりません。')
    let address = catalogAddress(sessions.list.getSnapshot(), row)
    if (!address) {
      // The controller validates the parent's catalog, not just a remembered address.
      await sessions.refreshSubagents(row.parentId)
      if (!isActive()) return
      const list = sessions.list.getSnapshot()
      const failure = list.subagentsByParent[row.parentId]?.error
      if (failure) throw new RemoteCallError(failure)
      const current = list.byId[sessionId]
      if (!current || current.origin !== 'subagent' || current.parentId !== row.parentId) {
        throw new Error('子の会話の情報が変わりました。もう一度お試しください。')
      }
      address = catalogAddress(list, current)
    }
    if (!address) throw new Error('子の会話の情報を読み込めませんでした。')
    if (!isActive()) return
    sessions.openSubagent(address)
  }
  if (isActive()) navigate(`/s/${encodeURIComponent(sessionId)}`)
}
