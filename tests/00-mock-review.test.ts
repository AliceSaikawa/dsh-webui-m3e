import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { queueFromInbox } from '../web/src/dsh/inbox.ts'
import type { InboxState } from '../web/src/dsh/services.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS, sharedSessions, sharedWorkspaces } from '../web/src/dsh/mock/fixtures.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'

for (const child of [false, true]) {
  test(`${child ? '子' : '通常'}の会話を選択すると完了印が消え、その後の更新でも復活しない`, async () => {
    const ctx = createMockContext()
    const sessionId = child ? 'completed-child' : 'completed-session'
    const parentSessionId = MOCK_IDS.sessions.readme
    try {
      ctx.mock.addSession({ id: sessionId, displayTitle: '完了した会話', running: true, blank: false, updatedAt: 0, ...(child ? { parentId: parentSessionId, origin: 'subagent' as const } : {}) }, [])
      ctx.mock.addSession({ id: 'other-completed', displayTitle: '別の完了した会話', running: true, blank: false, updatedAt: 0 }, [])
      ctx.mock.setSessionState(sessionId, { running: false })
      ctx.mock.setSessionState('other-completed', { running: false })
      if (child) {
        ctx.mock.updateList((state) => {
          state.projectionsBySession = { [parentSessionId]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: sessionId, mode: 'continuable', label: '子', createdAt: 0 }] } } }
        })
        await conversationSelection(ctx.sessions).select({ parentSessionId, childSessionId: sessionId, mode: 'continuable' })
      } else await conversationSelection(ctx.sessions).select(sessionId)
      assert.equal(completionStatus(ctx).getSnapshot().byId[sessionId]?.completionUnread, false)
      assert.equal(completionStatus(ctx).getSnapshot().byId['other-completed']?.completionUnread, true)
      assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, sessionId)
      ctx.mock.setProjection(sessionId, 'plan', { active: true, pending: false })
      assert.equal(completionStatus(ctx).getSnapshot().byId[sessionId]?.completionUnread, false)
      await ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.rename('既読の会話')
      assert.equal(completionStatus(ctx).getSnapshot().byId[sessionId]?.completionUnread, false)
      await conversationSelection(ctx.sessions).select(undefined)
      await conversationSelection(ctx.sessions).select(sessionId)
      assert.equal(completionStatus(ctx).getSnapshot().byId[sessionId]?.completionUnread, false)
    } finally { ctx.dispose() }
  })

  test(`${child ? '子' : '通常'}の会話を選択しても設定済みの open error を上書きしない`, async () => {
    const ctx = createMockContext()
    const sessionId = child ? 'failed-child' : MOCK_IDS.sessions.readme
    const error = { code: 'mock/open-failed', message: '会話を開けません。', details: {} }
    try {
      if (child) {
        ctx.mock.addSession({ id: sessionId, parentId: MOCK_IDS.sessions.readme, origin: 'subagent', displayTitle: '子の会話', running: true, blank: false, updatedAt: 0 }, [])
        ctx.mock.updateList((state) => {
          state.projectionsBySession = { [MOCK_IDS.sessions.readme]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: sessionId, mode: 'one-shot', createdAt: 0 }] } } }
        })
      }
      ctx.mock.setSessionState(sessionId, { openState: 'error', openError: error })
      await assert.rejects(conversationSelection(ctx.sessions).select(child ? { parentSessionId: MOCK_IDS.sessions.readme, childSessionId: sessionId, mode: 'one-shot' } : sessionId))
      assert.equal(ctx.sessions.retainInfo(sessionId).getSnapshot().referenceCount, 0)
      assert.equal(ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.getSnapshot().openState, 'error')
      assert.deepEqual(ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.getSnapshot().openError, error)
    } finally { ctx.dispose() }
  })
}

test('存在しない待機列項目は実物と同じエラーコードと itemId を返す', async () => {
  const ctx = createMockContext()
  try {
    const session = ctx.sessions.retain(MOCK_IDS.sessions.approval, { source: 'm3e.test' }).binding.session
    await session.prompt([{ type: 'text', text: '待機中の入力' }], 'queue')
    const queue = queueFromInbox(session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined)
    const result = await session.updateQueue('missing-item', { kind: 'remove' })
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('存在しない項目への操作が成功しています。')
    assert.equal(result.error.code, 'session/queue-item-not-found')
    assert.deepEqual(result.error.details, { itemId: 'missing-item' })
    assert.deepEqual(queueFromInbox(session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined), queue)
  } finally { ctx.dispose() }
})

test('空白だけの題名は実物と同じエラーコードと sessionId を返し、題名と履歴を変えない', async () => {
  const ctx = createMockContext()
  try {
    const sessionId = MOCK_IDS.sessions.readme
    const binding = ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding
    const summary = completionStatus(ctx).getSnapshot().byId[sessionId]
    const events = binding.eventSource.getSnapshot()
    const result = await binding.session.rename(' \n\t ')
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('空の題名が受け入れられています。')
    assert.equal(result.error.code, 'session/title-invalid')
    assert.deepEqual(result.error.details, { sessionId })
    assert.equal(completionStatus(ctx).getSnapshot().byId[sessionId], summary)
    assert.equal(binding.eventSource.getSnapshot(), events)
  } finally { ctx.dispose() }
})

test('拡張の重複 ID はその行だけエラー表示して無視し、元データと残りの初期化を維持する', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const workspace = sharedWorkspaces[0]!
  const session = sharedSessions[0]!
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    kit.addWorkspace({ ...workspace, title: '上書きしない名前', sessionIds: [] })
    kit.addSession({ ...session.summary, displayTitle: '上書きしない会話' }, [])
    kit.addWorkspace({ ...workspace, workspaceId: 'later-workspace', title: 'あとに登録した場所' })
    kit.addSession({ ...session.summary, id: 'later-session', displayTitle: 'あとに登録した会話' }, [])
  } }] })
  try {
    assert.equal(errors.mock.callCount(), 2)
    assert.match(String(errors.mock.calls[0]!.arguments[0]), new RegExp(workspace.workspaceId))
    assert.match(String(errors.mock.calls[1]!.arguments[0]), new RegExp(session.summary.id))
    assert.deepEqual(ctx.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspace.workspaceId), workspace)
    assert.equal(completionStatus(ctx).getSnapshot().byId[session.summary.id]?.displayTitle, session.summary.displayTitle)
    assert.deepEqual(foldSessionWindow(ctx.sessions.retain(session.summary.id, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records, session.records)
    assert.equal(ctx.workspaces.list.getSnapshot().items.filter((item) => item.workspaceId === workspace.workspaceId).length, 1)
    assert.equal(ctx.sessions.list.getSnapshot().ids.filter((id) => id === session.summary.id).length, 1)
    assert.equal(ctx.workspaces.list.getSnapshot().items.some((item) => item.workspaceId === 'later-workspace'), true)
    assert.ok(ctx.sessions.retain('later-session', { source: 'm3e.test' }).binding)
  } finally { ctx.dispose() }
})
