import type { ISessions, SessionListState, SessionSummary, SubagentAddress } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'

export function canEditHomeSession(row: SessionSummary | undefined): boolean {
  return !!row && row.origin !== 'subagent'
}

function catalogAddress(list: SessionListState, row: SessionSummary): SubagentAddress | undefined {
  if (!row.parentId) return undefined
  const catalog = list.subagentsByParent[row.parentId]
  if (catalog?.state !== 'ready' || !Array.isArray(catalog.entries)) return undefined
  const entry: unknown = catalog.entries.find((value: unknown) => typeof value === 'object' && value !== null && 'id' in value && value.id === row.id)
  if (typeof entry !== 'object' || entry === null || !('kind' in entry) || entry.kind !== 'child' || !('mode' in entry)
    || (entry.mode !== 'one-shot' && entry.mode !== 'continuable')) return undefined
  return { parentSessionId: row.parentId, childSessionId: row.id, mode: entry.mode }
}

/** Selecting the address before routing preserves the read-only child context. */
export async function openHomeSession(
  sessions: Pick<ISessions, 'list' | 'refreshSubagents' | 'openSubagent'>,
  row: SessionSummary,
  navigate: (path: string) => void,
  isActive: () => boolean = () => true,
): Promise<void> {
  if (row.origin === 'subagent') {
    if (!row.parentId) throw new Error('親の会話が見つかりません。')
    let address = catalogAddress(sessions.list.getSnapshot(), row)
    if (!address) {
      // A remembered address alone is insufficient: the controller validates its catalog.
      await sessions.refreshSubagents(row.parentId)
      if (!isActive()) return
      const list = sessions.list.getSnapshot()
      const failure = list.subagentsByParent[row.parentId]?.error
      if (failure) throw new RemoteCallError(failure)
      address = catalogAddress(list, row)
    }
    if (!address) throw new Error('子の会話の情報を読み込めませんでした。')
    if (!isActive()) return
    sessions.openSubagent(address)
  }
  if (isActive()) navigate(`/s/${encodeURIComponent(row.id)}`)
}
