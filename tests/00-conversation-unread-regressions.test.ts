import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationSelection, conversationSessionId, MAIN_VIEW_SOURCE } from '../web/src/dsh/conversation-selection.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { closeOverlaysOutsideRoute, getOverlays, openSheet, overlayOwnerForRoute } from '../web/src/app/overlay/store.ts'
import type { SessionReference, SessionTarget, SessionRetainOptions } from '../web/src/dsh/services.ts'

const a = MOCK_IDS.sessions.readme, b = MOCK_IDS.sessions.approval
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('#43 表示後にopenが失敗した会話は完了未読となり、復旧時だけ既読に戻る', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const status = completionStatus(ctx)
  await owner.select(a)
  ctx.mock.setSessionState(a, { openState: 'error', openError: { code: 'test/open', message: '開けません', details: {} } })
  await ctx.mock.streamAssistant(a, '表示できない間の返答', { chunkMs: 0 })
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  ctx.mock.setSessionState(a, { openState: 'open', openError: null })
  await tick()
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, false)
})

test('#43 選択変更とclearは古いbindingの可視状態の購読を解除する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const subscriptions = new Map<string, number>()
  const retain = ctx.sessions.retain
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    const reference = retain(target, options)
    const binding = reference.binding
    return { ...reference, binding: { ...binding, session: { ...binding.session, subscribe(listener: () => void) {
      subscriptions.set(reference.sessionId, (subscriptions.get(reference.sessionId) ?? 0) + 1)
      const off = binding.session.subscribe(listener)
      return () => { subscriptions.set(reference.sessionId, subscriptions.get(reference.sessionId)! - 1); off() }
    } } } }
  })
  await owner.select(a)
  assert.equal(subscriptions.get(a), 1)
  let notifications = 0
  const stop = owner.state.subscribe(() => { notifications++ })
  await owner.select(b)
  assert.equal(subscriptions.get(a), 0)
  assert.equal(subscriptions.get(b), 1)
  const baseline = notifications
  ctx.mock.setSessionState(a, { openState: 'error' })
  await tick()
  assert.equal(notifications, baseline)
  assert.equal(owner.state.getSnapshot().visibleSessionId, b)
  owner.clear()
  assert.equal(subscriptions.get(b), 0)
  const cleared = notifications
  ctx.mock.setSessionState(b, { openState: 'error' })
  await tick()
  assert.equal(notifications, cleared)
  assert.equal(owner.state.getSnapshot().visibleSessionId, undefined)
  ctx.mock.setSessionState(a, { openState: 'open', openError: null })
  await owner.select(a)
  owner.dispose()
  assert.equal(subscriptions.get(a), 0)
  stop()
})

test('#43 開くのに失敗した会話は完了未読を保持する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const status = completionStatus(ctx)
  await ctx.mock.streamAssistant(a, '未読', { chunkMs: 0 })
  ctx.mock.setSessionState(a, { openState: 'error', openError: { code: 'test/open', message: '開けません', details: {} } })
  await assert.rejects(conversationSelection(ctx.sessions).select(a))
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  assert.equal(ctx.sessions.retainInfo(a).getSnapshot().referenceCount, 0)
})

for (const outcome of ['cancel', 'stale-success', 'stale-error', 'success'] as const) {
  test('#43 pending と ' + outcome + ' は成功した現在の会話だけを既読にする', async t => {
    const ctx = createMockContext(); t.after(() => ctx.dispose())
    const owner = conversationSelection(ctx.sessions)
    const status = completionStatus(ctx)
    await ctx.mock.streamAssistant(a, '未読', { chunkMs: 0 })
    const gate = deferred<Awaited<SessionReference['ready']>>()
    const retain = ctx.sessions.retain
    let binding!: Awaited<SessionReference['ready']>
    t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
      const reference = retain(target, options)
      if (target !== a) return reference
      binding = reference.binding
      return { ...reference, ready: gate.promise }
    })
    const pending = owner.select(a)
    await tick()
    const unreadWhilePending = status.getSnapshot().byId[a]?.completionUnread
    if (outcome === 'cancel') owner.clear()
    else if (outcome.startsWith('stale')) await owner.select(b)
    if (outcome === 'stale-error') gate.reject(new Error('古い失敗'))
    else gate.resolve(binding)
    assert.equal(await pending, outcome === 'success')
    assert.equal(unreadWhilePending, true)
    assert.equal(status.getSnapshot().byId[a]?.completionUnread, outcome !== 'success')
  })
}

