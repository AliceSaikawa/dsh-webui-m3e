import assert from 'node:assert/strict'
import test from 'node:test'
import { openConversationSession } from '../web/src/dsh/session-navigation.ts'
import { sessionAccess } from '../web/src/dsh/session-access.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { SubagentAddress, SubagentCatalogSnapshot } from '../web/src/dsh/services.ts'

const address: SubagentAddress = { parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' }
const ready = (mode: string = 'one-shot'): SubagentCatalogSnapshot => ({ state: 'ready', error: null, entries: [{ kind: 'child', id: 'child', mode }] })
function setup() {
  const ctx = createMockContext({ extensions: [] })
  for (const id of ['parent', 'other', 'child']) {
    ctx.mock.addSession({ id, displayTitle: id, running: false, blank: false, updatedAt: 1, ...(id === 'child' ? { origin: 'subagent' as const, parentId: 'parent' } : {}) }, [])
  }
  return ctx
}
function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('子の URL を直接開くとカタログを取得し、通常選択でなく子として選ぶ', async (t) => {
  const ctx = setup()
  const refresh = t.mock.method(ctx.sessions, 'refreshSubagents', async (parent: string) => {
    assert.equal(parent, 'parent')
    ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready() } })
  })
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  try {
    const face = ctx.sessions.binding('child')!.session
    assert.equal(face.getSnapshot().subagent, null)
    assert.equal(sessionAccess(ctx.sessions.list.getSnapshot().byId.child, face.getSnapshot()).canCompose, false)
    assert.equal(await openConversationSession(ctx.sessions, 'child'), true)
    assert.equal(refresh.mock.callCount(), 1)
    assert.equal(select.mock.callCount(), 1)
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
    assert.equal(sessionAccess(ctx.sessions.list.getSnapshot().byId.child, face.getSnapshot()).mode, 'one-shot')
    await openConversationSession(ctx.sessions, 'child')
    assert.equal(select.mock.callCount(), 1)
  } finally { ctx.dispose() }
})

test('親だけを持つ分岐は通常選択し、同じ会話の二重選択をしない', async (t) => {
  const ctx = setup()
  ctx.mock.updateList(state => { state.byId.other = { ...state.byId.other!, parentId: 'parent' } })
  const open = t.mock.method(ctx.sessions, 'open')
  const refresh = t.mock.method(ctx.sessions, 'refreshSubagents')
  try {
    await openConversationSession(ctx.sessions, 'other')
    await openConversationSession(ctx.sessions, 'other')
    assert.equal(open.mock.callCount(), 1)
    assert.equal(refresh.mock.callCount(), 0)
  } finally { ctx.dispose() }
})

test('09 が先に子を選択した後の URL 同期では再選択しない', async (t) => {
  const ctx = setup()
  ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready('continuable') } })
  ctx.sessions.openSubagent({ ...address, mode: 'continuable' })
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  try {
    await openConversationSession(ctx.sessions, 'child')
    assert.equal(select.mock.callCount(), 0)
    assert.equal(sessionAccess(ctx.sessions.list.getSnapshot().byId.child, ctx.sessions.binding('child')!.session.getSnapshot()).canCompose, true)
  } finally { ctx.dispose() }
})

test('以前に通常選択した子を、カタログのアドレスで選び直す', async (t) => {
  const ctx = setup()
  ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready() } })
  ctx.sessions.open('child')
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  try {
    assert.equal(ctx.sessions.list.getSnapshot().current, 'child')
    assert.equal(ctx.sessions.list.getSnapshot().currentAddress, undefined)
    await openConversationSession(ctx.sessions, 'child')
    assert.equal(select.mock.callCount(), 1)
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
  } finally { ctx.dispose() }
})

test('一覧にない子も保持済みの親情報からカタログを照合して開く', async (t) => {
  const ctx = setup()
  ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready() } })
  ctx.sessions.openSubagent(address)
  ctx.sessions.clear()
  ctx.mock.updateList(state => { delete state.byId.child })
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  try {
    await openConversationSession(ctx.sessions, 'child')
    assert.equal(select.mock.callCount(), 1)
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
  } finally { ctx.dispose() }
})

