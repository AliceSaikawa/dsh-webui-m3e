import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { createMockContext, type MockContext, type MockExtension } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { buildInboxRows, countInbox } from '../web/src/features/inbox/model.ts'

async function featureExtensions(): Promise<MockExtension[]> {
  const root = new URL('../web/src/features/', import.meta.url)
  const sources = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${entry.name}/mock.ts`)
    .filter((source) => existsSync(new URL(source, root)))
    .sort()
  // Use the application's sorted feature registration order, including future mocks.
  return Promise.all(sources.map(async (source) => {
    const extension = await import(new URL(source, root).href) as MockExtension
    assert.equal(typeof extension.extendMock, 'function', source)
    return { ...extension, source }
  }))
}

function observe(ctx: MockContext) {
  const store = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  return {
    ctx,
    store,
    rows: () => buildInboxRows(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot(), Date.now()),
    count: () => countInbox(store.getSnapshot(), ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot().archivedSessionIds),
    dispose() { stop(); ctx.dispose() },
  }
}

test('全機能の inbox シナリオで06の5件だけを回答・既読にすると、他機能だけの対照と一致する', { timeout: 5000 }, async (t) => {
  const failures: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => { failures.push(args) })
  const extensions = await featureExtensions()
  assert.ok(extensions.some((extension) => extension.source === 'inbox/mock.ts'))
  const withoutInbox = extensions.map((extension) => extension.source === 'inbox/mock.ts'
    ? { source: extension.source, extendMock: (kit) => kit.scenario('inbox', () => {}) } satisfies MockExtension
    : extension)
  const baseline = observe(createMockContext({ scenario: 'inbox', extensions: withoutInbox }))
  const integrated = observe(createMockContext({ scenario: 'inbox', extensions }))
  const inboxIds: ReadonlySet<string> = new Set(Object.values(INBOX_MOCK_IDS))
  const otherRows = (fixture: ReturnType<typeof observe>) => {
    const rows = fixture.rows()
    return {
      pending: rows.pending.filter((row) => !inboxIds.has(row.sessionId))
        .map((row) => [row.sessionId, row.icon, row.description]).sort(),
      completed: rows.completed.filter((row) => !inboxIds.has(row.sessionId)).map((row) => row.sessionId).sort(),
    }
  }
  try {
    // The integrated home fixture may emit a question after 500 ms.
    await nextTurn(550)
    assert.deepEqual(failures, [], 'すべての機能の偽データを登録できること')
    const rows = integrated.rows()
    const ownPending = rows.pending.filter((row) => inboxIds.has(row.sessionId))
    const ownCompleted = rows.completed.filter((row) => inboxIds.has(row.sessionId))
    assert.deepEqual(ownPending.map((row) => [row.sessionId, row.icon]), [
      [INBOX_MOCK_IDS.approval, 'terminal'],
      [INBOX_MOCK_IDS.question, 'help'],
      [INBOX_MOCK_IDS.plan, 'checklist'],
    ])
    assert.deepEqual(ownCompleted.map((row) => row.sessionId), [INBOX_MOCK_IDS.completed, INBOX_MOCK_IDS.otherCompleted])
    assert.deepEqual(ownCompleted.map((row) => row.workspaceName), ['画面の開発', '調査ノート'])
    assert.deepEqual(otherRows(integrated), otherRows(baseline))
    const otherCount = baseline.count()
    assert.equal(integrated.count(), otherCount + 5)
    t.diagnostic(`統合直後: ${integrated.count()}件、06を登録しない対照: ${otherCount}件、06由来: 5件`)

    let remaining = 5
    for (const row of ownPending) {
      const interaction = row.pending
      if (interaction.kind === 'approval') await interaction.answer('allowed-once')
      else await interaction.answer({ answers: interaction.items.map((item) => ({ id: item.id, selected: [item.options![0]!.label] })) })
      assert.equal(integrated.count(), otherCount + --remaining)
      assert.equal(integrated.ctx.sessions.list.getSnapshot().current, undefined, '対応待ちへの回答では会話を選択しない')
      assert.deepEqual(otherRows(integrated), otherRows(baseline))
    }
    for (const row of ownCompleted) {
      integrated.ctx.sessions.open(row.sessionId)
      assert.equal(integrated.ctx.sessions.list.getSnapshot().current, row.sessionId)
      assert.equal(integrated.ctx.sessions.list.getSnapshot().byId[row.sessionId]?.completed, false)
      assert.equal(integrated.count(), otherCount + --remaining)
      assert.deepEqual(otherRows(integrated), otherRows(baseline))
    }
    assert.equal(remaining, 0)
    assert.equal(integrated.count(), otherCount)
    assert.ok(integrated.rows().pending.every((row) => !inboxIds.has(row.sessionId)))
    assert.ok(integrated.rows().completed.every((row) => !inboxIds.has(row.sessionId)))
    assert.deepEqual(failures, [])
  } finally { baseline.dispose(); integrated.dispose() }
})