test('#43 子のURL解決中に残した前の参照は完了を既読にしない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const child = 'child/日本語'
  ctx.mock.addSession({ id: child, parentId: a, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(child, 'subagent', { mode: 'continuable', seq: 0 })
  const owner = conversationSelection(ctx.sessions)
  const status = completionStatus(ctx)
  await owner.select(a)
  ctx.mock.updateList(list => ({ ...list, projectionsBySession: {} }))
  const gate = deferred<void>()
  t.mock.method(ctx.sessions, 'refreshProjections', async () => {
    await gate.promise
    ctx.mock.updateList(list => ({ ...list, projectionsBySession: { [a]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: child, mode: 'continuable', label: '子', createdAt: 0 }] } } } }))
  })
  const pending = owner.select(child)
  assert.equal(ctx.sessions.retainInfo(a).getSnapshot().retainedBy[MAIN_VIEW_SOURCE], 1)
  await ctx.mock.streamAssistant(a, '移動後に完了', { chunkMs: 0 })
  const unread = status.getSnapshot().byId[a]?.completionUnread
  gate.resolve()
  assert.equal(await pending, true)
  assert.equal(unread, true)
})

test('#43 ナビゲーション準備の adopt はURLの選択が届くまで既読にしない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const status = completionStatus(ctx)
  await ctx.mock.streamAssistant(a, '未読', { chunkMs: 0 })
  assert.equal(await owner.prepare(a, () => true, () => {}), true)
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  await owner.select(a)
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, false)
})

test('#43 新URLのworkspace待機中に古いopenが成功しても既読にしない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const status = completionStatus(ctx)
  await ctx.mock.streamAssistant(a, '未読', { chunkMs: 0 })
  const gate = deferred<Awaited<SessionReference['ready']>>()
  const retain = ctx.sessions.retain
  let binding!: Awaited<SessionReference['ready']>
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    const reference = retain(target, options)
    if (target !== a) return reference
    binding = reference.binding
    return { ...reference, ready: gate.promise }
  })
  const pending = owner.select(a)
  await tick()
  // The route effect conveys intent before its workspace baseline permits select().
  owner.routeChanged(b)
  gate.resolve(binding)
  await pending
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  assert.equal(owner.state.getSnapshot().visibleSessionId, undefined)
  await owner.select(b)
  assert.equal(owner.state.getSnapshot().visibleSessionId, b)
})

test('#42 未登録の下位URLは会話を選ばず、会話のシートも閉じる', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  t.after(() => { for (const entry of getOverlays()) entry.close() })
  const status = completionStatus(ctx)
  const owner = conversationSelection(ctx.sessions)
  await owner.select(b)
  await ctx.mock.streamAssistant(a, '未読', { chunkMs: 0 })
  openSheet('前の会話のシート', { owner: { kind: 'conversation', sessionId: a } })
  const path = '/s/' + a + '/does-not-exist'
  await owner.select(conversationSessionId(path))
  closeOverlaysOutsideRoute(path)
  assert.equal(owner.state.getSnapshot().sessionId, undefined)
  assert.equal(status.getSnapshot().byId[a]?.completionUnread, true)
  assert.equal(getOverlays().length, 0)
  assert.deepEqual(overlayOwnerForRoute(path), { kind: 'route', path })
})

test('#42 query・末尾スラッシュ・符号化IDを通常と復帰で同じように解釈する', async () => {
  const events = Object.assign(new EventTarget(), { location: { hash: '#/' } })
  const globals = globalThis as unknown as { window?: typeof events }
  const previous = globals.window
  globals.window = events
  const ctx = createMockContext()
  try {
    const id = '会話/a?b'
    ctx.mock.addSession({ id, displayTitle: '符号化', running: false, blank: false, updatedAt: 0 }, [])
    const owner = conversationSelection(ctx.sessions)
    for (const tail of ['', '/trace', '/files', '/file', '/jobs', '/subagents', '/goal']) for (const slash of ['', '/']) {
      const path = '/s/' + encodeURIComponent(id) + tail + slash + '?view=chat'
      events.location.hash = '#' + path
      await owner.select(id)
      events.dispatchEvent(new Event('pagehide'))
      events.dispatchEvent(new Event('pageshow'))
      await tick()
      assert.equal(owner.state.getSnapshot().sessionId, id)
      assert.equal(owner.state.getSnapshot().error, undefined)
      assert.equal(conversationSessionId(path), id)
      assert.deepEqual(overlayOwnerForRoute(path), { kind: 'conversation', sessionId: id })
    }
    events.dispatchEvent(new Event('pagehide'))
    events.location.hash = '#/s/' + encodeURIComponent(id) + '/does-not-exist?view=chat'
    events.dispatchEvent(new Event('pageshow'))
    await tick()
    assert.equal(owner.state.getSnapshot().sessionId, undefined)
    for (const path of ['/s/%zz', '/s/a/files/deeper', '/s/']) assert.equal(conversationSessionId(path), undefined)
  } finally { ctx.dispose(); globals.window = previous }
})
