import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { syncConversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { extendMock as inboxMock, INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { countInbox } from '../web/src/features/inbox/model.ts'
import { extendMock as searchMock } from '../web/src/features/search/mock.ts'
import { extendMock as toolsMock } from '../web/src/features/session-tools/mock.ts'
import { catalogEntries, childAddress } from '../web/src/features/session-tools/presentation.ts'
import { goalsRemoteOf, type GoalProjection } from '../web/src/features/session-tools/operations.ts'

test('06・07・09 の偽データを同時登録し、基準データ到着後の選択・対応待ち・検索・子の会話を保つ', { timeout: 5000 }, async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const ctx = createMockContext({ scenario: 'inbox', extensions: [
    { source: 'inbox/mock.ts', extendMock: inboxMock },
    { source: 'search/mock.ts', extendMock: searchMock },
    { source: 'session-tools/mock.ts', extendMock: toolsMock },
  ] })
  const pending = new InteractionStore()
  const stop = registerInteractionHandlers(ctx as unknown as InteractionContext, pending)
  try {
    await new Promise<void>((resolve) => {
      const unsubscribe = pending.subscribe(() => {
        if (pending.getSnapshot().length === 3) { unsubscribe(); resolve() }
      })
    })
    assert.equal(pending.getSnapshot().length, 3)
    const baseline = ctx.sessions.list.getSnapshot()
    const selected = INBOX_MOCK_IDS.approval
    ctx.mock.updateList((state) => { state.phase = 'pending'; state.ids = []; state.byId = {} })
    syncConversationSelection(ctx.sessions, selected, true)
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    assert.equal(countInbox(pending.getSnapshot(), ctx.sessions.list.getSnapshot()), 3)
    ctx.mock.updateList(() => baseline)
    syncConversationSelection(ctx.sessions, selected, true)
    assert.equal(ctx.sessions.list.getSnapshot().current, selected)
    const beforeRead = countInbox(pending.getSnapshot(), ctx.sessions.list.getSnapshot())
    syncConversationSelection(ctx.sessions, INBOX_MOCK_IDS.completed, true)
    assert.equal(countInbox(pending.getSnapshot(), ctx.sessions.list.getSnapshot()), beforeRead - 1)

    // Search lives outside the conversation and still sees the shared fixtures.
    syncConversationSelection(ctx.sessions, undefined, false)
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    const matches = unwrapRemoteResult(await ctx.sessions.search('承認', new AbortController().signal))
    assert.ok(matches.items.some((item) => item.sessionId === 'search-permissions'))

    const parent = MOCK_IDS.sessions.approval
    const child = catalogEntries(ctx.sessions.list.getSnapshot().subagentsByParent[parent]).find((item) => item.kind === 'child')
    if (!child || child.kind !== 'child') assert.fail('子の会話がありません。')
    const address = childAddress(parent, child)
    ctx.sessions.openSubagent(address)
    syncConversationSelection(ctx.sessions, child.id, true)
    assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
    syncConversationSelection(ctx.sessions, parent, true)
    const goals = goalsRemoteOf(ctx.remote.goals)!
    const goal = unwrapRemoteResult(await goals.get(parent))!
    const paused = unwrapRemoteResult(await goals.pause(parent, goal))
    const projection = ctx.sessions.binding(parent)!.session.projections.faceOf('goal').getSnapshot() as GoalProjection
    assert.equal(projection.goal.phase, paused.phase)
    assert.equal(paused.phase, 'paused')
    assert.equal(ctx.sessions.list.getSnapshot().current, parent)
    assert.equal(errors.mock.callCount(), 0)
  } finally {
    stop()
    ctx.dispose()
  }
})
