import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import type { SubagentAddress } from '../web/src/dsh/services.ts'

const parentSessionId = MOCK_IDS.sessions.readme
const childSessionId = 'catalog-child'
function setup(mode: 'one-shot' | 'continuable', parentAvailable = true) {
  const ctx = createMockContext()
  ctx.mock.addSession({ id: childSessionId, parentId: parentSessionId, origin: 'subagent', displayTitle: '子の会話', running: false, blank: true, updatedAt: 0 }, [])
  ctx.mock.setProjection(parentSessionId, 'subagentCatalog', [{ id: childSessionId, createdAt: 0, mode, label: '子の会話' }])
  if (!parentAvailable) ctx.mock.removeSession(parentSessionId)
  return ctx
}

for (const mode of ['one-shot', 'continuable'] as const) {
  test(`カタログと一致する ${mode} のアドレスを選択し、mode を保持する`, async () => {
    const ctx = setup(mode)
    try {
      const address: SubagentAddress = { parentSessionId, childSessionId, mode }
      assert.deepEqual(ctx.sessions.subagentAddress(childSessionId), address)
      assert.equal(ctx.sessions.binding(childSessionId), undefined)
      const owner = conversationSelection(ctx.sessions)
      await owner.select(address)
      assert.equal(owner.state.getSnapshot().sessionId, childSessionId)
      assert.deepEqual(ctx.sessions.binding(childSessionId)!.session.getSnapshot().subagent, { address, parentAvailable: true })
      await owner.select(parentSessionId)
      assert.equal(ctx.sessions.binding(childSessionId), undefined)
      await owner.select(childSessionId)
      assert.deepEqual(ctx.sessions.binding(childSessionId)!.session.getSnapshot().subagent?.address, address)
    } finally { ctx.dispose() }
  })

  test(`${mode} の明示アドレスは一覧未到着でも retain でき、最後の解放で消える`, async () => {
    const ctx = setup(mode)
    try {
      ctx.mock.updateList(state => { state.ids = []; state.byId = {}; state.phase = 'pending'; state.projectionsBySession = {} })
      assert.throws(() => ctx.sessions.retain(childSessionId, { source: 'm3e.test' }), /unknown session/)
      const address: SubagentAddress = { parentSessionId, childSessionId, mode }
      const reference = ctx.sessions.retain(address, { source: 'm3e.test' })
      assert.equal((await reference.ready).session.getSnapshot().openState, 'open')
      assert.deepEqual(reference.binding.session.getSnapshot().subagent?.address, address)
      reference.release()
      assert.equal(ctx.sessions.binding(childSessionId), undefined)
    } finally { ctx.dispose() }
  })
}

test('カタログ行がない、unknown、親が違う場合は URL から子を選択しない', async () => {
  const ctx = setup('one-shot')
  try {
    for (const rows of [[], [{ id: childSessionId, mode: 'unknown', createdAt: 0 }]]) {
      ctx.mock.setProjection(parentSessionId, 'subagentCatalog', rows)
      ctx.mock.updateList(state => { state.projectionsBySession = { ...state.projectionsBySession, [parentSessionId]: { ...state.projectionsBySession[parentSessionId]!, state: 'idle' } } })
      const owner = conversationSelection(ctx.sessions)
      await owner.select(undefined)
      await assert.rejects(owner.select(childSessionId))
      assert.equal(ctx.sessions.binding(childSessionId), undefined)
    }
    ctx.mock.updateList(state => { state.byId[childSessionId]!.parentId = MOCK_IDS.sessions.approval })
    await conversationSelection(ctx.sessions).select(undefined)
    await assert.rejects(conversationSelection(ctx.sessions).select(childSessionId))
    assert.equal(ctx.sessions.binding(childSessionId), undefined)
  } finally { ctx.dispose() }
})

test('親が利用不可でも正常な明示アドレスの子は閲覧用に開ける', async () => {
  const ctx = setup('continuable', false)
  try {
    assert.equal(ctx.sessions.binding(parentSessionId), undefined)
    const address: SubagentAddress = { parentSessionId, childSessionId, mode: 'continuable' }
    const reference = ctx.sessions.retain(address, { source: 'm3e.test' })
    await reference.ready
    assert.deepEqual(reference.binding.session.getSnapshot().subagent, { address, parentAvailable: false })
  } finally { ctx.dispose() }
})
