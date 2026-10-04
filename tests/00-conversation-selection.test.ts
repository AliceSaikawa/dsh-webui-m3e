import assert from 'node:assert/strict'
import test from 'node:test'
import { canSelectConversation, conversationSessionId, conversationSelection, MAIN_VIEW_SOURCE } from '../web/src/dsh/conversation-selection.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import type { SessionReference, SessionTarget, SessionRetainOptions } from '../web/src/dsh/services.ts'

const a = MOCK_IDS.sessions.readme, b = MOCK_IDS.sessions.approval
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('URL の会話IDは補助画面・エンコードを含めて解釈する', () => {
  for (const tail of ['', '/trace', '/files', '/file', '/jobs', '/subagents', '/goal', '/files/deeper']) assert.equal(conversationSessionId('/s/a%2Fb' + tail), 'a/b')
  for (const path of ['/', '/search', '/inbox', '/settings', '/new', '/s/', '/s/%ZZ', '/sessions/a']) assert.equal(conversationSessionId(path), undefined)
})

test('StrictMode の二重通知・画面作り直し・補助画面往復でも同じ世代を保つ', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const retain = t.mock.method(ctx.sessions, 'retain')
  await owner.select(a)
  const binding = ctx.sessions.binding(a)
  for (const path of ['/s/' + a, '/s/' + a + '/trace', '/s/' + a + '/goal']) {
    await conversationSelection(ctx.sessions).select(conversationSessionId(path))
    assert.equal(ctx.sessions.binding(a), binding)
  }
  assert.equal(retain.mock.callCount(), 1)
  assert.deepEqual(ctx.sessions.retainInfo(a).getSnapshot(), { referenceCount: 1, retainedBy: { [MAIN_VIEW_SOURCE]: 1 } })
})

for (const route of ['/', '/inbox', '/search', '/settings']) test('会話から ' + route + ' へ戻ると最後の参照を即解放する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(a)
  await owner.select(conversationSessionId(route))
  assert.equal(ctx.sessions.scope(a), undefined)
  assert.equal(ctx.sessions.binding(a), undefined)
  assert.equal(ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0)
})

test('別会話は新しい参照を取ってから古い参照を放し、戻ると新世代になる', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(a)
  const old = ctx.sessions.binding(a)
  const retain = ctx.sessions.retain
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    assert.ok(ctx.sessions.binding(a), 'B の取得前に A を破棄しない')
    return retain(target, options)
  })
  await owner.select(b)
  t.mock.restoreAll()
  assert.equal(ctx.sessions.binding(a), undefined)
  assert.equal(ctx.sessions.retainInfo(b).getSnapshot().referenceCount, 1)
  await owner.select(a)
  assert.notEqual(ctx.sessions.binding(a), old)
  assert.equal(ctx.sessions.binding(b), undefined)
})

for (const fail of [false, true]) test('開く途中の旧要求の' + (fail ? '失敗' : '成功') + 'は新しい選択を上書きしない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const gate = deferred<Awaited<SessionReference['ready']>>()
  const retain = ctx.sessions.retain
  let old!: SessionReference
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    const reference = retain(target, options)
    if (target !== a) return reference
    old = reference
    return { ...reference, ready: gate.promise }
  })
  const pending = owner.select(a)
  await Promise.resolve()
  await owner.select(b)
  assert.equal(ctx.sessions.binding(a), undefined)
  if (fail) gate.reject(new Error('古い失敗'))
  else gate.resolve({} as Awaited<SessionReference['ready']>)
  assert.equal(await pending, false)
  assert.equal(owner.state.getSnapshot().sessionId, b)
  assert.ok(ctx.sessions.binding(b))
  assert.throws(() => old.binding)
})

test('開く途中で一覧へ戻ると参照を解放し後着完了を無視する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const pending = owner.select(a)
  await Promise.resolve()
  owner.clear()
  assert.equal(await pending, false)
  assert.equal(ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0)
  assert.equal(owner.state.getSnapshot().sessionId, undefined)
})

test('ready が解決しても openState error なら参照を解放し、A B A で再試行できる', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  ctx.mock.setSessionState(a, { openState: 'error', openError: { code: 'gateway/internal', message: '失敗', details: {} } })
  await assert.rejects(owner.select(a))
  assert.equal(ctx.sessions.scope(a), undefined)
  assert.ok(owner.state.getSnapshot().error)
  await owner.select(b)
  ctx.mock.setSessionState(a, { openState: 'open', openError: null })
  await owner.select(a)
  assert.ok(ctx.sessions.binding(a))
  assert.equal(ctx.sessions.binding(b), undefined)
})

