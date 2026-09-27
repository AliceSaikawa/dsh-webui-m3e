import type { MockKit } from '../../dsh/mock/kit.ts'

export const INBOX_MOCK_IDS = {
  approval: 'inbox-approval', question: 'inbox-question', plan: 'inbox-plan',
  completed: 'inbox-completed', otherCompleted: 'inbox-other-completed',
} as const

export function extendMock(kit: MockKit): void {
  kit.scenario('inbox', inbox => {
    const now = Date.now()
    const time = new Date(now).toISOString()
    inbox.addWorkspace({ workspaceId: 'inbox-workspace', title: '画面の開発', path: '/mock/inbox',
      sessionIds: [INBOX_MOCK_IDS.approval, INBOX_MOCK_IDS.question, INBOX_MOCK_IDS.plan, INBOX_MOCK_IDS.completed], createdAt: time, updatedAt: time })
    inbox.addWorkspace({ workspaceId: 'inbox-other-workspace', title: '調査ノート', path: '/mock/inbox-notes',
      sessionIds: [INBOX_MOCK_IDS.otherCompleted], createdAt: time, updatedAt: time })
    const sessions = [
      { id: INBOX_MOCK_IDS.approval, displayTitle: '対応待ちのテスト', completed: false },
      { id: INBOX_MOCK_IDS.question, displayTitle: '一覧の表示方法', completed: false },
      { id: INBOX_MOCK_IDS.plan, displayTitle: 'スマートフォン画面の改善と対応待ちの長い題名が行の内側で省略されることを確認する', completed: false },
      { id: INBOX_MOCK_IDS.completed, displayTitle: '操作手順の見直し', completed: true },
      { id: INBOX_MOCK_IDS.otherCompleted, displayTitle: '調査結果の整理', completed: true },
    ]
    for (const [index, session] of sessions.entries()) {
      inbox.addSession({ ...session, cwd: session.id === INBOX_MOCK_IDS.otherCompleted ? '/mock/inbox-notes' : '/mock/inbox',
        blank: false, running: !session.completed, updatedAt: now - (index === 4 ? 12 : 3) * 60_000 }, [])
    }
    // A zero-delay delivery lets the foundation register its handlers during boot.
    // Requests are independent of feature 05's fixtures and remain in arrival order.
    void inbox.emit('approval/request', { agent: INBOX_MOCK_IDS.approval, toolName: 'bash', callId: 'inbox-test', reason: '画面のテストを実行します。' }, { afterMs: 0 }).catch(() => {})
    void inbox.emit('user-questions/request', { agent: INBOX_MOCK_IDS.question, questions: [
      { id: 'inbox-layout', question: '一覧には何を表示しますか？画面の幅が狭い場合でも、返事が必要な項目の補足文を読みやすく表示できますか？', options: [{ label: 'すべて表示' }, { label: '未完了だけ表示' }] },
    ] }, { afterMs: 0 }).catch(() => {})
    void inbox.emit('user-questions/request', { agent: INBOX_MOCK_IDS.plan, questions: [
      { id: 'inbox-review', question: 'このプランで作業を始めますか？', detail: '## 作業の進め方\n\n1. 対応待ちを一覧にします。\n2. 返事をすると件数が減ることを確かめます。',
        options: [{ label: '承認して開始' }, { label: '修正する' }], intent: { kind: 'plan-review', approve: '承認して開始' } },
    ] }, { afterMs: 0 }).catch(() => {})
  })
}
