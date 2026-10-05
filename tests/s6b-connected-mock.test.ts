import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type PendingQuestion } from '../web/src/dsh/interactions-store.ts'
import type { MockQuestionProjection, MockUserQuestionsRemote } from '../web/src/dsh/mock/questions.ts'
import type { InboxState } from '../web/src/dsh/services.ts'
import * as composer from '../web/src/features/composer/mock.ts'
import * as settings from '../web/src/features/settings/mock.ts'
import * as search from '../web/src/features/search/mock.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import { validateFixtureV4 } from './helpers/s6b-v4.ts'

const id = 'readme-review', questions = [{ id: 'q', question: '確認しますか', options: [{ label: 'はい' }] }]
const answer = { answers: [{ id: 'q', selected: ['はい'] }] }
function setup() {
  const ctx = createMockContext(), store = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  return { ctx, store, ask: () => ctx.mock.emitTimedQuestion(id, { callId: 'connected', questions, timeoutMs: 50 }),
    projection: () => ctx.mock.getProjection<MockQuestionProjection>(id, 'userQuestions')!,
    card: () => store.getSnapshot()[0] as PendingQuestion,
    dispose() { stop(); ctx.dispose() } }
}

test('S6B 接続済みmockは表示中の質問をHost期限後も保持しwaterfallへ回答を返す', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const h = setup(); t.after(() => h.dispose())
  let ended = false
  const reply = h.ask().then(value => { ended = true; return value })
  await tick()
  const leave = h.store.presentQuestion(h.card().key)
  t.mock.timers.tick(500); await tick()
  assert.equal(ended, false); assert.equal(h.projection().active[0]?.state, 'open')
  await h.card().answer(answer)
  assert.deepEqual(await reply, answer)
  assert.deepEqual(h.projection(), { active: [], settled: [{ callId: 'connected', answers: answer.answers }] })
  leave()
})

for (const departure of ['defer', 'leave', 'behind'] as const) test(`S6B 接続済みmock ${departure}の質問は期限後にcontinuedとなりRPC回答を記録する`, { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const h = setup(); t.after(() => h.dispose())
  const reply = h.ask(); await tick()
  if (departure !== 'behind') {
    const leave = h.store.presentQuestion(h.card().key)
    t.mock.timers.tick(500); await tick()
    if (departure === 'defer') h.store.defer(h.card().key)
    leave()
  }
  t.mock.timers.tick(49); await tick(); assert.equal(h.projection().active[0]?.state, 'open')
  t.mock.timers.tick(1); await tick()
  assert.deepEqual(await reply, { pending: true, callId: 'connected' })
  assert.equal(h.projection().active[0]?.state, 'continued')
  await h.card().answer(answer)
  assert.equal(h.projection().settled.length, 0, 'RPC acceptance alone does not settle')
  assert.deepEqual(h.store.getSnapshot(), [], 'queued reply suppresses the card')
  t.mock.timers.tick(0); await tick()
  assert.deepEqual(h.projection(), { active: [], settled: [{ callId: 'connected', answers: answer.answers }] })
  const record = h.ctx.mock.getRecords(id).at(-1)!
  assert.equal(record.type, 'user/message')
  assert.deepEqual((record.data as any).source, { kind: 'user-question-reply', callId: 'connected', outcome: 'answered' })
  assert.deepEqual(JSON.parse((record.data as any).content[0].text).answers, answer.answers)
  validateFixtureV4(h.ctx.mock.getRecords(id))
})

test('S6B 接続済みmockは遅延RPC中の待機列取消でカードを復帰させ、答え直せる', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const h = setup(); t.after(() => h.dispose())
  const reply = h.ask(); await tick(); t.mock.timers.tick(50); await tick(); await reply
  h.ctx.mock.appendEvent(id, 'turn/start', { turn: 2 }); h.ctx.mock.appendEvent(id, 'step/start', { turn: 2, step: 1 })
  h.ctx.mock.setSessionState(id, { running: true })
  const face = (await h.ctx.sessions.retain(id, { source: 'test' }).ready).session
  const remote = h.ctx.remote.userQuestions as MockUserQuestionsRemote
  const original = remote.answer.bind(remote)
  let finish!: () => void
  remote.answer = async (...args) => { const result = await original(...args); await new Promise<void>(resolve => { finish = resolve }); return result }
  const old = h.card(), submitted = old.answer(answer)
  await tick()
  const queued = h.ctx.mock.getProjection<InboxState>(id, 'inbox')!['next-step']
  assert.equal(queued.length, 1); assert.deepEqual(h.store.getSnapshot(), [])
  const duplicate = await original(id, 'connected', answer)
  assert.ok(!duplicate.ok); assert.match(duplicate.error.message, /REPLY_QUEUED/)
  assert.equal((await face.updateQueue(queued[0]!.id, { kind: 'remove' })).ok, true)
  const restored = h.card(); assert.equal(restored.key, old.key); assert.notEqual(restored, old)
  finish(); await submitted
  assert.equal(h.card(), restored)
  remote.answer = original
  await restored.answer(answer)
  assert.equal(h.ctx.mock.getProjection<InboxState>(id, 'inbox')!['next-step'].length, 1)
  // Finishing the next model call admits the queued reply.
  const generation = h.ctx.mock.streamAssistant(id, '', { chunkMs: 0 })
  await generation
  assert.deepEqual(h.projection(), { active: [], settled: [{ callId: 'connected', answers: answer.answers }] })
  assert.deepEqual(h.store.getSnapshot(), [])
  validateFixtureV4(h.ctx.mock.getRecords(id))
})

