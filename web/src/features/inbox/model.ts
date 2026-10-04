import { isPlanReview, type PendingInteraction } from '../../dsh/interactions-store.ts'
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from '../../dsh/services.ts'
import type { M3eSessionList } from '../../dsh/completion-status.ts'

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
export function inboxStatus(rows: InboxRows, list: SessionListState, workspaces: WorkspaceSnapshot) {
  const loadingMessage = list.phase === 'pending' ? '対応待ちを読み込んでいます'
    : workspaceLoading(workspaces) ? 'ワークスペースを読み込んでいます' : null
  const workspaceError = !workspaceFailed(workspaces) ? null
    : workspaces.items.length > 0
      ? 'ワークスペース一覧を取得できませんでした。所属は前回取得した情報です。'
      : 'ワークスペース一覧を取得できませんでした。所属を確認できません。'
  return {
    loadingMessage,
    workspaceError,
    showEmpty: rows.pending.length === 0 && rows.completed.length === 0 && loadingMessage === null,
  }
}

/** The controller's queue is already in arrival order, including deferred requests. */
export function describePending(pending: PendingInteraction): Pick<InboxRow, 'icon' | 'description'> {
  if (pending.kind === 'approval') {
    return { icon: 'terminal', description: `ツールの承認：${pending.toolName} を実行しようとしています` }
  }
  const firstQuestion = pending.items[0]?.question.trim() || '質問の内容を確認してください'
  if (isPlanReview(pending)) {
    return { icon: 'checklist', description: 'プランの確認：承認するまで作業を始めません' }
  }
  return { icon: 'help', description: `質問：${firstQuestion}` }
}

export function relativeTime(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return '時刻不明'
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 60) return 'たった今'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 時間前`
  return `${Math.floor(seconds / 86400)} 日前`
}

/** Archived sessions leave the completed list; pending requests still need an answer. */
function completedSessions(list: M3eSessionList, archivedSessionIds: readonly string[]): SessionSummary[] {
  const archived = new Set(archivedSessionIds)
  return [...new Set(list.ids)].flatMap(id => {
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
): InboxRows {
  const namesBySession = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const id of workspace.sessionIds) {
      if (!namesBySession.has(id)) namesBySession.set(id, workspace.title.trim() || '名前のないワークスペース')
    }
  }
  const identity = (sessionId: string) => {
    const session = list.byId[sessionId]
    const workspace = workspaces.items.find(item => item.path === session?.cwd)
    const knownName = namesBySession.get(sessionId) ?? (workspace ? workspace.title.trim() || '名前のないワークスペース' : undefined)
    let workspaceName: string
    if (workspaceFailed(workspaces)) {
      workspaceName = knownName ? `${knownName}（更新未確認）` : 'ワークスペースを確認できません'
    } else if (workspaceLoading(workspaces)) {
      workspaceName = knownName ? `${knownName}（更新中）` : 'ワークスペースを読み込み中'
    } else {
      workspaceName = knownName ?? (list.phase === 'pending' ? 'ワークスペースを読み込み中'
        : !session ? 'ワークスペースを確認できません' : 'ワークスペース未登録')
    }
    return {
      sessionId,
      title: session?.displayTitle.trim() || (list.phase === 'pending' ? 'セッションを読み込み中'
        : !session ? 'セッション情報を取得できません' : '題名のないセッション'),
      workspaceName,
    }
  }
  return {
    pending: pending.map(item => ({ key: item.key, ...identity(item.sessionId), ...describePending(item), pending: item })),
    completed: completedSessions(list, workspaces.archivedSessionIds)
      .sort((a, b) => (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) - (Number.isFinite(a.updatedAt) ? a.updatedAt : 0))
      .map(session => ({
        key: session.id,
        ...identity(session.id),
        icon: 'done_all',
        description: `完了 ・ ${relativeTime(session.updatedAt, now)}`,
        updatedAt: session.updatedAt,
      })),
  }
}
