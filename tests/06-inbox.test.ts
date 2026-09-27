import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { buildInboxRows, countInbox, describePending, inboxStatus, relativeTime } from '../web/src/features/inbox/model.ts'
import { extendMock, INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type PendingInteraction } from '../web/src/dsh/interactions-store.ts'
import type { SessionListState, SessionSummary, WorkspaceSnapshot, WorkspaceView } from '../web/src/dsh/services.ts'

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
function workspaceState(items: readonly WorkspaceView[] = [], overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, ...overrides }
}

test('返事待ちは到着順と「あとで」を保持し、完了は更新の新しい順になる', () => {
  const pending = [approval, question, plan]
  const list = listOf(summary('old', { completed: true, updatedAt: now - 720_000 }), summary('approval'), summary('question'), summary('plan'),
    summary('new', { completed: true, updatedAt: now - 180_000 }), summary('running', { running: true }))
  const originalList = structuredClone(list)
  const rows = buildInboxRows(pending, list, workspaceState(), now)
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
  const rows = buildInboxRows([approval, question], list, workspaceState(workspaces), now)
  assert.equal(rows.pending[0]?.workspaceName, '画面の開発')
  assert.equal(rows.pending[1]?.workspaceName, '調査ノート')
  assert.equal(rows.completed[0]?.workspaceName, '調査ノート')
  const renamed = buildInboxRows([approval], list, workspaceState([workspace('first', '新しい名前', ['approval'])]), now)
  assert.equal(renamed.pending[0]?.workspaceName, '新しい名前')
})

test('一覧に未到着のセッションでも返事待ちを落とさず、日本語の補足を出す', () => {
  const rows = buildInboxRows([approval], listOf(), workspaceState(), now)
  assert.equal(rows.pending.length, 1)
  assert.equal(rows.pending[0]?.title, 'セッション情報を取得できません')
  assert.equal(rows.pending[0]?.workspaceName, 'ワークスペースを確認できません')
  const untitled = buildInboxRows([approval], listOf(summary('approval', { displayTitle: ' ' })), workspaceState([workspace('first', ' ', ['approval'])]), now)
  assert.equal(untitled.pending[0]?.title, '題名のないセッション')
  assert.equal(untitled.pending[0]?.workspaceName, '名前のないワークスペース')
})

test('両方空・片方だけの区分を返し、件数も表示対象と一致する', () => {
  assert.deepEqual(buildInboxRows([], listOf(), workspaceState(), now), { pending: [], completed: [] })
  assert.equal(countInbox([], listOf(), []), 0)
  const pendingOnly = buildInboxRows([approval], listOf(), workspaceState(), now)
  assert.equal(pendingOnly.completed.length, 0)
  assert.equal(countInbox([approval], listOf(), []), 1)
  const list = listOf(summary('done', { completed: true }), summary('idle', { completed: false }))
  const completedOnly = buildInboxRows([], list, workspaceState(), now)
  assert.equal(completedOnly.pending.length, 0)
  assert.equal(completedOnly.completed.length, 1)
  assert.equal(countInbox([], list, []), 1)
  const all = buildInboxRows([approval, question, plan], list, workspaceState(), now)
  assert.equal(countInbox([approval, question, plan], list, []), all.pending.length + all.completed.length)
})

test('同じセッションの複数の返事待ちは個別に数え、一覧の欠損や重複は完了件数を増やさない', () => {
  const list = listOf(summary('approval', { completed: true }))
  list.ids.push('approval', 'missing')
  list.byId.stale = summary('stale', { completed: true })
  const pending = [approval, { ...approval, key: 'another' }]
  const rows = buildInboxRows(pending, list, workspaceState(), now)
  assert.equal(rows.completed.length, 1)
  assert.equal(rows.pending.length, 2)
  assert.equal(countInbox(pending, list, []), 3)
})