test('同じ子への同時要求はカタログ取得も選択も一度だけ行う', async (t) => {
  const ctx = setup()
  const gate = deferred()
  const refresh = t.mock.method(ctx.sessions, 'refreshSubagents', () => gate.promise)
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  try {
    const first = openConversationSession(ctx.sessions, 'child')
    const second = openConversationSession(ctx.sessions, 'child')
    ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready() } })
    gate.resolve()
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.equal(refresh.mock.callCount(), 1)
    assert.equal(select.mock.callCount(), 1)
  } finally { gate.resolve(); ctx.dispose() }
})

test('同じ親の取得を共有し、取消済みの選択は後着しても会話を上書きしない', async (t) => {
  const ctx = setup()
  const gate = deferred()
  const refresh = t.mock.method(ctx.sessions, 'refreshSubagents', () => gate.promise)
  const select = t.mock.method(ctx.sessions, 'openSubagent')
  let active = true
  try {
    const first = openConversationSession(ctx.sessions, 'child', () => active)
    const second = openConversationSession(ctx.sessions, 'child')
    active = false
    ctx.mock.updateList(state => { state.subagentsByParent = { parent: ready() } })
    gate.resolve()
    assert.equal(await first, false)
    assert.equal(await second, true)
    assert.equal(refresh.mock.callCount(), 1)
    assert.equal(select.mock.callCount(), 1)
  } finally { gate.resolve(); ctx.dispose() }
})

test('取得中に別の会話へ離れたら取得成功も失敗もその会話を妨げない', async (t) => {
  for (const fail of [false, true]) {
    const ctx = setup()
    const gate = deferred()
    t.mock.method(ctx.sessions, 'refreshSubagents', () => gate.promise)
    let active = true
    try {
      const pending = openConversationSession(ctx.sessions, 'child', () => active)
      active = false
      await openConversationSession(ctx.sessions, 'other')
      if (fail) gate.reject(new Error('通信できませんでした。'))
      else gate.resolve()
      assert.equal(await pending, false)
      assert.equal(ctx.sessions.list.getSnapshot().current, 'other')
    } finally { gate.resolve(); ctx.dispose() }
  }
})

test('未知 mode・別の種類・親の変更・取得エラーでは子も通常会話も選ばない', async (t) => {
  const cases: Array<{ catalog: SubagentCatalogSnapshot; changeParent?: boolean }> = [
    { catalog: ready('unknown') },
    { catalog: { state: 'ready', error: null, entries: [{ kind: 'job', id: 'child', mode: 'continuable' }] } },
    { catalog: ready(), changeParent: true },
    { catalog: { state: 'error', error: { code: 'gateway/internal', message: '失敗', details: {} }, entries: [] } },
  ]
  for (const item of cases) {
    const ctx = setup()
    t.mock.method(ctx.sessions, 'refreshSubagents', async () => {
      ctx.mock.updateList(state => {
        state.subagentsByParent = { parent: item.catalog }
        if (item.changeParent) state.byId.child = { ...state.byId.child!, parentId: 'other' }
      })
    })
    const open = t.mock.method(ctx.sessions, 'open')
    const child = t.mock.method(ctx.sessions, 'openSubagent')
    try {
      await assert.rejects(openConversationSession(ctx.sessions, 'child'))
      assert.equal(open.mock.callCount(), 0)
      assert.equal(child.mock.callCount(), 0)
    } finally { ctx.dispose() }
  }
})

test('取得の例外を呼び出し元へ返し、次回は取得をやり直せる', async (t) => {
  const ctx = setup()
  const failure = new Error('通信できませんでした。')
  const refresh = t.mock.method(ctx.sessions, 'refreshSubagents', async () => { throw failure })
  try {
    await assert.rejects(openConversationSession(ctx.sessions, 'child'), failure)
    await assert.rejects(openConversationSession(ctx.sessions, 'child'), failure)
    assert.equal(refresh.mock.callCount(), 2)
    await assert.rejects(openConversationSession(ctx.sessions, 'missing'), /見つかりません/)
    assert.equal(await openConversationSession(ctx.sessions, 'missing', () => false), false)
  } finally { ctx.dispose() }
})
