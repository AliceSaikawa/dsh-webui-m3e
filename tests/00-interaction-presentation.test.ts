import assert from 'node:assert/strict'
import test from 'node:test'
import { InteractionStore } from '../web/src/dsh/interactions-store.ts'
import { shouldHideComposer } from '../web/src/dsh/interaction-presentation.ts'

test('承認をトレース閲覧のために保留しても、回答するまで入力欄を隠す', async () => {
  const store = new InteractionStore()
  const response = store.requestApproval('a', { toolName: 'bash' })
  try {
    const approval = store.getSnapshot()[0]!
    assert.equal(shouldHideComposer('a', store.getSnapshot(), []), true)
    store.defer(approval.key)
    assert.equal(store.getSnapshot()[0]!.deferred, true)
    assert.equal(shouldHideComposer('a', store.getSnapshot(), []), true)
    if (approval.kind !== 'approval') assert.fail('承認ではありません。')
    await approval.answer('allowed-once')
    assert.equal(await response, 'allowed-once')
    assert.equal(shouldHideComposer('a', store.getSnapshot(), []), false)
  } finally {
    store.dispose()
    await Promise.allSettled([response])
  }
})

for (const plan of [false, true]) {
  test(`${plan ? 'プラン' : '質問'}の「あとで」はシートを閉じると入力できる`, async () => {
    const store = new InteractionStore()
    const response = store.requestQuestion('a', { questions: [{ id: 'q', question: '確認しますか？', ...(plan ? { intent: { kind: 'plan-review' as const, approve: '進める' } } : {}) }] })
    try {
      const question = store.getSnapshot()[0]!
      assert.equal(shouldHideComposer('a', store.getSnapshot(), []), true)
      store.defer(question.key)
      assert.equal(shouldHideComposer('a', store.getSnapshot(), []), false)
      assert.equal(shouldHideComposer('a', store.getSnapshot(), [{ sessionId: 'a', interactionKey: question.key }]), true)
      if (question.kind !== 'question') assert.fail('質問ではありません。')
      await question.answer({ answers: [] })
      await response
      assert.equal(shouldHideComposer('a', store.getSnapshot(), []), false)
    } finally {
      store.dispose()
      await Promise.allSettled([response])
    }
  })
}

test('保留中の承認が取り消されたら入力欄を戻す', async () => {
  const store = new InteractionStore()
  const controller = new AbortController()
  const response = store.requestApproval('a', { toolName: 'bash', signal: controller.signal })
  const rejected = assert.rejects(response, /取り消し/)
  try {
    store.defer(store.getSnapshot()[0]!.key)
    assert.equal(shouldHideComposer('a', store.getSnapshot(), []), true)
    controller.abort(new Error('取り消しました。'))
    await rejected
    assert.equal(shouldHideComposer('a', store.getSnapshot(), []), false)
  } finally {
    store.dispose()
    await Promise.allSettled([response, rejected])
  }
})

test('他の会話や通常のシートは対象外で、質問と混在しても未回答の承認を優先する', () => {
  const question = { sessionId: 'a', kind: 'question' as const, deferred: true }
  const approval = { sessionId: 'a', kind: 'approval' as const, deferred: true }
  const other = { sessionId: 'b', kind: 'approval' as const, deferred: false }
  assert.equal(shouldHideComposer('a', [question, approval, other], []), true)
  assert.equal(shouldHideComposer('a', [question, other], []), false)
  assert.equal(shouldHideComposer('a', [other], [{ sessionId: 'b', interactionKey: 'other' }, { sessionId: 'a' }]), false)
  assert.equal(shouldHideComposer('a', [], [{ sessionId: 'a', interactionKey: 'closing' }]), true)
  assert.equal(shouldHideComposer('a', [], []), false)
})
