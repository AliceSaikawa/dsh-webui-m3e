import assert from 'node:assert/strict'
import test from 'node:test'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { initializeInteractions } from '../web/src/dsh/interactions.ts'

const continued = { active: [{ callId: 'call-a', state: 'continued', questions: [{ id: 'q', question: '続けますか' }] }], settled: [] }

/** Session "a" subscribes and copies a card; session "b" then fails to subscribe its inbox face. */
function fixture(options: { failing: boolean }) {
  let handlers = 0, subscriptions = 0
  const face = (snapshot: unknown) => ({ getSnapshot: () => snapshot, subscribe: () => { subscriptions++; return () => { subscriptions-- } } })
  const broken = { getSnapshot: () => ({}), subscribe: () => { throw new Error('fixture subscribe failure') } }
  const byId: Record<string, object> = options.failing ? { a: {}, b: {} } : { a: {} }
  const ctx = { remote: { $on: () => { handlers++; return () => { handlers-- } } }, sessions: {
    scopeOf() {}, list: { getSnapshot: () => ({ byId }), subscribe: () => { subscriptions++; return () => { subscriptions-- } } },
    binding: (id: string) => ({ session: { projections: { faceOf: (name: string) => name === 'userQuestions'
      ? face(id === 'a' ? continued : { active: [], settled: [] })
      : id === 'b' ? broken : face({}) } } }),
  } } as unknown as InteractionContext
  return { ctx, handlers: () => handlers, subscriptions: () => subscriptions }
}

function countDisposals(t: test.TestContext): () => number {
  let calls = 0
  const original = InteractionStore.prototype.dispose
  InteractionStore.prototype.dispose = function(this: InteractionStore) { calls++; original.call(this) }
  t.after(() => { InteractionStore.prototype.dispose = original })
  return () => calls
}

test('登録が失敗しても呼び出し元のstoreをdisposeせず、自分が加えたものだけを戻す', async (t) => {
  const disposals = countDisposals(t)
  const store = new InteractionStore()
  const earlier = store.requestApproval('a', { toolName: 'bash' })
  const before = store.getSnapshot()
  const { ctx, handlers, subscriptions } = fixture({ failing: true })
  assert.throws(() => registerInteractionHandlers(ctx, store), /fixture subscribe failure/)
  assert.equal(disposals(), 0, '呼び出し元のstoreはdisposeしない')
  assert.equal(handlers(), 0)
  assert.equal(subscriptions(), 0)
  assert.deepEqual(store.getSnapshot(), before, '失敗までに写した質問カードを戻し、既存の要求は残す')
  const pending = store.getSnapshot()[0]
  if (pending?.kind !== 'approval') assert.fail('既存の承認がありません')
  await pending.answer('allowed-once')
  assert.equal(await earlier, 'allowed-once')

  // The same store can still be registered after the owner fixes the context.
  const fixed = fixture({ failing: false })
  const stop = registerInteractionHandlers(fixed.ctx, store)
  assert.equal(store.getSnapshot().length, 1)
  stop(); stop()
  assert.equal(disposals(), 1, '登録の解除は一度だけdisposeする')
  assert.equal(fixed.handlers(), 0)
  assert.equal(fixed.subscriptions(), 0)
  assert.deepEqual(store.getSnapshot(), [])
})

test('画面の起動での登録失敗は所有者が一度だけdisposeし、購読を残さない', (t) => {
  const disposals = countDisposals(t)
  const failing = fixture({ failing: true })
  assert.throws(() => initializeInteractions(failing.ctx), /fixture subscribe failure/)
  assert.equal(disposals(), 1, '所有者のstoreを一度だけdisposeする')
  assert.equal(failing.handlers(), 0)
  assert.equal(failing.subscriptions(), 0)

  const working = fixture({ failing: false })
  const stop = initializeInteractions(working.ctx)
  assert.equal(working.handlers(), 2)
  stop(); stop()
  assert.equal(disposals(), 2)
  assert.equal(working.handlers(), 0)
  assert.equal(working.subscriptions(), 0)
})
