import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  InteractionStore,
  isPlanReview,
  registerInteractionHandlers,
  type ApprovalHandler,
  type InteractionContext,
  type QuestionHandler,
} from '../web/src/dsh/interactions-store.ts'

test('承認と質問をセッション別に溜め、回答した要求だけを消す', async () => {
  const store = new InteractionStore()
  const approvalResult = store.requestApproval('session-a', { toolName: 'bash', callId: 'call-1', reason: '確認が必要です' })
  const questionResult = store.requestQuestion('session-b', { questions: [{ id: 'q1', question: '進めますか？' }] })
  const [approval, question] = store.getSnapshot()
  assert.equal(approval?.kind, 'approval')
  assert.equal(question?.kind, 'question')
  assert.notEqual(approval?.key, question?.key)
  if (approval?.kind !== 'approval' || question?.kind !== 'question') assert.fail('要求の型が一致しません')
  assert.equal(approval.sessionId, 'session-a')
  assert.equal(approval.callId, 'call-1')
  assert.equal(approval.reason, '確認が必要です')
  await approval.answer('allowed-once')
  assert.equal(await approvalResult, 'allowed-once')
  assert.deepEqual(store.getSnapshot(), [question])
  const answer = { answers: [{ id: 'q1', selected: [], custom: '進めてください' }] }
  await question.answer(answer)
  assert.deepEqual(await questionResult, answer)
  assert.deepEqual(store.getSnapshot(), [])
  await assert.rejects(approval.answer('rejected'), /終了/)
})

test('承認の取消はsignal.reasonを返し、遅れた回答を受け付けない', async () => {
  const store = new InteractionStore()
  const controller = new AbortController()
  const result = store.requestApproval('session-a', { toolName: 'bash', signal: controller.signal })
  const pending = store.getSnapshot()[0]
  const error = new Error('取り消し')
  const rejected = assert.rejects(result, (cause) => cause === error)
  controller.abort(error)
  await rejected
  assert.deepEqual(store.getSnapshot(), [])
  assert.equal(pending?.kind, 'approval')
  if (pending?.kind === 'approval') await assert.rejects(pending.answer('allowed-once'), /終了/)
})

test('質問の取消はDSHと同じASK_ABORTEDで拒否し、一覧から消す', async () => {
  const store = new InteractionStore()
  const controller = new AbortController()
  const result = store.requestQuestion('session-a', { questions: [{ id: 'q', question: '確認' }], signal: controller.signal })
  const rejected = assert.rejects(result, { name: 'UserQuestionError', code: 'ASK_ABORTED' })
  controller.abort()
  await rejected
  assert.deepEqual(store.getSnapshot(), [])
})

test('既に取り消された要求を表示せず、回答後のabortは影響しない', async () => {
  const store = new InteractionStore()
  const controller = new AbortController()
  controller.abort()
  let updates = 0
  store.subscribe(() => { updates += 1 })
  await assert.rejects(store.requestApproval('session-a', { toolName: 'bash', signal: controller.signal }))
  await assert.rejects(store.requestQuestion('session-a', { questions: [], signal: controller.signal }), { code: 'ASK_ABORTED' })
  assert.equal(updates, 0)
  const active = new AbortController()
  const result = store.requestApproval('session-a', { toolName: 'bash', signal: active.signal })
  const pending = store.getSnapshot()[0]
  if (pending?.kind !== 'approval') assert.fail('承認がありません')
  await pending.answer('rejected')
  active.abort()
  assert.equal(await result, 'rejected')
  assert.equal(updates, 2)
})

