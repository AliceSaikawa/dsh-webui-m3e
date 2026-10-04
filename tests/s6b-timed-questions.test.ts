import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type UserQuestionsRemote, type PendingQuestion, type UserQuestionProjection } from '../web/src/dsh/interactions-store.ts'
import { continuedQuestionProjection, timedQuestionRequest, extendMock } from '../web/src/features/interactions/mock.ts'

const id = 'readme-review'
const questions = [{ id: 'q', question: '確認', options: [{ label: '進める' }] }]
const answer = { answers: [{ id: 'q', selected: ['進める'] }] }
const projected = (state: 'open' | 'continued'): UserQuestionProjection => ({ active: [{ callId: 'call', questions, state }], settled: [] })

function setup(options: { empty?: boolean; openingError?: boolean; remainingMs?: number } = {}) {
  const ctx = createMockContext()
  const store = new InteractionStore()
  let claimSignal: AbortSignal | undefined
  let disposed = 0, attached = 0
  let finish!: () => void
  const done = new Promise<IteratorResult<{ remainingMs: number }>>(resolve => { finish = () => resolve({ done: true, value: undefined }) })
  const remote: UserQuestionsRemote = {
    attachWait(sessionId, callId, signal) {
      assert.equal(sessionId, id); assert.equal(callId, 'call')
      attached++; claimSignal = signal
      signal?.addEventListener('abort', finish, { once: true })
      let opened = false
      return {
        dispose() { disposed++; signal?.removeEventListener('abort', finish); finish() },
        [Symbol.asyncIterator]() { return { next() {
          if (options.openingError) return Promise.reject(new Error('wait transport failed'))
          if (options.empty || opened) return options.empty ? Promise.resolve({ done: true as const, value: undefined }) : done
          opened = true
          return Promise.resolve({ done: false as const, value: { remainingMs: options.remainingMs ?? 60_000 } })
        } } },
      }
    },
    async answer() { return { ok: true, value: true } },
  }
  // Deliberate transport stub for store race tests; the namespace now belongs
  // to the controller, so do not attempt a duplicate feature registration.
  ctx.mock.patch('remote.userQuestions', remote)
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  return { ctx, store, remote, finish, stop, signal: () => claimSignal, attached: () => attached, disposed: () => disposed,
    async request(signal?: AbortSignal) { return ctx.mock.emit('user-questions/request', { agent: id, questions, wait: { callId: 'call', timed: true }, signal }) },
    dispose() { stop(); ctx.dispose() },
  }
}

test('S6B 非表示のtimed質問はopeningの残り時間で期限を迎えカードを残す', { timeout: 1000 }, async () => {
  const h = setup({ remainingMs: 20 })
  try {
    h.ctx.mock.setProjection(id, 'userQuestions', projected('open'))
    await assert.rejects(h.request(), { code: 'ASK_TIMED_OUT' })
    assert.equal(h.store.getSnapshot()[0]?.callId, 'call')
    h.finish()
    await tick()
    assert.equal(h.disposed(), 1)
  } finally { h.dispose() }
})

test('S6B 遅延した回答RPCはキュー取消で復帰した同じkeyのカードを消さない', async () => {
  const h = setup()
  try {
    h.ctx.mock.setProjection(id, 'userQuestions', projected('continued'))
    const pending = h.store.getSnapshot()[0] as PendingQuestion
    let finish!: () => void
    h.remote.answer = () => new Promise(resolve => { finish = () => resolve({ ok: true, value: true }) })
    const submitted = pending.answer(answer)
    h.ctx.mock.setProjection(id, 'inbox', { 'next-step': [{ source: { kind: 'user-question-reply', callId: 'call' } }], 'next-turn': [] })
    assert.deepEqual(h.store.getSnapshot(), [])
    h.ctx.mock.setProjection(id, 'inbox', { 'next-step': [], 'next-turn': [] })
    const restored = h.store.getSnapshot()[0] as PendingQuestion
    assert.equal(restored.key, pending.key)
    assert.notEqual(restored, pending)
    finish()
    await submitted
    assert.equal(h.store.getSnapshot()[0], restored)
    h.remote.answer = async () => {
      h.ctx.mock.setProjection(id, 'userQuestions', { active: [], settled: [{ callId: 'call', answers: answer.answers }] })
      return { ok: true, value: true }
    }
    await restored.answer(answer)
    assert.deepEqual(h.store.getSnapshot(), [])
  } finally { h.dispose() }
})

