import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteErrorMessage, RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { normalizeWorkspaceError, workspaceOperation } from '../web/src/features/home/workspace-errors.ts'

test('stock workspace facade errors retain their codes for the shared Japanese messages', () => {
  const cases = [
    ['rename', 'workspace/name-conflict', '同じ名前のワークスペースがあります。'],
    ['move', 'workspace/move-invalid', 'この場所には移動できません。'],
    ['delete', 'workspace/invalid-path', 'このフォルダを利用できません。パスを確認してください。'],
    ['session archive', 'gateway/internal', 'サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。'],
    ['reorder', 'gateway/bad-request', '送信内容を確認して、もう一度お試しください。'],
  ]
  for (const [operation, code, message] of cases) {
    const error = normalizeWorkspaceError(new Error(`workspace ${operation} failed: ${code}: Host diagnostic: detail\nsecond line`))
    assert.ok(error instanceof RemoteCallError)
    assert.equal(error.rpcError.code, code)
    assert.equal(remoteErrorMessage(error), message)
  }
})

test('structured failures keep their original identity and arbitrary messages are not decoded', () => {
  const failure = new RemoteCallError({ code: 'session/title-invalid', message: 'Invalid title', details: {} })
  assert.equal(normalizeWorkspaceError(failure), failure)
  for (const text of ['workspace/name-conflict', 'rename failed: workspace/name-conflict: diagnostic', 'prefix workspace rename failed: workspace/name-conflict: diagnostic', 'workspace unknown failed: workspace/name-conflict: diagnostic']) {
    const error = new Error(text)
    assert.equal(normalizeWorkspaceError(error), error)
    assert.equal(remoteErrorMessage(error), '処理に失敗しました。もう一度お試しください。')
  }
  const unknown = normalizeWorkspaceError(new Error('workspace rename failed: workspace/unknown: raw host message'))
  assert.equal(remoteErrorMessage(unknown), '処理に失敗しました。もう一度お試しください。')
})

test('workspace saves reject with a dialog-readable failure instead of swallowing errors', async () => {
  let closed = false
  async function confirm() {
    await workspaceOperation(async () => { throw new Error('workspace rename failed: workspace/name-conflict: duplicate') })
    closed = true
  }
  await assert.rejects(confirm(), error => {
    assert.equal(remoteErrorMessage(error), '同じ名前のワークスペースがあります。')
    return true
  })
  assert.equal(closed, false)
  const failure = new RemoteCallError({ code: 'gateway/internal', message: 'failure', details: {} })
  await assert.rejects(workspaceOperation(async () => { throw failure }), error => error === failure)
  assert.equal(await workspaceOperation(async () => '保存済み'), '保存済み')
})