test('retain 自体の例外も古い選択を解放し次の選択を妨げない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(b)
  const retain = ctx.sessions.retain
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => { if (target === a) throw new Error('取得失敗'); return retain(target, options) })
  await assert.rejects(owner.select(a), /取得失敗/)
  assert.equal(ctx.sessions.binding(b), undefined)
  await owner.select(b)
  assert.ok(ctx.sessions.binding(b))
})

test('存在しない・削除されたIDでは取得せず参照を残さない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(b)
  await assert.rejects(owner.select('missing'), /見つかりません/)
  assert.equal(ctx.sessions.binding(b), undefined)
  ctx.mock.removeSession(a)
  await assert.rejects(owner.select(a), /見つかりません/)
  assert.equal(ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0)
})

test('直接URLを再読込すると一覧 pending 中は retain せず ready 後に一度開く', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const baseline = ctx.sessions.list.getSnapshot()
  ctx.mock.updateList(state => ({ ...state, phase: 'pending', ids: [], byId: {} }))
  const retain = t.mock.method(ctx.sessions, 'retain')
  const owner = conversationSelection(ctx.sessions)
  const pending = owner.select(a)
  assert.equal(retain.mock.callCount(), 0)
  assert.equal(ctx.sessions.scope(a), undefined)
  ctx.mock.updateList(() => baseline)
  assert.equal(await pending, true)
  assert.equal(retain.mock.callCount(), 1)
})

test('作成済みIDや承認用scopeがあっても文字列URLは pending の終了を待つ', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.updateList(state => ({ ...state, phase: 'pending' }))
  const id = await ctx.sessions.create()
  const gateway = ctx.sessions.retain(id, { source: 'm3e.mockGateway' })
  const owner = conversationSelection(ctx.sessions)
  const pending = owner.select(id)
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 1)
  ctx.mock.updateList(state => ({ ...state, phase: 'ready' }))
  await pending
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 2)
  gateway.release()
})

test('一覧待機を取り消すと購読を解除し、その後の baseline で会話を開かない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.updateList(state => ({ ...state, phase: 'pending' }))
  const owner = conversationSelection(ctx.sessions)
  const pending = owner.select(a)
  owner.clear()
  assert.equal(await pending, false)
  ctx.mock.updateList(state => ({ ...state, phase: 'ready' }))
  assert.equal(ctx.sessions.scope(a), undefined)
})

test('ページを離れる pagehide と明示的disposeは参照を解放する', async () => {
  const events = new EventTarget()
  const globals = globalThis as unknown as { window?: EventTarget }
  const previous = globals.window
  globals.window = events
  const ctx = createMockContext()
  try {
    const owner = conversationSelection(ctx.sessions)
    await owner.select(a)
    events.dispatchEvent(new Event('pagehide'))
    assert.equal(ctx.sessions.binding(a), undefined)
    await owner.select(b)
    owner.dispose()
    assert.equal(ctx.sessions.binding(b), undefined)
  } finally { ctx.dispose(); globals.window = previous }
})

test('会話を離れた後の完了は未読、見ている会話の完了は既読にする', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const status = completionStatus(ctx)
  await owner.select(a)
  await ctx.mock.streamAssistant(a, '確認中', { chunkMs: 0 })
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, false)
  const flight = ctx.mock.streamAssistant(a, '離れた後', { chunkMs: 0 })
  owner.clear()
  await flight
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  await owner.select(a)
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, false)
})

test('未読の会話が再開すると印を消し、次の完了で再び未読にする', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const status = completionStatus(ctx)
  await ctx.mock.streamAssistant(a, '初回', { chunkMs: 0 })
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  const next = ctx.mock.streamAssistant(a, '次回', { chunkMs: 0 })
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, false)
  await next
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
})

test('選択可能性はscopeではなく一覧または取得済みカタログで判断する', t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  assert.equal(canSelectConversation(ctx.sessions, a), true)
  const reference = ctx.sessions.retain(a, { source: 'm3e.test' })
  ctx.mock.updateList(state => ({ ...state, ids: [], byId: {} }))
  assert.equal(canSelectConversation(ctx.sessions, a), false)
  reference.release()
})
