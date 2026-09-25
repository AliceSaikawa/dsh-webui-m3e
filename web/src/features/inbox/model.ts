import { isPlanReview, type PendingInteraction } from '../../dsh/interactions-store.ts'
import type { SessionListState, SessionSummary, WorkspaceView } from '../../dsh/services.ts'

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

function completedSessions(list: SessionListState): SessionSummary[] {
  return [...new Set(list.ids)].flatMap(id => {
    const session = list.byId[id]
    return session?.completed === true ? [session] : []
  })
}

export function countInbox(pending: readonly PendingInteraction[], list: SessionListState): number {
  return pending.length + completedSessions(list).length
}

export function buildInboxRows(
  pending: readonly PendingInteraction[],
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  now: number,
): InboxRows {
  const namesBySession = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      if (!namesBySession.has(id)) namesBySession.set(id, workspace.title.trim() || '名前のないワークスペース')
    }
  }
  const identity = (sessionId: string) => {
    const session = list.byId[sessionId]
    const workspace = workspaces.find(item => item.path === session?.cwd)
    return {
      sessionId,
      title: session?.displayTitle.trim() || '題名のないセッション',
      workspaceName: namesBySession.get(sessionId) ?? (workspace ? workspace.title.trim() || '名前のないワークスペース' : 'ワークスペース未登録'),
    }
  }
  return {
    pending: pending.map(item => ({ key: item.key, ...identity(item.sessionId), ...describePending(item), pending: item })),
    completed: completedSessions(list)
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
