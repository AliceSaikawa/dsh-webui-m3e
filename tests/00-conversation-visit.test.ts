import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationSessionId, createConversationVisitTracker } from '../web/src/dsh/conversation-selection.ts'
import { InteractionStore } from '../web/src/dsh/interactions-store.ts'

test('同じ会話の補助画面・タブ・一覧往復では訪問を切り替えない', () => {
  const reset: string[] = []
  const visit = createConversationVisitTracker(id => { reset.push(id) })
  for (const route of ['/s/a', '/s/a/trace', '/s/a/files', '/s/a/file', '/s/a/jobs', '/s/a/subagents', '/s/a/goal', '/', '/inbox', '/s/a']) {
    visit(conversationSessionId(route))
  }
  assert.deepEqual(reset, [])
  visit('b')
  visit(undefined)
  visit('a')
  visit('a')
  assert.deepEqual(reset, ['a'])
  visit('b')
  assert.deepEqual(reset, ['a', 'b'])
})

for (const plan of [false, true]) {
  test(`${plan ? 'プラン' : '質問'}の保留は別の会話を訪ねて戻るまで維持する`, async () => {
    const store = new InteractionStore()
    const response = store.requestQuestion('a', { questions: [{ id: 'q', question: '確認しますか？', ...(plan ? { intent: { kind: 'plan-review' as const, approve: '進める' } } : {}) }] })
    const visit = createConversationVisitTracker(id => { store.resetDeferred(id) })
    try {
      visit('a')
      store.defer(store.getSnapshot()[0]!.key)
      visit(conversationSessionId('/s/a/files'))
      visit(conversationSessionId('/s/a'))
      visit(conversationSessionId('/'))
      visit(conversationSessionId('/s/a'))
      assert.equal(store.getSnapshot()[0]!.deferred, true)
      visit('b')
      assert.equal(store.getSnapshot()[0]!.deferred, true)
      visit('a')
      assert.equal(store.getSnapshot()[0]!.deferred, false)
    } finally {
      store.dispose()
      await Promise.allSettled([response])
    }
  })
}