test('S6B 表示中の残り時間を保ち、あとで・画面離脱から残期間だけ再開する', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  for (const departure of ['defer', 'unmount']) {
    const h = setup({ remainingMs: 50 })
    try {
      h.ctx.mock.setProjection(id, 'userQuestions', projected('open'))
      let expired = false
      const reply = assert.rejects(h.request().catch(error => { expired = true; throw error }), { code: 'ASK_TIMED_OUT' })
      await tick()
      t.mock.timers.tick(20)
      const key = h.store.getSnapshot()[0]!.key
      const leave = h.store.presentQuestion(key)
      t.mock.timers.tick(1000)
      await tick()
      assert.equal(expired, false, 'visible card holds the remaining 30 ms')
      if (departure === 'defer') h.store.defer(key)
      else leave()
      t.mock.timers.tick(29)
      await tick()
      assert.equal(expired, false)
      t.mock.timers.tick(1)
      await reply
      if (departure === 'defer') leave()
      h.finish()
    } finally { h.dispose() }
  }
})

test('S6B timedは待機streamを取得し、回答の配送が終わるまでclaimを解放しない', async () => {
  const h = setup()
  try {
    h.ctx.mock.setProjection(id, 'userQuestions', projected('open'))
    const reply = h.request()
    await tick()
    assert.equal(h.attached(), 1)
    const pending = h.store.getSnapshot()[0] as PendingQuestion
    assert.equal(pending.callId, 'call')
    h.store.defer(pending.key)
    assert.equal(h.store.getSnapshot()[0]?.deferred, true)
    await pending.answer(answer)
    assert.deepEqual(await reply, answer)
    assert.equal(h.store.getSnapshot()[0]?.key, pending.key, 'the projection owns removal after delivery')
    h.ctx.mock.setProjection(id, 'userQuestions', { active: [], settled: [{ callId: 'call', answers: answer.answers }] })
    assert.deepEqual(h.store.getSnapshot(), [])
    assert.equal(h.signal()?.aborted, false, 'RPC reply precedes claim release')
    assert.equal(h.disposed(), 0)
    h.finish() // The Host has received the answer and ends its business stream.
    await tick()
    assert.equal(h.signal()?.aborted, true)
    assert.equal(h.disposed(), 1)
  } finally { h.dispose() }
})

test('S6B timedのabort後も同じカードと保留印を維持し、continuedへ切り替えてRPCで答える', async () => {
  const h = setup()
  try {
    h.ctx.mock.setProjection(id, 'userQuestions', projected('open'))
    const controller = new AbortController()
    const reply = h.request(controller.signal)
    await tick()
    const pending = h.store.getSnapshot()[0] as PendingQuestion
    h.store.defer(pending.key)
    const rejected = assert.rejects(reply, { code: 'ASK_ABORTED' })
    controller.abort()
    await rejected
    assert.equal(h.store.getSnapshot()[0]?.key, pending.key)
    h.ctx.mock.setProjection(id, 'userQuestions', projected('continued'))
    assert.equal(h.store.getSnapshot().length, 1)
    assert.equal(h.store.getSnapshot()[0]?.deferred, true)
    let received: unknown
    h.remote.answer = async (...args) => {
      received = args
      h.ctx.mock.setProjection(id, 'userQuestions', { active: [], settled: [{ callId: 'call', answers: answer.answers }] })
      return { ok: true, value: true }
    }
    await pending.answer(answer) // The already-mounted sheet's original carrier.
    assert.deepEqual(received, [id, 'call', answer])
    assert.deepEqual(h.store.getSnapshot(), [])
  } finally { h.dispose() }
})

