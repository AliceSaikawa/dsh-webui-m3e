import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { MockExtension } from '../web/src/dsh/mock/kit.ts'

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