test('アーカイブした完了会話は行と件数から外し、返事待ちは残す', () => {
  const list = listOf(summary('approval', { completed: true }), summary('archived', { completed: true }), summary('kept', { completed: true }))
  const workspaces = workspaceState([], { archivedSessionIds: ['archived', 'approval'] })
  const rows = buildInboxRows([approval], list, workspaces, now)
  assert.deepEqual(rows.completed.map(row => row.sessionId), ['kept'])
  assert.deepEqual(rows.pending.map(row => row.sessionId), ['approval'])
  assert.equal(countInbox([approval], list, workspaces.archivedSessionIds), 2)
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
  const rows = buildInboxRows([], list, workspaceState(), now)
  assert.deepEqual(rows.completed.map(row => row.sessionId), ['b', 'a', 'bad'])
  assert.equal(rows.completed[2]?.description, '完了 ・ 時刻不明')
})

test('06だけを登録した inbox シナリオで3種の要求と完了2件を揃え、回答と既読で件数が減る', { timeout: 1000 }, async () => {
  const ctx = createMockContext({ scenario: 'inbox', extensions: [{ extendMock }] })
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    await nextTurn()
    const read = () => buildInboxRows(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot(), Date.now())
    const count = () => countInbox(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot().archivedSessionIds)
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
    ctx.sessions.open(INBOX_MOCK_IDS.completed)
    assert.equal(count(), 1)
    assert.deepEqual(read().completed.map(row => row.sessionId), [INBOX_MOCK_IDS.otherCompleted])
    ctx.sessions.open(INBOX_MOCK_IDS.otherCompleted)
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
  assert.equal(countInbox(store.getSnapshot(), list, []), 1)
  controller.abort()
  await rejected
  assert.equal(countInbox(store.getSnapshot(), list, []), 0)
  assert.deepEqual(buildInboxRows(store.getSnapshot(), list, workspaceState(), now), { pending: [], completed: [] })
  assert.equal(list.current, '別の会話')
})

test('inbox の偽データはほかのシナリオにセッションを追加しない', () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    for (const id of Object.values(INBOX_MOCK_IDS)) assert.equal(ctx.sessions.list.getSnapshot().byId[id], undefined)
  } finally { ctx.dispose() }
})

const workspaceFailure = { code: 'workspace/unavailable', message: '一覧を取得できません', details: {} }

test('ワークスペースの初回取得失敗は未登録と区別し、pending のままでもエラーを表示する', () => {
  const list = listOf(summary('approval'), summary('done', { completed: true }))
  const workspaces = workspaceState([], { phase: 'pending', state: 'error', error: workspaceFailure })
  const rows = buildInboxRows([approval], list, workspaces, now)
  assert.equal(rows.pending[0]?.workspaceName, 'ワークスペースを確認できません')
  assert.equal(rows.completed[0]?.workspaceName, 'ワークスペースを確認できません')
  assert.equal(rows.pending[0]?.pending, approval)
  assert.equal(countInbox([approval], list, []), 2)
  assert.deepEqual(inboxStatus(rows, list, workspaces), {
    workspaceError: 'ワークスペース一覧を取得できませんでした。所属を確認できません。',
    loadingMessage: null,
    showEmpty: false,
  })
  const pendingList = { ...listOf(), phase: 'pending' as const }
  const status = inboxStatus(buildInboxRows([], pendingList, workspaces, now), pendingList, workspaces)
  assert.ok(status.workspaceError)
  assert.equal(status.loadingMessage, '対応待ちを読み込んでいます')
  assert.equal(status.showEmpty, false)
})

test('取得済みの一覧を保った失敗では前回の所属と警告を表示し、所属不明を未登録にしない', () => {
  const list = listOf(summary('approval'), summary('question'), summary('done', { completed: true, cwd: '/mock/first' }))
  const workspaces = workspaceState([workspace('first', '前回の所属', ['approval'])], { state: 'error', error: workspaceFailure })
  const original = structuredClone(workspaces)
  const rows = buildInboxRows([approval, question], list, workspaces, now)
  assert.equal(rows.pending[0]?.workspaceName, '前回の所属（更新未確認）')
  assert.equal(rows.completed[0]?.workspaceName, '前回の所属（更新未確認）')
  assert.equal(rows.pending[1]?.workspaceName, 'ワークスペースを確認できません')
  assert.equal(inboxStatus(rows, list, workspaces).workspaceError, 'ワークスペース一覧を取得できませんでした。所属は前回取得した情報です。')
  assert.equal(countInbox([approval, question], list, []), 3)
  assert.deepEqual(workspaces, original)
})

