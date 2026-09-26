import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWorkspaceError, workspaceOperation } from '../web/src/dsh/workspace-errors.ts'
import { RemoteCallError, remoteErrorMessage, remoteFailureOf } from '../web/src/dsh/remote-result.ts'

test('workspace facade failures recover the code for every affected operation', () => {
  for (const operation of ['rename', 'delete', 'reorder', 'session archive', 'move']) {
    const normalized = normalizeWorkspaceError(new Error(`workspace ${operation} failed: rpc/timeout: transport: slow\nretry later`))
    assert.ok(normalized instanceof RemoteCallError)
    assert.deepEqual(remoteFailureOf(normalized), { code: 'rpc/timeout', message: 'transport: slow\nretry later', details: {} })
    assert.equal(remoteErrorMessage(normalized, 'アーカイブできませんでした。'), '応答を待ちきれませんでした。もう一度お試しください。')
  }
})

test('structured errors and unknown failures keep their original identity', () => {
  const failure = { code: 'workspace/move-invalid', message: 'invalid', details: { id: 'A' } }
  for (const error of [failure, { ok: false, error: failure }, new RemoteCallError(failure),
    new Error('workspace refresh failed: rpc/timeout: retry'), new Error('workspace rename failed: malformed'),
    new Error('workspace rename failed: invalid code: detail'), 'rpc/timeout', undefined]) {
    assert.equal(normalizeWorkspaceError(error), error)
  }
})

test('workspaceOperation returns success and preserves a normalized rejection', async () => {
  const value = { archived: true }
  assert.equal(await workspaceOperation(async () => value), value)
  await assert.rejects(workspaceOperation(async () => { throw new Error('workspace session archive failed: rpc/timeout: retry') }), error => {
    assert.equal(remoteFailureOf(error)?.code, 'rpc/timeout')
    return true
  })
  const unknown = new Error('other failure')
  await assert.rejects(workspaceOperation(async () => { throw unknown }), error => error === unknown)
})
