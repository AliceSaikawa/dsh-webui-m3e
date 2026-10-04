import type { SessionListState, SessionSummary, WorkspaceSnapshot } from '../../dsh/services.ts'
import { selectRecentSessions } from './search-utils.ts'
import { MAIN_VIEW_SOURCE } from '../../dsh/conversation-selection.ts'

type SearchSessionList = Pick<SessionListState, 'ids' | 'byId' | 'phase'>
type SearchWorkspaceList = Pick<WorkspaceSnapshot, 'archivedSessionIds'>

function sessionVisible(
  row: SessionSummary,
  archived: ReadonlySet<string>,
  showSubagents: boolean,
): boolean {
  return (showSubagents || row.origin !== 'subagent') && !archived.has(row.id) && (!row.blank || (row.retainedBy[MAIN_VIEW_SOURCE] ?? 0) > 0)
}

/**
 * Missing metadata is withheld in both phases. Callers retain the raw search
 * results, so a pending row can appear when the list supplies its metadata;
 * a removed row is never rendered from a previously cached search response.
 */
export function filterVisibleSearchItems<T extends { sessionId: string }>(
  items: readonly T[],
  list: SearchSessionList,
  workspaces: SearchWorkspaceList,
  showSubagents = false,
): T[] {
  const currentIds = new Set(list.ids)
  const archived = new Set(workspaces.archivedSessionIds)
  return items.filter(item => {
    const row = list.byId[item.sessionId]
    // Search excludes even the selected provisional blank row, like DSH's UI.
    return currentIds.has(item.sessionId) && row !== undefined && !row.blank
      && sessionVisible(row, archived, showSubagents)
  })
}

/** Filter before limiting so hidden rows never consume a recent-session slot. */
export function selectVisibleRecentSessions(
  list: SearchSessionList,
  workspaces: SearchWorkspaceList,
  limit = 5,
  showSubagents = false,
): SessionSummary[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const visible = list.ids.flatMap(id => {
    const row = list.byId[id]
    return row !== undefined && sessionVisible(row, archived, showSubagents) ? [row] : []
  })
  return selectRecentSessions(visible, limit)
}
