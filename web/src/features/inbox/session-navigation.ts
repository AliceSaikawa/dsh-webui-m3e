import type { ISessions, SessionListState, SessionSummary, SubagentAddress } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'
import { subagentCatalogAddress } from '../../dsh/session-navigation.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { inboxMessages } from './messages.ts'

type InboxMessages = Translation<typeof inboxMessages.ja>

function catalogAddress(list: SessionListState, row: SessionSummary): SubagentAddress | undefined {
  return row.parentId ? subagentCatalogAddress(list, row.parentId, row.id) : undefined
}

/** Follow home/session-navigation's selection order until foundation exposes a shared entry. */
export async function openInboxSession(
  sessions: ISessions,
  sessionId: string,
  navigate: (path: string) => void,
  isActive: () => boolean = () => true,
  signal?: AbortSignal,
  text: InboxMessages = messagesOf(inboxMessages, 'ja'),
): Promise<void> {
  if (!isActive()) return
  const row = sessions.list.getSnapshot().byId[sessionId]
  if (!row) throw new Error(text.sessionMissing)
  if (row.origin === 'subagent') {
    if (!row.parentId) throw new Error(text.parentMissing)
    let address = catalogAddress(sessions.list.getSnapshot(), row)
    if (!address) {
      // The controller validates the parent's catalog, not just a remembered address.
      await sessions.refreshProjections(row.parentId)
      if (!isActive()) return
      const list = sessions.list.getSnapshot()
      const failure = list.projectionsBySession[row.parentId]?.error
      if (failure) throw new RemoteCallError(failure)
      const current = list.byId[sessionId]
      if (!current || current.origin !== 'subagent' || current.parentId !== row.parentId) {
        throw new Error(text.childChanged)
      }
      address = catalogAddress(list, current)
    }
    if (!address) throw new Error(text.childUnavailable)
    if (!isActive()) return
    await conversationSelection(sessions).prepare(address, isActive, () => navigate(`/s/${encodeURIComponent(sessionId)}`), signal)
    return
  }
  if (isActive()) navigate(`/s/${encodeURIComponent(sessionId)}`)
}
