import assert from 'node:assert/strict'
import test from 'node:test'
import { enterConversation } from '../web/src/dsh/conversation-selection.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'

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
    const leaveA = enterConversation(ctx.sessions, a, ctx.sessions.binding(a)!.session)
    assert.equal(ctx.sessions.list.getSnapshot().current, a)
    leaveA()
    const leaveB = enterConversation(ctx.sessions, b, ctx.sessions.binding(b)!.session)
    leaveB()
    const leaveAgain = enterConversation(ctx.sessions, a, ctx.sessions.binding(a)!.session)
    assert.deepEqual(opened, [a, b, a])
    assert.equal(ctx.sessions.list.getSnapshot().current, a)
    // Mock errors are deliberate scenarios, not a reason to skip real selection.
    assert.equal(ctx.sessions.binding(a)!.session.getSnapshot().openState, 'error')
    assert.deepEqual(ctx.sessions.binding(a)!.session.getSnapshot().openError, failure)
    leaveAgain()
  } finally { ctx.dispose() }
})

test('会話から離れると選択を解除し、その後の完了は未読になる', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  try {
    const leave = enterConversation(ctx.sessions, id, ctx.sessions.binding(id)!.session)
    const generating = ctx.mock.streamAssistant(id, '会話を離れた後に完了します', { chunkMs: 0 })
    leave()
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    await generating
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
    leave()
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, true)
  } finally { ctx.dispose() }
})

test('会話を選択したまま応答が完了しても未読の完了印を付けない', async () => {
  const ctx = createMockContext()
  const id = MOCK_IDS.sessions.readme
  try {
    const leave = enterConversation(ctx.sessions, id, ctx.sessions.binding(id)!.session)
    await ctx.mock.streamAssistant(id, '確認中に完了します', { chunkMs: 0 })
    assert.equal(ctx.sessions.list.getSnapshot().current, id)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.running, false)
    assert.equal(ctx.sessions.list.getSnapshot().byId[id]?.completed, false)
    leave()
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

test('存在しない・削除済みの会話は選ばず、新しい選択を古い cleanup が解除しない', () => {
  const ctx = createMockContext()
  const a = MOCK_IDS.sessions.readme
  const b = MOCK_IDS.sessions.approval
  try {
    const leaveA = enterConversation(ctx.sessions, a, ctx.sessions.binding(a)!.session)
    ctx.sessions.open(b)
    leaveA()
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    enterConversation(ctx.sessions, 'missing', undefined)()
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
    const removed = ctx.sessions.binding(a)!.session
    ctx.mock.removeSession(a)
    enterConversation(ctx.sessions, a, removed)()
    assert.equal(ctx.sessions.list.getSnapshot().current, b)
  } finally { ctx.dispose() }
})