test('S6B continuedの再取得・対応待ち・queuedの除外と破棄後の復帰・settledを投影に従わせる', async () => {
  const h = setup()
  try {
    h.ctx.mock.setProjection(id, 'userQuestions', projected('continued'))
    assert.equal(h.store.getSnapshot().length, 1, 'unbound list projection restores the inbox')
    const key = h.store.getSnapshot()[0]!.key
    const reference = h.ctx.sessions.retain(id, { source: 'm3e.test' })
    await reference.ready
    assert.equal(h.store.getSnapshot()[0]?.key, key)
    h.store.defer(key)
    reference.release()
    assert.equal(h.store.getSnapshot()[0]?.key, key, 'leaving a conversation preserves its inbox card')
    assert.equal(h.store.getSnapshot()[0]?.deferred, true)
    h.ctx.mock.setProjection(id, 'inbox', { 'next-step': [{ source: { kind: 'user-question-reply', callId: 'call' } }], 'next-turn': [] })
    assert.deepEqual(h.store.getSnapshot(), [])
    h.ctx.mock.setProjection(id, 'inbox', { 'next-step': [], 'next-turn': [] })
    assert.equal(h.store.getSnapshot()[0]?.key, key)
    h.remote.answer = async () => ({ ok: false, error: { code: 'gateway/internal', message: '再試行', details: {} } })
    await assert.rejects((h.store.getSnapshot()[0] as PendingQuestion).answer(answer), /再試行/)
    assert.equal(h.store.getSnapshot().length, 1)
    h.remote.answer = async () => ({ ok: true, value: false })
    await assert.rejects((h.store.getSnapshot()[0] as PendingQuestion).answer(answer), { code: 'ASK_ABORTED' })
    assert.equal(h.store.getSnapshot().length, 1)
    const second = h.ctx.sessions.retain(id, { source: 'm3e.test' })
    await second.ready
    h.ctx.mock.setProjection(id, 'userQuestions', { active: [], settled: [{ callId: 'call', answers: answer.answers }] })
    assert.deepEqual(h.store.getSnapshot(), [])
    second.release()
    // Host cancellation may publish removal before aborting the waterfall.
    h.ctx.mock.setProjection(id, 'userQuestions', projected('open'))
    const controller = new AbortController()
    const live = assert.rejects(h.request(controller.signal), { code: 'ASK_ABORTED' })
    await tick()
    h.ctx.mock.setProjection(id, 'userQuestions', { active: [], settled: [] })
    controller.abort()
    await live
    assert.deepEqual(h.store.getSnapshot(), [])
  } finally { h.dispose() }
})

test('S6B claimが取得できない・失敗・disposeの全経路でstreamと要求を残さない', async () => {
  for (const options of [{ empty: true }, { openingError: true }, {}]) {
    const h = setup(options)
    try {
      const result = h.request()
      const finished = options.empty ? result : assert.rejects(result)
      await tick()
      if (!options.empty && !options.openingError) h.stop()
      await finished
      await tick()
      assert.deepEqual(h.store.getSnapshot(), [])
      assert.equal(h.signal()?.aborted, true)
      assert.equal(h.disposed(), 1)
      h.ctx.mock.setProjection(id, 'userQuestions', projected('continued'))
      h.stop()
      h.ctx.mock.setProjection(id, 'userQuestions', projected('continued'))
      assert.deepEqual(h.store.getSnapshot(), [], 'teardown removes projection subscriptions')
    } finally { h.dispose() }
  }
})

test('S6B 質問fixtureはtimedの識別子とcontinued投影を共有し全問への回答でsettledになる', async () => {
  const request = timedQuestionRequest()
  assert.deepEqual(request.wait, { callId: '05-timed-question', timed: true })
  assert.deepEqual(request.questions, continuedQuestionProjection.active[0]?.questions)
  const ctx = createMockContext({ scenario: 'question-continued', extensions: [{ extendMock }] })
  const store = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    const pending = store.getSnapshot()[0] as PendingQuestion
    assert.equal(pending.callId, request.wait.callId)
    await assert.rejects(pending.answer({ answers: [] }), /BAD_ANSWER/)
    const answers = { answers: request.questions.map(item => ({ id: item.id, selected: [item.options![0]!.label] })) }
    await pending.answer(answers)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(store.getSnapshot(), [])
    assert.deepEqual(ctx.mock.getProjection('05-db-choice', 'userQuestions'), { active: [], settled: [{ callId: request.wait.callId, ...answers }] })
  } finally { stop(); ctx.dispose() }
})
