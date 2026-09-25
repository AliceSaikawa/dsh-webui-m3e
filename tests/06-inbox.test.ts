import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { buildInboxRows, countInbox, describePending, relativeTime } from '../web/src/features/inbox/model.ts'
import { extendMock, INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type PendingInteraction } from '../web/src/dsh/interactions-store.ts'
import type { SessionListState, SessionSummary, WorkspaceView } from '../web/src/dsh/services.ts'

const now = Date.parse('2026-09-25T12:00:00+09:00')
const approval: PendingInteraction = {
  key: 'interaction:12', kind: 'approval', sessionId: 'approval', deferred: true,
  toolName: 'bash', answer: async () => {},
}
const question: PendingInteraction = {
  key: 'interaction:2', kind: 'question', sessionId: 'question', deferred: false,
  items: [{ id: 'first', question: 'どちらにしますか？' }, { id: 'second', question: '次の質問です' }], answer: async () => {},
}
const plan: PendingInteraction = {
  key: 'interaction:3', kind: 'question', sessionId: 'plan', deferred: false,
  items: [{ id: 'context', question: '最初の問い' }, { id: 'plan', question: 'このプランで進めますか？', intent: { kind: 'plan-review', approve: '進める' } }],
  answer: async () => {},
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: `${id} の会話`, running: false, blank: false, updatedAt: now, ...overrides }
}
function listOf(...sessions: SessionSummary[]): SessionListState {
  return { ids: sessions.map(item => item.id), byId: Object.fromEntries(sessions.map(item => [item.id, item])),
    current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
}
function workspace(workspaceId: string, title: string, sessionIds: string[], path = `/mock/${workspaceId}`): WorkspaceView {
  return { workspaceId, title, sessionIds, path, createdAt: '', updatedAt: '' }
}

test('返事待ちは到着順と「あとで」を保持し、完了は更新の新しい順になる', () => {
  const pending = [approval, question, plan]
  const list = listOf(summary('old', { completed: true, updatedAt: now - 720_000 }), summary('approval'), summary('question'), summary('plan'),
    summary('new', { completed: true, updatedAt: now - 180_000 }), summary('running', { running: true }))
  const originalList = structuredClone(list)
  const rows = buildInboxRows(pending, list, [], now)
  assert.deepEqual(rows.pending.map(row => row.key), ['interaction:12', 'interaction:2', 'interaction:3'])
  assert.equal(rows.pending[0]?.pending, approval)
  assert.equal(rows.pending[0]?.pending.deferred, true)
  assert.deepEqual(rows.completed.map(row => row.sessionId), ['new', 'old'])
  assert.equal(rows.completed[0]?.description, '完了 ・ 3 分前')
  assert.equal(rows.completed[1]?.description, '完了 ・ 12 分前')
  assert.deepEqual(list, originalList)
  assert.deepEqual(pending, [approval, question, plan])
})

test('種類に応じたアイコンと文言を作り、混在した質問でもプランを優先する', () => {
  assert.deepEqual(describePending(approval), { icon: 'terminal', description: 'ツールの承認：bash を実行しようとしています' })
  assert.deepEqual(describePending(question), { icon: 'help', description: '質問：どちらにしますか？' })
  assert.deepEqual(describePending(plan), { icon: 'checklist', description: 'プランの確認：承認するまで作業を始めません' })
  assert.equal(describePending({ ...question, items: [] }).description, '質問：質問の内容を確認してください')
})

test('全ワークスペースの行を含め、所属情報を作業フォルダより優先する', () => {
  const list = listOf(summary('approval', { cwd: '/mock/second' }), summary('done', { completed: true }), summary('question', { cwd: '/mock/second' }))
  const workspaces = [workspace('first', '画面の開発', ['approval']), workspace('second', '調査ノート', ['done'])]
  const rows = buildInboxRows([approval, question], list, workspaces, now)
  assert.equal(rows.pending[0]?.workspaceName, '画面の開発')
  assert.equal(rows.pending[1]?.workspaceName, '調査ノート')
  assert.equal(rows.completed[0]?.workspaceName, '調査ノート')
  const renamed = buildInboxRows([approval], list, [workspace('first', '新しい名前', ['approval'])], now)
  assert.equal(renamed.pending[0]?.workspaceName, '新しい名前')
})

test('一覧に未到着のセッションでも返事待ちを落とさず、日本語の補足を出す', () => {
  const rows = buildInboxRows([approval], listOf(), [], now)
  assert.equal(rows.pending.length, 1)
  assert.equal(rows.pending[0]?.title, '題名のないセッション')
  assert.equal(rows.pending[0]?.workspaceName, 'ワークスペース未登録')
  const untitled = buildInboxRows([approval], listOf(summary('approval', { displayTitle: ' ' })), [workspace('first', ' ', ['approval'])], now)
  assert.equal(untitled.pending[0]?.title, '題名のないセッション')
  assert.equal(untitled.pending[0]?.workspaceName, '名前のないワークスペース')
})

test('両方空・片方だけの区分を返し、件数も表示対象と一致する', () => {
  assert.deepEqual(buildInboxRows([], listOf(), [], now), { pending: [], completed: [] })
  assert.equal(countInbox([], listOf()), 0)
  const pendingOnly = buildInboxRows([approval], listOf(), [], now)
  assert.equal(pendingOnly.completed.length, 0)
  assert.equal(countInbox([approval], listOf()), 1)
  const list = listOf(summary('done', { completed: true }), summary('idle', { completed: false }))
  const completedOnly = buildInboxRows([], list, [], now)
  assert.equal(completedOnly.pending.length, 0)
  assert.equal(completedOnly.completed.length, 1)
  assert.equal(countInbox([], list), 1)
  const all = buildInboxRows([approval, question, plan], list, [], now)
  assert.equal(countInbox([approval, question, plan], list), all.pending.length + all.completed.length)
})

test('同じセッションの複数の返事待ちは個別に数え、一覧の欠損や重複は完了件数を増やさない', () => {
  const list = listOf(summary('approval', { completed: true }))
  list.ids.push('approval', 'missing')
  list.byId.stale = summary('stale', { completed: true })
  const pending = [approval, { ...approval, key: 'another' }]
  const rows = buildInboxRows(pending, list, [], now)
  assert.equal(rows.completed.length, 1)
  assert.equal(rows.pending.length, 2)
  assert.equal(countInbox(pending, list), 3)
})

test('相対時刻は分・時間・日の境界と未来・不正な値を扱う', () => {
  assert.equal(relativeTime(now - 59_999, now), 'たった今')
  assert.equal(relativeTime(now - 60_000, now), '1 分前')
  assert.equal(relativeTime(now - 3_600_000, now), '1 時間前')
  assert.equal(relativeTime(now - 86_400_000, now), '1 日前')
  assert.equal(relativeTime(now + 60_000, now), 'たった今')
  assert.equal(relativeTime(Number.NaN, now), '時刻不明')
})

test('完了の同時刻は一覧の順を保ち、不正な時刻は最後にする', () => {
  const list = listOf(summary('bad', { completed: true, updatedAt: Number.NaN }), summary('b', { completed: true }), summary('a', { completed: true }))
  const rows = buildInboxRows([], list, [], now)
  assert.deepEqual(rows.completed.map(row => row.sessionId), ['b', 'a', 'bad'])
  assert.equal(rows.completed[2]?.description, '完了 ・ 時刻不明')
})

test('inbox シナリオだけで 3 種の要求と別ワークスペースの完了 2 件を揃え、回答で件数が減る', { timeout: 1000 }, async () => {
  const ctx = createMockContext({ scenario: 'inbox', extensions: [{ extendMock }] })
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    await nextTurn()
    const read = () => buildInboxRows(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot().items, Date.now())
    const count = () => countInbox(store.getSnapshot(), ctx.sessions.list.getSnapshot())
    assert.deepEqual(read().pending.map(row => row.icon), ['terminal', 'help', 'checklist'])
    assert.deepEqual(read().completed.map(row => row.sessionId), [INBOX_MOCK_IDS.completed, INBOX_MOCK_IDS.otherCompleted])
    assert.deepEqual(read().completed.map(row => row.workspaceName), ['画面の開発', '調査ノート'])
    assert.equal(count(), 5)
    const pending = store.getSnapshot()
    store.defer(pending[0]!.key)
    assert.equal(read().pending[0]?.pending.deferred, true)
    assert.equal(count(), 5)
    for (const [index, interaction] of pending.entries()) {
      if (interaction.kind === 'approval') await interaction.answer('allowed-once')
      else await interaction.answer({ answers: interaction.items.map(item => ({ id: item.id, selected: [item.options![0]!.label] })) })
      assert.equal(count(), 4 - index)
      assert.equal(read().pending.length, 2 - index)
      assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    }
    // Simulate the controller's observed read update; the shared mock's open is not equivalent yet.
    ctx.mock.updateList(list => { delete list.byId[INBOX_MOCK_IDS.completed]!.completed })
    assert.equal(count(), 1)
    assert.deepEqual(read().completed.map(row => row.sessionId), [INBOX_MOCK_IDS.otherCompleted])
    ctx.mock.updateList(list => { delete list.byId[INBOX_MOCK_IDS.otherCompleted]!.completed })
    assert.equal(count(), 0)
    assert.deepEqual(read(), { pending: [], completed: [] })
  } finally { dispose(); store.dispose(); ctx.dispose() }
})

test('取消イベントで行と件数が消え、会話の選択は変わらない', async () => {
  const store = new InteractionStore()
  const controller = new AbortController()
  const result = store.requestQuestion('question', { questions: [{ id: 'q', question: '続けますか？' }], signal: controller.signal })
  const rejected = assert.rejects(result, { code: 'ASK_ABORTED' })
  const list = listOf(summary('question'))
  list.current = '別の会話'
  assert.equal(countInbox(store.getSnapshot(), list), 1)
  controller.abort()
  await rejected
  assert.equal(countInbox(store.getSnapshot(), list), 0)
  assert.deepEqual(buildInboxRows(store.getSnapshot(), list, [], now), { pending: [], completed: [] })
  assert.equal(list.current, '別の会話')
})

test('inbox の偽データはほかのシナリオにセッションを追加しない', () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    for (const id of Object.values(INBOX_MOCK_IDS)) assert.equal(ctx.sessions.list.getSnapshot().byId[id], undefined)
  } finally { ctx.dispose() }
})
