import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { deliverDraft } from '../web/src/features/composer/delivery.ts'
import { clearDraft, writeDraft } from '../web/src/features/composer/drafts.ts'
import { openHomeSession } from '../web/src/features/home/session-navigation.ts'
import { openInboxSession } from '../web/src/features/inbox/session-navigation.ts'
import type { SessionBinding, SessionReference, SessionTarget, SessionRetainOptions } from '../web/src/dsh/services.ts'

const a = MOCK_IDS.sessions.readme
const child = 'review-child'
const address = { parentSessionId: a, childSessionId: child, mode: 'continuable' as const }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function fixture() {
  const ctx = createMockContext()
  ctx.mock.addSession({ id: child, parentId: a, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(a, 'subagentCatalog', [{ id: child, createdAt: 0, mode: 'continuable', label: '子' }])
  return ctx
}

for (const leave of [false, true]) test('R1 初回送信の参照を' + (leave ? '離脱後は引き継がず解放する' : '画面へゼロを挟まず引き継ぐ'), async t => {
  const ctx = fixture(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  const key = 'new:review-handoff-' + leave
  writeDraft(key, { text: '最初の送信', images: [] })
  t.after(() => clearDraft(key))
  const retain = ctx.sessions.retain
  let sending!: SessionBinding
  const gate = deferred<void>()
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    const ref = retain(target, options)
    if (options.source === 'm3e.delivery') {
      sending = ref.binding
      // Acknowledged prompt, durable echo not yet received.
      ref.binding.session.prompt = async () => { await gate.promise; return { ok: true, value: { accepted: true } } }
    }
    return ref
  })
  let active = true
  const options = { target: { kind: 'new' as const, workspaceId: ctx.workspaces.list.getSnapshot().items[0]!.workspaceId },
    draftKey: key, sessions: ctx.sessions, mode: 'queue' as const,
    api: { async selectModel() { throw new Error('unused') }, async listCommands() { return [] } },
    handoff(reference: SessionReference) { if (active) owner.adopt(reference) },
  }
  const flight = deliverDraft(options)
  await flush()
  if (leave) active = false
  gate.resolve()
  const result = await flight
  assert.equal(result.error, undefined)
  assert.ok(result.createdId)
  if (leave) {
    assert.equal(ctx.sessions.binding(result.createdId!), undefined)
    assert.equal(owner.state.getSnapshot().sessionId, undefined)
  } else {
    assert.equal(ctx.sessions.binding(result.createdId!), sending)
    assert.equal(sending.session.getSnapshot().pendingSubmissions.length, 1)
    await owner.select(result.createdId!)
    assert.equal(ctx.sessions.binding(result.createdId!), sending)
  }
})

test('R2 AからBのカタログ待ち中にAへ戻るとBを無効化する', async t => {
  const ctx = fixture(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(a)
  const original = ctx.sessions.binding(a)
  ctx.mock.updateList(list => ({ ...list, projectionsBySession: {} }))
  const gate = deferred<void>()
  const refresh = ctx.sessions.refreshProjections
  t.mock.method(ctx.sessions, 'refreshProjections', async (id: string) => { await gate.promise; await refresh(id) })
  const pending = owner.select(child)
  await flush()
  const returning = owner.select(a)
  gate.resolve()
  await Promise.all([pending, returning])
  assert.equal(owner.state.getSnapshot().sessionId, a)
  assert.equal(ctx.sessions.binding(a), original)
  assert.equal(ctx.sessions.binding(child), undefined)
})

for (const surface of ['home', 'inbox'] as const) for (const failure of [false, true]) {
  test('R3 ' + surface + ' 子の準備中の' + (failure ? '失敗' : 'シート取消') + 'は元の参照を保つ', async t => {
    const ctx = fixture(); t.after(() => ctx.dispose())
    const owner = conversationSelection(ctx.sessions)
    await owner.select(a)
    const original = ctx.sessions.binding(a)
    const gate = deferred<SessionBinding>()
    const retain = ctx.sessions.retain
    let prepared!: SessionBinding
    t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
      const ref = retain(target, options)
      if (ref.sessionId !== child) return ref
      prepared = ref.binding
      return { ...ref, ready: gate.promise }
    })
    let active = true, navigated = false
    const flight = surface === 'home'
      ? openHomeSession(ctx.sessions, ctx.sessions.list.getSnapshot().byId[child]!, () => { navigated = true }, () => active)
      : openInboxSession(ctx.sessions, child, () => { navigated = true }, () => active)
    await flush()
    const outcome = flight.catch(error => error)
    if (failure) gate.reject(new Error('準備失敗'))
    else { active = false; gate.resolve(prepared) }
    await outcome
    assert.equal(navigated, false)
    assert.equal(ctx.sessions.binding(a), original)
    assert.equal(owner.state.getSnapshot().sessionId, a)
    assert.equal(ctx.sessions.binding(child), undefined)
  })
}

test('R4 同じ会話のopen失敗後にそのまま再選択できる', async t => {
  const ctx = fixture(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  ctx.mock.setSessionState(child, { openState: 'error', openError: { code: 'gateway/internal', message: '失敗', details: {} } })
  await assert.rejects(owner.select(address))
  ctx.mock.setSessionState(child, { openState: 'open', openError: null })
  assert.equal(await owner.select(address), true)
  assert.equal(ctx.sessions.retainInfo(child).getSnapshot().referenceCount, 1)
})

test('R4 子の読み直し後に同じ子を選ぶと新しい取得を行う', async t => {
  const ctx = fixture(); t.after(() => ctx.dispose())
  await conversationSelection(ctx.sessions).select(a)
  const row = ctx.sessions.list.getSnapshot().byId[child]!
  ctx.mock.setSessionState(child, { openState: 'error', openError: { code: 'gateway/internal', message: '失敗', details: {} } })
  await assert.rejects(openHomeSession(ctx.sessions, row, () => {}))
  ctx.mock.setSessionState(child, { openState: 'open', openError: null })
  await ctx.sessions.refreshProjections(a)
  let navigated = false
  await openHomeSession(ctx.sessions, row, () => { navigated = true })
  assert.equal(navigated, true)
  assert.ok(ctx.sessions.binding(child))
})

test('R5 pagehideで解放しpageshowでは現在のURLから復元する', async () => {
  const events = Object.assign(new EventTarget(), { location: { hash: '#/s/' + a } })
  const globals = globalThis as unknown as { window?: typeof events }
  const previous = globals.window
  globals.window = events
  const ctx = fixture()
  try {
    const owner = conversationSelection(ctx.sessions)
    await owner.select(a)
    events.dispatchEvent(new Event('pagehide'))
    assert.equal(ctx.sessions.binding(a), undefined)
    events.location.hash = '#/s/' + child
    events.dispatchEvent(new Event('pageshow'))
    await flush()
    assert.equal(owner.state.getSnapshot().sessionId, child)
    assert.ok(ctx.sessions.binding(child))
    owner.dispose()
    events.dispatchEvent(new Event('pageshow'))
    await flush()
    assert.equal(ctx.sessions.binding(child), undefined)
  } finally { ctx.dispose(); globals.window = previous }
})
