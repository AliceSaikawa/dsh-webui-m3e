import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionAccess } from '../web/src/dsh/session-access.ts'
import type { SessionSnapshot, SessionSummary, SubagentAddress } from '../web/src/dsh/services.ts'

const summary: Pick<SessionSummary, 'id' | 'origin' | 'parentId'> = { id: 'child', origin: 'subagent', parentId: 'parent' }
const snapshot = (address?: SubagentAddress): Pick<SessionSnapshot, 'sessionId' | 'subagent'> => ({ sessionId: 'child', subagent: address ? { address } : null })
const address: SubagentAddress = { childSessionId: 'child', parentSessionId: 'parent', mode: 'continuable' }

test('通常の会話と parentId だけを持つ分岐は入力できる', () => {
  for (const row of [{ id: 'child' }, { id: 'child', parentId: 'parent' }]) {
    assert.deepEqual(sessionAccess(row, snapshot()), { isSubagent: false, mode: undefined, canCompose: true, readOnly: false })
  }
})

test('origin が子ならアドレス取得前でも読むだけにする', () => {
  for (const state of [undefined, snapshot()]) {
    assert.deepEqual(sessionAccess(summary, state), { isSubagent: true, mode: undefined, canCompose: false, readOnly: true })
  }
})

test('親子 ID が一致する continuable の子だけ入力できる', () => {
  assert.deepEqual(sessionAccess(summary, snapshot(address)), { isSubagent: true, mode: 'continuable', canCompose: true, readOnly: false })
  assert.deepEqual(sessionAccess(summary, snapshot({ ...address, mode: 'one-shot' })), { isSubagent: true, mode: 'one-shot', canCompose: false, readOnly: true })
})

test('一覧になくても snapshot の子アドレスを使い、違う親子や未知 mode は拒む', () => {
  assert.equal(sessionAccess(undefined, snapshot(address)).canCompose, true)
  assert.equal(sessionAccess({ id: 'child' }, snapshot({ ...address, mode: 'one-shot' })).canCompose, false)
  for (const state of [
    snapshot({ ...address, childSessionId: 'other' }),
    snapshot({ ...address, parentSessionId: 'other' }),
    snapshot({ ...address, mode: 'unknown' as SubagentAddress['mode'] }),
  ]) {
    assert.equal(sessionAccess(summary, state).readOnly, true)
    assert.equal(sessionAccess(summary, state).mode, undefined)
  }
  assert.equal(sessionAccess({ ...summary, id: 'other' }, snapshot(address)).canCompose, false)
})
