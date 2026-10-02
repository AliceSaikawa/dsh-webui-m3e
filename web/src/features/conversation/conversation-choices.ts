import type { SessionListState, SessionSummary, WorkspaceSnapshot } from '../../dsh/services.ts'

export const CONVERSATION_CHOICE_LIMIT = 50
export interface ConversationChoice { row: SessionSummary; workspaceTitle: string }

function routeableId(id: string): boolean {
  if (!id) return false
  try { encodeURIComponent(id); return true } catch { return false }
}

/** Read the existing catalog only: no new scope, feed, or search RPC per row. */
export function conversationChoices(
  list: Pick<SessionListState, 'ids' | 'byId'>,
  workspaces: Pick<WorkspaceSnapshot, 'items' | 'archivedSessionIds'>,
  currentId: string,
  query: string,
): { items: ConversationChoice[]; total: number } {
  const membership = new Map<string, { workspaceId: string; title: string }>()
  for (const workspace of workspaces.items) for (const id of workspace.sessionIds) {
    if (!membership.has(id)) membership.set(id, workspace)
  }
  const archived = new Set(workspaces.archivedSessionIds)
  const currentWorkspace = membership.get(currentId) ?? membership.get(list.byId[currentId]?.parentId ?? '')
  const search = query.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  const groups: ConversationChoice[][] = [[], [], []]
  for (const id of list.ids) {
    if (seen.has(id) || !Object.hasOwn(list.byId, id)) continue
    seen.add(id)
    const row = list.byId[id]
    if (!row || row.id !== id || !routeableId(id) || archived.has(id) || (row.blank && id !== currentId)) continue
    if (search && !row.displayTitle.toLocaleLowerCase().includes(search)) continue
    const workspace = membership.get(id) ?? membership.get(row.parentId ?? '')
    const group = id === currentId ? 0 : currentWorkspace && workspace?.workspaceId === currentWorkspace.workspaceId ? 1 : 2
    groups[group]!.push({ row, workspaceTitle: workspace?.title ?? 'ワークスペース未登録' })
  }
  const all = groups.flat()
  return { items: all.slice(0, CONVERSATION_CHOICE_LIMIT), total: all.length }
}

/** A delayed child catalog must not select a removed, archived, or changed row. */
export function conversationChoiceAvailable(
  row: SessionSummary,
  list: Pick<SessionListState, 'ids' | 'byId'>,
  archived: readonly string[],
): boolean {
  const current = Object.hasOwn(list.byId, row.id) ? list.byId[row.id] : undefined
  return routeableId(row.id) && list.ids.includes(row.id) && !!current && current.id === row.id && !archived.includes(row.id) && !current.blank
    && current.origin === row.origin && current.parentId === row.parentId
}
