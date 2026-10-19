import { isPlanReview, type PendingInteraction } from '../../dsh/interactions-store.ts'
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from '../../dsh/services.ts'
import { sessionRowIds } from '../../dsh/session-rows.ts'
import type { M3eSessionList } from '../../dsh/completion-status.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { inboxMessages } from './messages.ts'

/** The texts this feature shows. Tests and callers may pass them explicitly. */
export type InboxMessages = Translation<typeof inboxMessages.ja>

interface InboxRow {
  key: string
  sessionId: string
  title: string
  workspaceName: string
  description: string
  icon: 'terminal' | 'help' | 'checklist' | 'done_all'
}

export interface PendingInboxRow extends InboxRow {
  pending: PendingInteraction
}

export interface CompletedInboxRow extends InboxRow {
  updatedAt: number
}

export interface InboxRows {
  pending: PendingInboxRow[]
  completed: CompletedInboxRow[]
}

function workspaceFailed(workspaces: WorkspaceSnapshot): boolean {
  return workspaces.state === 'error' || workspaces.error !== null
}

function workspaceLoading(workspaces: WorkspaceSnapshot): boolean {
  return !workspaceFailed(workspaces) && (workspaces.phase === 'pending' || workspaces.state === 'loading')
}

/** Keep loading/error decisions testable without rendering React components. */
export function inboxStatus(rows: InboxRows, list: SessionListState, workspaces: WorkspaceSnapshot,
  text: InboxMessages = messagesOf(inboxMessages, 'ja')) {
  const loadingMessage = list.phase === 'pending' ? text.loadingInbox
    : workspaceLoading(workspaces) ? text.loadingWorkspaces : null
  const workspaceError = !workspaceFailed(workspaces) ? null
    : workspaces.items.length > 0
      ? text.workspaceErrorKnown
      : text.workspaceErrorUnknown
  return {
    loadingMessage,
    workspaceError,
    showEmpty: rows.pending.length === 0 && rows.completed.length === 0 && loadingMessage === null,
  }
}

/** The controller's queue is already in arrival order, including deferred requests. */
export function describePending(pending: PendingInteraction,
  text: InboxMessages = messagesOf(inboxMessages, 'ja')): Pick<InboxRow, 'icon' | 'description'> {
  if (pending.kind === 'approval') {
    return { icon: 'terminal', description: text.approvalDescription(pending.toolName) }
  }
  const firstQuestion = pending.items[0]?.question.trim() || text.questionFallback
  if (isPlanReview(pending)) {
    return { icon: 'checklist', description: text.planReviewDescription }
  }
  return { icon: 'help', description: text.questionDescription(firstQuestion) }
}

export function relativeTime(updatedAt: number, now: number,
  text: InboxMessages = messagesOf(inboxMessages, 'ja')): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return text.timeUnknown
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 60) return text.timeNow
  if (seconds < 3600) return text.minutesAgo(Math.floor(seconds / 60))
  if (seconds < 86400) return text.hoursAgo(Math.floor(seconds / 3600))
  return text.daysAgo(Math.floor(seconds / 86400))
}

/** Archived sessions leave the completed list; pending requests still need an answer. */
function completedSessions(list: M3eSessionList, archivedSessionIds: readonly string[]): SessionSummary[] {
  const archived = new Set(archivedSessionIds)
  return sessionRowIds(list).flatMap(id => {
    const session = list.byId[id]
    return session?.completionUnread === true && !archived.has(id) ? [session] : []
  })
}

export function countInbox(
  pending: readonly PendingInteraction[],
  list: M3eSessionList,
  archivedSessionIds: readonly string[],
): number {
  return pending.length + completedSessions(list, archivedSessionIds).length
}

export function buildInboxRows(
  pending: readonly PendingInteraction[],
  list: M3eSessionList,
  workspaces: WorkspaceSnapshot,
  now: number,
  text: InboxMessages = messagesOf(inboxMessages, 'ja'),
): InboxRows {
  const namesBySession = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const id of workspace.sessionIds) {
      if (!namesBySession.has(id)) namesBySession.set(id, workspace.title.trim() || text.untitledWorkspace)
    }
  }
  const identity = (sessionId: string) => {
    const session = list.byId[sessionId]
    const workspace = workspaces.items.find(item => item.path === session?.cwd)
    const knownName = namesBySession.get(sessionId) ?? (workspace ? workspace.title.trim() || text.untitledWorkspace : undefined)
    let workspaceName: string
    if (workspaceFailed(workspaces)) {
      workspaceName = knownName ? text.workspaceUnverified(knownName) : text.workspaceUnknown
    } else if (workspaceLoading(workspaces)) {
      workspaceName = knownName ? text.workspaceRefreshing(knownName) : text.workspaceLoading
    } else {
      workspaceName = knownName ?? (list.phase === 'pending' ? text.workspaceLoading
        : !session ? text.workspaceUnknown : text.workspaceUnregistered)
    }
    return {
      sessionId,
      title: session?.displayTitle.trim() || (list.phase === 'pending' ? text.sessionLoading
        : !session ? text.sessionUnknown : text.untitledSession),
      workspaceName,
    }
  }
  return {
    pending: pending.map(item => ({ key: item.key, ...identity(item.sessionId), ...describePending(item, text), pending: item })),
    completed: completedSessions(list, workspaces.archivedSessionIds)
      .sort((a, b) => (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) - (Number.isFinite(a.updatedAt) ? a.updatedAt : 0))
      .map(session => ({
        key: session.id,
        ...identity(session.id),
        icon: 'done_all',
        description: text.completedDescription(relativeTime(session.updatedAt, now, text)),
        updatedAt: session.updatedAt,
      })),
  }
}
