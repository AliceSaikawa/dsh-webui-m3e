import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { InteractionStore, isPlanReview, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'

type Register = (event: string, handler: (payload: unknown, next: () => Promise<unknown>) => unknown) => () => void

test('初期シナリオの遅延なしの承認・質問・プランが登録後の対応待ちに入り、回答を返す', async () => {
  const responses: Promise<unknown>[] = []
  const ctx = createMockContext({ scenario: 'immediate', extensions: [{ extendMock(kit) {
    kit.scenario('immediate', () => {
      kit.setSessionState(MOCK_IDS.sessions.readme, { running: true })
      responses.push(kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash', callId: 'startup-approval' }))
      responses.push(kit.emit('user-questions/request', { agent: MOCK_IDS.sessions.readme, questions: [{ id: 'question', question: '対象を選んでください。' }] }))
      responses.push(kit.emit('user-questions/request', { agent: MOCK_IDS.sessions.approval, questions: [{ id: 'plan', question: 'このプランで進めますか？', intent: { kind: 'plan-review', approve: '進める' } }] }))
    })
  } }] })
  const store = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    assert.equal(ctx.sessions.retain(MOCK_IDS.sessions.readme, { source: 'm3e.test' }).binding.session.getSnapshot().running, true)
    await Promise.resolve()
    const pending = store.getSnapshot()
    assert.equal(pending.length, 3)
    assert.deepEqual(pending.map((request) => request.sessionId), [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval])
    const [approval, question, plan] = pending
    assert.equal(approval?.kind, 'approval')
    assert.equal(question?.kind, 'question')
    assert.equal(isPlanReview(plan!), true)
    if (approval?.kind !== 'approval' || question?.kind !== 'question' || plan?.kind !== 'question') assert.fail('要求の型が一致しません。')
    const answer = { answers: [{ id: 'question', selected: ['対象 A'] }] }
    const planAnswer = { answers: [{ id: 'plan', selected: ['進める'] }] }
    await approval.answer('allowed-once')
    await question.answer(answer)
    await plan.answer(planAnswer)
    assert.deepEqual(await Promise.all(responses), ['allowed-once', answer, planAnswer])
    assert.equal(store.getSnapshot().length, 0)
  } finally {
    stop()
    ctx.dispose()
    await Promise.allSettled(responses)
  }
})

test('初期イベントも登録済みの waterfall 全体へ一度だけ渡す', async () => {
  let response: Promise<unknown> | undefined
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    response = kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash' })
  } }] })
  const calls: string[] = []
  const on = ctx.remote.$on as Register
  const stopFirst = on('approval/request', async (_payload, next) => { calls.push('first'); return next() })
  const stopSecond = on('approval/request', () => { calls.push('second'); return 'allowed-once' })
  try {
    assert.equal(await response, 'allowed-once')
    assert.deepEqual(calls, ['first', 'second'])
    stopFirst()
    stopSecond()
    const stopLater = on('approval/request', () => { calls.push('later'); return 'rejected' })
    await Promise.resolve()
    assert.deepEqual(calls, ['first', 'second'])
    stopLater()
  } finally { ctx.dispose() }
})

test('配送前に登録解除した初期イベントと通常の未登録イベントを後から再生しない', async () => {
  let startup: Promise<unknown> | undefined
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    startup = kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash' })
  } }] })
  const on = ctx.remote.$on as Register
  let calls = 0
  const stop = on('approval/request', () => { calls++; return 'allowed-once' })
  stop()
  try {
    assert.equal(await startup, undefined)
    assert.equal(await ctx.mock.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash' }), undefined)
    on('approval/request', () => { calls++; return 'allowed-once' })
    await Promise.resolve()
    assert.equal(calls, 0)
  } finally { ctx.dispose() }
})

test('初期イベントの配送前の中断は承認・質問の契約どおり終了し、対応待ちを残さない', async () => {
  const controller = new AbortController()
  const reason = new Error('初期要求を取り消しました。')
  const responses: Promise<unknown>[] = []
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    responses.push(kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash', signal: controller.signal }))
    responses.push(kit.emit('user-questions/request', { agent: MOCK_IDS.sessions.readme, questions: [{ id: 'q', question: '確認しますか？' }], signal: controller.signal }))
  } }] })
  const rejectedApproval = assert.rejects(responses[0]!, (error) => error === reason)
  const rejectedQuestion = assert.rejects(responses[1]!, { name: 'UserQuestionError', code: 'ASK_ABORTED' })
  controller.abort(reason)
  const store = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    await Promise.all([rejectedApproval, rejectedQuestion])
    assert.equal(store.getSnapshot().length, 0)
  } finally {
    stop()
    ctx.dispose()
  }
})

for (const registered of [false, true]) {
  for (const cleanup of ['dispose', 'remove-session'] as const) {
    test(`初期イベントは${registered ? '登録後の配送前' : '登録前'}の ${cleanup} で破棄され、再作成しても復活しない`, async () => {
      let response: Promise<unknown> | undefined
      const ctx = createMockContext({ extensions: [{ extendMock(kit) {
        response = kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash' })
      } }] })
      const on = ctx.remote.$on as Register
      let calls = 0
      const handler = () => { calls++; return 'allowed-once' }
      if (registered) on('approval/request', handler)
      if (cleanup === 'dispose') ctx.dispose()
      else {
        const summary = ctx.sessions.list.getSnapshot().byId[MOCK_IDS.sessions.readme]!
        ctx.mock.removeSession(summary.id)
        ctx.mock.addSession(summary, [])
      }
      try {
        assert.equal(await response, undefined)
        if (!registered) on('approval/request', handler)
        await Promise.resolve()
        assert.equal(calls, 0)
      } finally { ctx.dispose() }
    })
  }
}
