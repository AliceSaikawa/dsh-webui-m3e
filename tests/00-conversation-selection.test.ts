import assert from 'node:assert/strict'
import test from 'node:test'
import { canSelectConversation, conversationSessionId, syncConversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { createMockContext, type MockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'

function syncPath(ctx: MockContext, pathname: string) {
  const id = conversationSessionId(pathname)
  const face = id === undefined ? undefined : ctx.sessions.binding(id)?.session
  syncConversationSelection(ctx.sessions, id, !!face && !face.getSnapshot().removed)
}

function observeSelection(ctx: MockContext): string[] {
  const calls: string[] = []
  const open = ctx.sessions.open
  const clear = ctx.sessions.clear
  ctx.mock.patch('sessions.open', (id: string) => { calls.push(`open:${id}`); open(id) })
  ctx.mock.patch('sessions.clear', () => { calls.push('clear'); clear() })
  return calls
}

test('取得に失敗した有効な会話も A → B → A の再入場で選び直す', () => {
  const ctx = createMockContext()
  const a = MOCK_IDS.sessions.readme
  const b = MOCK_IDS.sessions.approval
  const opened: string[] = []
  const originalOpen = ctx.sessions.open
  ctx.mock.patch('sessions.open', (id: string) => { opened.push(id); originalOpen(id) })
  const failure = { code: 'transport/disconnected', message: '接続エラー', details: {} }
  ctx.mock.setSessionState(a, { openState: 'error', openError: failure })
  try {
    syncPath(ctx, `/s/${a}`)
    assert.equal(ctx.sessions.list.getSnapshot().current, a)
    syncPath(ctx, `/s/${b}`)
    syncPath(ctx, `/s/${a}`)
    assert.deepEqual(opened, [a, b, a])
    assert.equal(ctx.sessions.list.getSnapshot().current, a)
    // Mock errors are deliberate scenarios, not a reason to skip real selection.
    assert.equal(ctx.sessions.binding(a)!.session.getSnapshot().openState, 'error')
    assert.deepEqual(ctx.sessions.binding(a)!.session.getSnapshot().openError, failure)
    syncPath(ctx, '/')
  } finally { ctx.dispose() }
})

test('会話から離れると選択を解除し、その後の完了は未読になる', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  try {
    syncPath(ctx, `/s/${id}`)
    const generating = ctx.mock.streamAssistant(id, '会話を離れた後に完了します', { chunkMs: 0 })
    syncPath(ctx, '/')
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    await generating
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
    syncPath(ctx, '/')
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
  } finally { ctx.dispose() }
})

test('会話を選択したまま応答が完了しても未読の完了印を付けない', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  try {
    syncPath(ctx, `/s/${id}`)
    await ctx.mock.streamAssistant(id, '確認中に完了します', { chunkMs: 0 })
    assert.equal(ctx.sessions.list.getSnapshot().current, id)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.running, false)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, false)
    syncPath(ctx, '/')
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, false)
  } finally { ctx.dispose() }
})

test('未読の会話が再び生成を始めると前回の完了印を解除する', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  try {
    await ctx.mock.streamAssistant(id, '初回', { chunkMs: 0 })
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
    const next = ctx.mock.streamAssistant(id, '再開', { chunkMs: 0 })
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.running, true)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, false)
    await next
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.running, false)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
  } finally { ctx.dispose() }
})

test('存在しない・削除済みの会話は選ばず、会話以外に移ってから解除する', () => {
  const ctx = createMockContext()
  const a = MOCK_IDS.sessions.readme
  const b = MOCK_IDS.sessions.approval
  try {
    syncPath(ctx, `/s/${a}`)
    syncPath(ctx, `/s/${b}`)
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    syncPath(ctx, '/s/missing')
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    ctx.mock.removeSession(a)
    syncPath(ctx, `/s/${a}`)
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    syncPath(ctx, '/inbox')
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
  } finally { ctx.dispose() }
})

test('URL の先頭の会話 ID だけを解釈し、補助画面とエンコードされた ID に対応する', () => {
  for (const page of ['', '/trace', '/files', '/file', '/jobs', '/subagents', '/goal', '/files/deeper']) {
    assert.equal(conversationSessionId(`/s/a%2Fb${page}`), 'a/b')
  }
  for (const path of ['/', '/search', '/inbox', '/settings', '/new', '/s/', '/s/%ZZ', '/sessions/a']) {
    assert.equal(conversationSessionId(path), undefined)
  }
})

