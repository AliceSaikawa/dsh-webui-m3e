import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import type { SubagentAddress } from '../web/src/dsh/services.ts'

const parentSessionId = MOCK_IDS.sessions.readme
const childSessionId = 'catalog-child'

function setup(mode: 'one-shot' | 'continuable', parentAvailable = true) {
  const ctx = createMockContext()
  ctx.mock.addSession({ id: childSessionId, parentId: parentSessionId, origin: 'subagent', displayTitle: '子の会話', running: false, blank: true, updatedAt: 0 }, [])
  if (!parentAvailable) ctx.mock.removeSession(parentSessionId)
  ctx.mock.updateList((state) => {
    state.subagentsByParent = {
      [parentSessionId]: {
        state: 'ready', error: null, parentAvailable,
        entries: [{ kind: 'child', id: childSessionId, mode, label: '子の会話', activity: 'inactive', hasChildren: false }],
      },
    }
  })
  ctx.sessions.open(parentSessionId)
  return ctx
}

for (const mode of ['one-shot', 'continuable'] as const) {
  test(`カタログと一致する ${mode} のアドレスを選択し、mode を保持する`, () => {
    const ctx = setup(mode)
    try {
      const address: SubagentAddress = { parentSessionId, childSessionId, mode }
      assert.equal(ctx.sessions.subagentAddress(childSessionId), undefined)
      ctx.sessions.openSubagent(address)
      assert.equal(ctx.sessions.list.getSnapshot().current, childSessionId)
      assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
      assert.deepEqual(ctx.sessions.subagentAddress(childSessionId), address)
      assert.deepEqual(ctx.sessions.binding(childSessionId)!.session.getSnapshot().subagent, { address, parentAvailable: true })
      ctx.sessions.open(parentSessionId)
      assert.equal(ctx.sessions.list.getSnapshot().currentAddress, undefined)
      ctx.sessions.open(childSessionId)
      assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
    } finally { ctx.dispose() }
  })

  test(`${mode} の子に mode がない、または違うアドレスを渡すと選択を変更せず拒否する`, () => {
    const ctx = setup(mode)
    try {
      const previousList = ctx.sessions.list.getSnapshot()
      const previousChild = ctx.sessions.binding(childSessionId)!.session.getSnapshot()
      const missingMode = { parentSessionId, childSessionId } as SubagentAddress
      const wrongMode = { parentSessionId, childSessionId, mode: mode === 'one-shot' ? 'continuable' : 'one-shot' } as const
      for (const address of [missingMode, wrongMode]) {
        assert.throws(() => ctx.sessions.openSubagent(address))
        assert.equal(ctx.sessions.list.getSnapshot(), previousList)
        assert.equal(ctx.sessions.binding(childSessionId)!.session.getSnapshot(), previousChild)
      }
    } finally { ctx.dispose() }
  })
}

test('子のカタログ行がない場合と診断行の場合は選択を変更せず拒否する', () => {
  const ctx = setup('one-shot')
  try {
    for (const entries of [[], [{ kind: 'diagnostic', id: childSessionId, reason: 'corrupt', mode: 'one-shot' }]]) {
      ctx.mock.updateList((state) => {
        state.subagentsByParent = { [parentSessionId]: { state: 'ready', error: null, parentAvailable: true, entries } }
      })
      const previous = ctx.sessions.list.getSnapshot()
      assert.throws(() => ctx.sessions.openSubagent({ parentSessionId, childSessionId, mode: 'one-shot' }))
      assert.equal(ctx.sessions.list.getSnapshot(), previous)
    }
    const previous = ctx.sessions.list.getSnapshot()
    assert.throws(() => ctx.sessions.openSubagent({ parentSessionId: MOCK_IDS.sessions.approval, childSessionId, mode: 'one-shot' }))
    assert.equal(ctx.sessions.list.getSnapshot(), previous)
  } finally { ctx.dispose() }
})

test('親が利用不可でも正常なカタログの子は閲覧用に開ける', () => {
  const ctx = setup('continuable', false)
  try {
    assert.equal(ctx.sessions.binding(parentSessionId), undefined)
    const address: SubagentAddress = { parentSessionId, childSessionId, mode: 'continuable' }
    ctx.sessions.openSubagent(address)
    assert.deepEqual(ctx.sessions.binding(childSessionId)!.session.getSnapshot().subagent, { address, parentAvailable: false })
  } finally { ctx.dispose() }
})