test('S6B 回答受付後にAgentが終了したら、未取り込みの返信をsettledにしない', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const h = setup(); t.after(() => h.dispose())
  const reply = h.ask(); await tick(); t.mock.timers.tick(50); await tick(); await reply
  await h.card().answer(answer)
  h.ctx.mock.setAgentAvailable(id, false)
  t.mock.timers.tick(0); await tick()
  assert.equal(h.projection().active[0]?.state, 'continued')
  assert.deepEqual(h.projection().settled, [])
  assert.equal(h.ctx.mock.getRecords(id).some(row => row.type === 'user/message' && (row.data as any).source?.kind === 'user-question-reply'), false)
})

test('S6B 動的commandとmodel/header/assistantの記録・投影・設定既定値を一つにつなぐ', { timeout: 2000 }, async () => {
  const ctx = createMockContext({ extensions: [composer, settings] })
  try {
    const face = (await ctx.sessions.retain(id, { source: 'test' }).ready).session
    assert.equal((await face.command('/plan off')).ok, true)
    const command = ctx.mock.getRecords(id).slice(-2)
    assert.deepEqual((command[0]!.data as any).source, { kind: 'user' })
    assert.equal((command[1]!.data as any).sourceEventSeq, undefined)
    const api = composerApi(ctx.remote), selected = await api.selectModel(id, { provider: 'ollama', model: 'local' })
    await tick()
    const described = await (ctx.remote.settings as settings.SettingsMockRemote).describe()
    assert.ok(described.ok)
    assert.deepEqual(described.value.namespaces.find(row => row.ns === 'agent-default-model')?.value, selected)
    assert.deepEqual((await api.modelCatalog()).default, selected)
    assert.deepEqual(ctx.mock.getRecords(id).at(-1)?.data, selected)
    assert.equal(ctx.mock.getRecords(id).at(-1)?.type, 'model/selection')
    const generate = ctx.mock.streamAssistant(id, '確認', { chunkMs: 0 })
    const newer = await api.selectModel(id, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'low' })
    await generate
    const records = ctx.mock.getRecords(id)
    const header = [...records].reverse().find(event => event.type === 'request/header')!
    assert.deepEqual((header.data as any).header.config, selected)
    assert.deepEqual(([...records].reverse().find(event => event.type === 'assistant/message')!.data as any).message.source, { kind: 'model', provider: selected.provider, model: selected.model })
    assert.deepEqual(ctx.mock.getProjection(id, 'modelSelection'), { lastUsed: selected, next: newer })
    // Replaying an older in-flight request must not consume a different intent.
    ctx.mock.appendEvent(id, 'turn/start', { turn: 3 })
    ctx.mock.appendEvent(id, 'request/header', { header: { config: selected }, reason: 'resume' })
    assert.deepEqual(ctx.mock.getProjection(id, 'modelSelection'), { lastUsed: selected, next: newer })
    ctx.mock.appendEvent(id, 'turn/end', { turn: 3, reason: { kind: 'completed' } })
    validateFixtureV4(ctx.mock.getRecords(id))
  } finally { ctx.dispose() }
})

test('S6B 機能を登録した検索もイベント境界・最強一致・置換済みsurfaceを共有する', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ extensions: [search] }); t.after(() => ctx.dispose())
  const message = (seq: number, text: string) => ({ type: 'user/message', seq, time: seq, surfaceOp: 'append' as const, data: { id: `q${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  ctx.mock.addSession({ id: 'search-boundary', displayTitle: '確認', cwd: '/mock', blank: false, running: false, updatedAt: 1 }, [message(0, 'split-left'), message(1, 'right-split'), message(2, 'match one'), message(3, 'match match best')])
  ctx.mock.addSession({ id: 'search-replaced', displayTitle: '確認', cwd: '/mock', blank: false, running: false, updatedAt: 100 }, [message(0, 'match removed'), { ...message(1, 'replacement'), surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0] }])
  const query = async (text: string) => { const reply = ctx.sessions.search(text, new AbortController().signal); t.mock.timers.tick(400); return reply }
  assert.deepEqual(await query('split-left\nright-split'), { ok: true, value: { items: [], hasMore: false } })
  assert.deepEqual(await query('match'), { ok: true, value: { items: [{ sessionId: 'search-boundary', snippet: 'match match best' }], hasMore: false } })
})