test('チャット・トレース・09 補助画面の往復では再選択せず、完了印を付けない', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  const calls = observeSelection(ctx)
  try {
    syncPath(ctx, `/s/${id}`)
    const scope = ctx.sessions.scope(id)
    const goal = ctx.sessions.binding(id)!.session.projections.faceOf('goal')
    for (const page of ['trace', 'files', 'file', 'jobs', 'subagents', 'goal']) {
      syncPath(ctx, `/s/${id}/${page}`)
      assert.equal(ctx.sessions.scope(id), scope)
      assert.equal(ctx.sessions.list.getSnapshot().current, id)
    }
    ctx.mock.setProjection(id, 'goal', { status: 'active' })
    assert.deepEqual(goal.getSnapshot(), { status: 'active' })
    await ctx.mock.streamAssistant(id, '完了', { chunkMs: 0 })
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, false)
    syncPath(ctx, `/s/${id}`)
    assert.deepEqual(calls, [`open:${id}`])
    syncPath(ctx, '/settings')
    assert.deepEqual(calls, [`open:${id}`, 'clear'])
  } finally { ctx.dispose() }
})

test('起動時に会話外で残った選択は一覧が ready になってから一度だけ解除する', () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  ctx.sessions.open(id)
  ctx.mock.updateList((state) => { state.phase = 'pending' })
  const calls = observeSelection(ctx)
  try {
    syncPath(ctx, '/')
    assert.equal(ctx.sessions.list.getSnapshot().current, id)
    assert.deepEqual(calls, [])
    ctx.mock.updateList((state) => { state.phase = 'ready' })
    syncPath(ctx, '/')
    syncPath(ctx, '/')
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    assert.deepEqual(calls, ['clear'])
    // A restored selection can also arrive after the first ready render.
    ctx.sessions.open(id)
    syncPath(ctx, '/search')
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    assert.deepEqual(calls, ['clear', `open:${id}`, 'clear'])
  } finally { ctx.dispose() }
})

test('openSubagent 後の移動や face の同等な入れ替えでは open を重ねない', () => {
  const ctx = createMockContext()
  const parentSessionId = MOCK_IDS.sessions.readme
  const childSessionId = 'selected-child'
  try {
    ctx.mock.addSession({ id: childSessionId, parentId: parentSessionId, origin: 'subagent', displayTitle: '子の会話', running: false, blank: false, updatedAt: 0 }, [])
    ctx.mock.updateList((state) => {
      state.subagentsByParent = { [parentSessionId]: { state: 'ready', error: null, entries: [{ kind: 'child', id: childSessionId, mode: 'continuable' }] } }
    })
    const address = { parentSessionId, childSessionId, mode: 'continuable' } as const
    ctx.sessions.openSubagent(address)
    const calls = observeSelection(ctx)
    syncPath(ctx, `/s/${childSessionId}`)
    const face = ctx.sessions.binding(childSessionId)!.session
    for (const replacement of [{ ...face }, { ...face }]) {
      syncConversationSelection(ctx.sessions, childSessionId, !replacement.getSnapshot().removed)
    }
    syncPath(ctx, `/s/${childSessionId}/goal`)
    assert.deepEqual(calls, [])
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
  } finally { ctx.dispose() }
})

test('補助画面への直接アクセスでも、会話が開けるようになった時点で選択する', () => {
  const ctx = createMockContext()
  const id = conversationSessionId(`/s/${MOCK_IDS.sessions.readme}/goal`)!
  const calls = observeSelection(ctx)
  try {
    ctx.mock.updateList((state) => { state.phase = 'pending' })
    syncConversationSelection(ctx.sessions, id, false)
    assert.deepEqual(calls, [])
    ctx.mock.updateList((state) => { state.phase = 'ready' })
    syncConversationSelection(ctx.sessions, id, true)
    syncConversationSelection(ctx.sessions, id, true)
    assert.deepEqual(calls, [`open:${id}`])
  } finally { ctx.dispose() }
})

test('承認から scope だけ先に作られても基準データを待ち、ready 後に一度だけ開く', () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  const baseline = ctx.sessions.list.getSnapshot()
  const calls: string[] = []
  const open = ctx.sessions.open
  ctx.mock.patch('sessions.open', (sessionId: string) => {
    calls.push(sessionId)
    if (!ctx.sessions.list.getSnapshot().byId[sessionId]) throw new Error('一覧に存在しない会話です。')
    open(sessionId)
  })
  try {
    ctx.mock.updateList((state) => { state.phase = 'pending'; state.ids = []; state.byId = {} })
    assert.ok(ctx.sessions.scope(id))
    assert.equal(ctx.sessions.binding(id)!.session.getSnapshot().removed, false)
    syncPath(ctx, `/s/${id}`)
    syncPath(ctx, `/s/${id}/goal`)
    assert.deepEqual(calls, [])
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    ctx.mock.updateList(() => ({ ...baseline, phase: 'ready' }))
    syncPath(ctx, `/s/${id}`)
    syncPath(ctx, `/s/${id}/trace`)
    syncPath(ctx, `/s/${id}/goal`)
    assert.deepEqual(calls, [id])
    assert.equal(ctx.sessions.list.getSnapshot().current, id)
  } finally { ctx.dispose() }
})