test('あとでにしても未回答のまま残り、開き直した会話の印だけを消す', async () => {
  const store = new InteractionStore()
  const firstResult = store.requestApproval('session-a', { toolName: 'bash' })
  const secondResult = store.requestApproval('session-b', { toolName: 'read_file' })
  const [first, second] = store.getSnapshot()
  assert.ok(first && second)
  store.defer(first.key)
  store.defer(second.key)
  assert.deepEqual(store.getSnapshot().map((item) => item.deferred), [true, true])
  store.resetDeferred('session-a')
  assert.deepEqual(store.getSnapshot().map((item) => item.deferred), [false, true])
  const unchanged = store.getSnapshot()
  store.resetDeferred('session-a')
  store.defer('missing')
  assert.equal(store.getSnapshot(), unchanged)
  if (first.kind !== 'approval' || second.kind !== 'approval') assert.fail('承認がありません')
  await first.answer('rejected')
  await second.answer('allowed-once')
  assert.deepEqual(await Promise.all([firstResult, secondResult]), ['rejected', 'allowed-once'])
})

test('複数の問いのどれかにプラン確認があれば、質問のまま判定できる', async () => {
  const store = new InteractionStore()
  const result = store.requestQuestion('session-a', { questions: [
    { id: 'q1', question: '対象' },
    { id: 'plan', question: 'このプランで進めますか？', detail: '# 作業計画', intent: { kind: 'plan-review', approve: '進める' } },
  ] })
  const pending = store.getSnapshot()[0]
  assert.ok(pending)
  assert.equal(pending.kind, 'question')
  assert.equal(isPlanReview(pending), true)
  if (pending.kind !== 'question') assert.fail('質問がありません')
  await pending.answer({ answers: [{ id: 'plan', selected: ['進める'] }] })
  await result
})

function fakeContext() {
  let approval: ApprovalHandler | undefined
  let question: QuestionHandler | undefined
  let registrations = 0
  let removals = 0
  const owner = {}
  const ctx: InteractionContext = {
    sessions: { scopeOf: (scope) => scope === owner ? 'session-a' : undefined },
    remote: {
      $on(event: string, handler: ApprovalHandler | QuestionHandler) {
        registrations += 1
        if (event === 'approval/request') approval = handler as ApprovalHandler
        else question = handler as QuestionHandler
        return () => { removals += 1 }
      },
    },
  }
  return { ctx, owner, approval: () => approval!, question: () => question!, registrations: () => registrations, removals: () => removals }
}

test('waterfallを一度だけ登録し、payload.agentでなくthisのscopeを解決する', async () => {
  const transport = fakeContext()
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(transport.ctx, store)
  assert.equal(registerInteractionHandlers(transport.ctx, store), dispose)
  assert.equal(transport.registrations(), 2)
  const result = transport.approval().call(transport.owner, { toolName: 'bash', agent: 'other' }, async () => 'unavailable')
  const pending = store.getSnapshot()[0]
  assert.equal(pending?.sessionId, 'session-a')
  if (pending?.kind !== 'approval') assert.fail('承認がありません')
  await pending.answer('allowed-once')
  assert.equal(await result, 'allowed-once')
  dispose()
  dispose()
  assert.equal(transport.removals(), 2)
})

test('scopeが不明なら次のwaterfallへ委譲し、要求を溜めない', async () => {
  const transport = fakeContext()
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(transport.ctx, store)
  assert.equal(await transport.approval().call({}, { toolName: 'bash' }, async () => 'unavailable'), 'unavailable')
  const answer = { answers: [{ id: 'q1', selected: ['進める'] }] }
  assert.deepEqual(await transport.question().call({}, { questions: [{ id: 'q1', question: '確認' }] }, async () => answer), answer)
  assert.deepEqual(store.getSnapshot(), [])
  dispose()
})

test('登録解除は未回答を終了させ、同じctxの再初期化を可能にする', async () => {
  const transport = fakeContext()
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(transport.ctx, store)
  const result = transport.question().call(transport.owner, { questions: [{ id: 'q1', question: '確認' }] }, async () => ({ answers: [] }))
  const rejected = assert.rejects(result, { code: 'ASK_ABORTED' })
  dispose()
  await rejected
  assert.deepEqual(store.getSnapshot(), [])
  registerInteractionHandlers(transport.ctx, store)()
  assert.equal(transport.registrations(), 4)
  assert.equal(transport.removals(), 4)
})