test('取得成功に戻ると警告と古い所属の印を消し、確認済みの未登録を表示する', () => {
  const list = listOf(summary('approval'), summary('question'))
  const workspaces = workspaceState([workspace('first', '新しい所属', ['approval'])])
  const rows = buildInboxRows([approval, question], list, workspaces, now)
  assert.equal(rows.pending[0]?.workspaceName, '新しい所属')
  assert.equal(rows.pending[1]?.workspaceName, 'ワークスペース未登録')
  assert.deepEqual(inboxStatus(rows, list, workspaces), { workspaceError: null, loadingMessage: null, showEmpty: false })
})

test('セッション一覧の読み込み中は空と断定せず、取得が終わった空の一覧だけを空表示にする', () => {
  const list = { ...listOf(), phase: 'pending' as const }
  const workspaces = workspaceState()
  const rows = buildInboxRows([], list, workspaces, now)
  assert.deepEqual(inboxStatus(rows, list, workspaces), {
    workspaceError: null, loadingMessage: '対応待ちを読み込んでいます', showEmpty: false,
  })
  assert.deepEqual(inboxStatus(rows, { ...list, phase: 'ready' }, workspaces), {
    workspaceError: null, loadingMessage: null, showEmpty: true,
  })
})

test('一覧より先に届いた返事待ちは読み込み中の題名・所属で残し、取得後に確定する', () => {
  const list = { ...listOf(), phase: 'pending' as const }
  const workspaces = workspaceState()
  const rows = buildInboxRows([approval], list, workspaces, now)
  assert.equal(rows.pending[0]?.title, 'セッションを読み込み中')
  assert.equal(rows.pending[0]?.workspaceName, 'ワークスペースを読み込み中')
  assert.equal(rows.pending[0]?.pending, approval)
  assert.equal(countInbox([approval], list, []), 1)
  assert.equal(inboxStatus(rows, list, workspaces).showEmpty, false)
  assert.equal(inboxStatus(rows, list, workspaces).loadingMessage, '対応待ちを読み込んでいます')
  const readyRows = buildInboxRows([approval], listOf(summary('approval', { displayTitle: '' })), workspaces, now)
  assert.equal(readyRows.pending[0]?.title, '題名のないセッション')
  assert.equal(readyRows.pending[0]?.workspaceName, 'ワークスペース未登録')
})

test('ワークスペースだけ読み込み中なら取得済みの題名を使い、所属は読み込み中と表示する', () => {
  const list = listOf(summary('approval'), summary('done', { completed: true }))
  const workspaces = workspaceState([], { phase: 'pending', state: 'loading' })
  const rows = buildInboxRows([approval], list, workspaces, now)
  assert.equal(rows.pending[0]?.title, 'approval の会話')
  assert.equal(rows.pending[0]?.workspaceName, 'ワークスペースを読み込み中')
  assert.equal(rows.completed[0]?.workspaceName, 'ワークスペースを読み込み中')
  assert.deepEqual(inboxStatus(rows, list, workspaces), {
    workspaceError: null, loadingMessage: 'ワークスペースを読み込んでいます', showEmpty: false,
  })
})

test('再接続による読み込み中は既存の行を残し、保持した所属が更新中であることを示す', () => {
  const list = { ...listOf(summary('approval'), summary('done', { completed: true })), phase: 'pending' as const }
  const workspaces = workspaceState([workspace('first', '保存済みの所属', ['approval', 'done'])], { state: 'loading' })
  const rows = buildInboxRows([approval], list, workspaces, now)
  assert.equal(rows.pending[0]?.title, 'approval の会話')
  assert.equal(rows.pending[0]?.workspaceName, '保存済みの所属（更新中）')
  assert.equal(rows.completed[0]?.workspaceName, '保存済みの所属（更新中）')
  assert.equal(rows.pending.length, 1)
  assert.equal(rows.completed.length, 1)
  assert.equal(countInbox([approval], list, []), 2)
  assert.deepEqual(inboxStatus(rows, list, workspaces), {
    workspaceError: null, loadingMessage: '対応待ちを読み込んでいます', showEmpty: false,
  })
})