test('ready 後の選択例外はログに残して外へ投げず、別の会話への移動を妨げない', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const ctx = createMockContext()
  const a = MOCK_IDS.sessions.readme
  const b = MOCK_IDS.sessions.approval
  const failure = new Error('基準データから会話が消えました。')
  const open = ctx.sessions.open
  ctx.mock.patch('sessions.open', (id: string) => { if (id === a) throw failure; open(id) })
  try {
    assert.doesNotThrow(() => syncPath(ctx, `/s/${a}`))
    assert.equal(errors.mock.callCount(), 1)
    assert.ok(String(errors.mock.calls[0]!.arguments[0]).includes(a))
    assert.equal(errors.mock.calls[0]!.arguments[1], failure)
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    syncPath(ctx, `/s/${b}/files`)
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    assert.equal(errors.mock.callCount(), 1)
  } finally { ctx.dispose() }
})

test('初回取得が pending のままでも、作った会話が一覧にあれば一度だけ開く', async () => {
  const ctx = createMockContext()
  const calls = observeSelection(ctx)
  try {
    ctx.mock.updateList((state) => { state.phase = 'pending' })
    const id = await ctx.sessions.create({ sessionId: 'created-before-baseline' })
    assert.equal(ctx.sessions.list.getSnapshot().phase, 'pending')
    assert.ok(ctx.sessions.list.getSnapshot().byId[id])
    syncPath(ctx, `/s/${id}`)
    syncPath(ctx, `/s/${id}/trace`)
    assert.deepEqual(calls, [`open:${id}`])
    assert.equal(ctx.sessions.list.getSnapshot().current, id)
  } finally { ctx.dispose() }
})

test('phase と face が変わらなくても一覧への追加で選択可能になり、その時点で開く', () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  const summary = ctx.sessions.list.getSnapshot().byId[id]!
  const face = ctx.sessions.binding(id)!.session
  const calls = observeSelection(ctx)
  try {
    ctx.mock.updateList((state) => { state.phase = 'pending'; state.ids = []; state.byId = {} })
    assert.equal(canSelectConversation(ctx.sessions, id), false)
    syncPath(ctx, `/s/${id}`)
    assert.deepEqual(calls, [])
    ctx.mock.updateList((state) => { state.ids = [id]; state.byId = { [id]: summary } })
    assert.equal(ctx.sessions.list.getSnapshot().phase, 'pending')
    assert.equal(ctx.sessions.binding(id)!.session, face)
    assert.equal(canSelectConversation(ctx.sessions, id), true)
    syncPath(ctx, `/s/${id}`)
    assert.deepEqual(calls, [`open:${id}`])
  } finally { ctx.dispose() }
})

test('一覧にない子も保存されたアドレスがあれば pending のまま開ける', () => {
  const ctx = createMockContext()
  const parentSessionId = MOCK_IDS.sessions.readme
  const childSessionId = 'known-child-before-baseline'
  const address = { parentSessionId, childSessionId, mode: 'continuable' as const }
  const calls = observeSelection(ctx)
  try {
    ctx.mock.addSession({ id: childSessionId, parentId: parentSessionId, origin: 'subagent', displayTitle: '子の会話', running: false, blank: false, updatedAt: 0 }, [])
    ctx.mock.updateList((state) => { state.phase = 'pending'; state.ids = []; state.byId = {} })
    assert.equal(canSelectConversation(ctx.sessions, childSessionId), false)
    syncPath(ctx, `/s/${childSessionId}/goal`)
    assert.deepEqual(calls, [])
    ctx.mock.setSessionState(childSessionId, { subagent: { address, parentAvailable: true } })
    assert.equal(canSelectConversation(ctx.sessions, childSessionId), true)
    assert.deepEqual(ctx.sessions.subagentAddress(childSessionId), address)
    syncPath(ctx, `/s/${childSessionId}/goal`)
    syncPath(ctx, `/s/${childSessionId}`)
    assert.deepEqual(calls, [`open:${childSessionId}`])
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
  } finally { ctx.dispose() }
})

for (const phase of ['pending', 'ready'] as const) {
  test(`${phase} でも scope だけでは一覧・アドレスにない会話を open しない`, (t) => {
    const errors = t.mock.method(console, 'error', () => {})
    const ctx = createMockContext()
    const id = MOCK_IDS.sessions.readme
    const calls: string[] = []
    ctx.mock.patch('sessions.open', (sessionId: string) => { calls.push(sessionId); throw new Error('選択できない ID です。') })
    try {
      ctx.mock.updateList((state) => { state.phase = phase; state.ids = []; state.byId = {} })
      assert.ok(ctx.sessions.scope(id))
      assert.equal(ctx.sessions.subagentAddress(id), undefined)
      syncPath(ctx, `/s/${id}`)
      assert.deepEqual(calls, [])
      assert.equal(errors.mock.callCount(), 0)
      assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    } finally { ctx.dispose() }
  })
}
