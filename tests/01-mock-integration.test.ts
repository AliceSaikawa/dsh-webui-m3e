import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { MockExtension } from '../web/src/dsh/mock/kit.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { HOME_MOCK_IDS } from '../web/src/features/home/mock.ts'
import { INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { buildInboxRows, countInbox } from '../web/src/features/inbox/model.ts'

async function featureExtensions(): Promise<MockExtension[]> {
  const root = new URL('../web/src/features/', import.meta.url)
  const sources = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${entry.name}/mock.ts`)
    .filter((source) => existsSync(new URL(source, root)))
    .sort()
  // Match the application's feature collector, including future feature mocks.
  return Promise.all(sources.map(async (source) => {
    const extension = await import(new URL(source, root).href) as MockExtension
    assert.equal(typeof extension.extendMock, 'function', source)
    return { ...extension, source }
  }))
}

test('全機能の実際の偽データでも no-workspace は全ワークスペースと会話を除く', async (t) => {
  const failures: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => { failures.push(args) })
  const extensions = await featureExtensions()
  const normal = createMockContext({ extensions })
  const empty = createMockContext({ extensions, scenario: 'empty' })
  const noWorkspace = createMockContext({ extensions, scenario: 'no-workspace' })
  try {
    const workspaceIds = normal.workspaces.list.getSnapshot().items.map((workspace) => workspace.workspaceId)
    assert.ok(workspaceIds.includes('ws-chat-check'))
    assert.ok(workspaceIds.includes('ws-trace-example'))
    assert.ok(normal.sessions.list.getSnapshot().ids.length > 7)
    assert.deepEqual(failures, [], 'すべての機能の偽データを登録できること')
    assert.deepEqual(empty.workspaces.list.getSnapshot().items.map((workspace) => workspace.workspaceId), workspaceIds)
    assert.ok(empty.workspaces.list.getSnapshot().items.every((workspace) => workspace.sessionIds.length === 0))
    assert.deepEqual(noWorkspace.workspaces.list.getSnapshot().items, [])
    for (const ctx of [empty, noWorkspace]) {
      assert.deepEqual(ctx.sessions.list.getSnapshot().ids, [])
      assert.deepEqual(ctx.sessions.list.getSnapshot().byId, {})
      assert.deepEqual(ctx.workspaces.list.getSnapshot().archivedSessionIds, [])
      for (const sessionId of normal.sessions.list.getSnapshot().ids) {
        assert.equal(ctx.sessions.binding(sessionId), undefined)
        assert.equal(ctx.sessions.scope(sessionId), undefined)
      }
    }
  } finally { normal.dispose(); empty.dispose(); noWorkspace.dispose() }
})

test('全機能を登録しても01の質問と未読完了はhomeシナリオだけに現れる', { timeout: 3000 }, async (t) => {
  const failures: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => { failures.push(args) })
  const extensions = await featureExtensions()
  const cases = [undefined, 'inbox', 'search-error', 'home'].map((scenario) => {
    const ctx = createMockContext({ extensions, scenario })
    const store = new InteractionStore()
    const dispose = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
    return { scenario, ctx, store, dispose }
  })
  try {
    // Include the old unconditional 500 ms request in the regression window.
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.deepEqual(failures, [], 'すべての機能の偽データを登録できること')
    const homeIds = new Set<string>(Object.values(HOME_MOCK_IDS))
    for (const { scenario, ctx, store } of cases) {
      const rows = buildInboxRows(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot(), Date.now())
      assert.deepEqual(rows.pending.filter((row) => homeIds.has(row.sessionId)).map((row) => row.sessionId), scenario === 'home' ? [HOME_MOCK_IDS.waiting] : [], `${scenario ?? '標準'} の01由来の要求`)
      assert.deepEqual(rows.completed.filter((row) => homeIds.has(row.sessionId)).map((row) => row.sessionId), scenario === 'home' ? [HOME_MOCK_IDS.completed] : [], `${scenario ?? '標準'} の01由来の未読完了`)
    }
    const inbox = cases.find((item) => item.scenario === 'inbox')!
    assert.deepEqual(inbox.store.getSnapshot().map((pending) => pending.sessionId).sort(), [INBOX_MOCK_IDS.approval, INBOX_MOCK_IDS.question, INBOX_MOCK_IDS.plan].sort())
    const inboxCompletedIds = new Set<string>([INBOX_MOCK_IDS.completed, INBOX_MOCK_IDS.otherCompleted])
    const before = buildInboxRows(inbox.store.getSnapshot(), inbox.ctx.sessions.list.getSnapshot(), inbox.ctx.workspaces.list.getSnapshot(), Date.now())
    const otherCompletedIds = new Set(before.completed.filter((row) => !inboxCompletedIds.has(row.sessionId)).map((row) => row.sessionId))
    assert.deepEqual(new Set(before.completed.filter((row) => inboxCompletedIds.has(row.sessionId)).map((row) => row.sessionId)), inboxCompletedIds)
    assert.equal(countInbox(inbox.store.getSnapshot(), inbox.ctx.sessions.list.getSnapshot()), 5 + otherCompletedIds.size, '06の5件に、その時点の他機能の完了件数を加える')
    t.diagnostic(`inbox の他機能の未読完了: ${otherCompletedIds.size} 件（${[...otherCompletedIds].join(', ') || 'なし'}）`)
    for (const pending of inbox.store.getSnapshot()) {
      if (pending.kind === 'approval') await pending.answer('allowed-once')
      else await pending.answer({ answers: pending.items.map((item) => ({ id: item.id, selected: [] })) })
    }
    for (const sessionId of inboxCompletedIds) inbox.ctx.sessions.open(sessionId)
    const remaining = buildInboxRows(inbox.store.getSnapshot(), inbox.ctx.sessions.list.getSnapshot(), inbox.ctx.workspaces.list.getSnapshot(), Date.now())
    assert.deepEqual(remaining.pending, [])
    assert.deepEqual(new Set(remaining.completed.map((row) => row.sessionId)), otherCompletedIds)
  } finally {
    for (const { dispose, ctx } of cases) { dispose(); ctx.dispose() }
  }
})
