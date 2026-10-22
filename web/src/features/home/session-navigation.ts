import type { ISessions, SessionListState, SessionSummary, SubagentAddress } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'
import { subagentCatalogAddress } from '../../dsh/session-navigation.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import { homeMessages } from './messages.ts'

/** The error texts this feature throws. Tests and callers may pass them explicitly. */
export type HomeNavigationMessages = Pick<Translation<typeof homeMessages.ja>, 'parentMissing' | 'childUnavailable'>

function navigationText(text?: HomeNavigationMessages): HomeNavigationMessages {
  return text ?? messagesOf(homeMessages, currentLocale())
}

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
  text?: HomeNavigationMessages,
): Promise<void> {
  if (row.origin === 'subagent') {
    if (!row.parentId) throw new Error(navigationText(text).parentMissing)
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
    if (!address) throw new Error(navigationText(text).childUnavailable)
    if (!isActive()) return
    await conversationSelection(sessions).prepare(address, isActive, () => navigate(`/s/${encodeURIComponent(row.id)}`), signal)
    return
  }
  if (isActive()) navigate(`/s/${encodeURIComponent(row.id)}`)
}
