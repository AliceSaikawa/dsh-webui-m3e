import type { ISessions, SessionListState, SessionSummary, SubagentAddress } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'
import { subagentCatalogAddress } from '../../dsh/session-navigation.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'

export function canEditHomeSession(row: SessionSummary | undefined): boolean {
  return !!row && row.origin !== 'subagent'
}

function catalogAddress(list: SessionListState, row: SessionSummary): SubagentAddress | undefined {
  return row.parentId ? subagentCatalogAddress(list, row.parentId, row.id) : undefined
}

/** Selecting the address before routing preserves the read-only child context. */
export async function openHomeSession(
  sessions: ISessions,
  row: SessionSummary,
  navigate: (path: string) => void,
  isActive: () => boolean = () => true,
  signal?: AbortSignal,
): Promise<void> {
  if (row.origin === 'subagent') {
    if (!row.parentId) throw new Error('親の会話が見つかりません。')
    let address = catalogAddress(sessions.list.getSnapshot(), row)
    if (!address) {
      // A remembered address alone is insufficient: the controller validates its catalog.
      await sessions.refreshProjections(row.parentId)
      if (!isActive()) return
      const list = sessions.list.getSnapshot()
      const failure = list.projectionsBySession[row.parentId]?.error
      if (failure) throw new RemoteCallError(failure)
      address = catalogAddress(list, row)
    }
    if (!address) throw new Error('子の会話の情報を読み込めませんでした。')
    if (!isActive()) return
    await conversationSelection(sessions).prepare(address, isActive, () => navigate(`/s/${encodeURIComponent(row.id)}`), signal)
    return
  }
  if (isActive()) navigate(`/s/${encodeURIComponent(row.id)}`)
}
