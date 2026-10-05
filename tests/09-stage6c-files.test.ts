import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { unwrapRemoteResult, RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { createWorkspaceFilesMock } from '../web/src/features/session-tools/mock-files.ts'
import { extendMock, SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { workspaceFilesOf } from '../web/src/features/session-tools/files.ts'

test('M8 全ファイルRPCは保存済み会話を解決し未知・削除済みを拒否、cwdごとに内容を分離する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = workspaceFilesOf(ctx.remote)!
    const id = SESSION_TOOLS_MOCK_IDS.parent
    ctx.mock.setAgentAvailable(id, false)
    assert.equal((await api.list(id, '.')).ok, true)
    for (const result of await Promise.all([api.list('missing', '.'), api.stat('missing', 'README.md'),
      api.read('missing', 'README.md', {}), api.readBytes('missing', 'README.md', {})])) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'gateway/lookup-not-found')
    }
    await assert.rejects(api.changes('missing', '.')[Symbol.asyncIterator]().next(), e => e instanceof RemoteCallError && e.rpcError.code === 'gateway/lookup-not-found')
    ctx.mock.removeSession(id)
    const deleted = await api.stat(id, 'README.md')
    assert.equal(deleted.ok, false)
    if (!deleted.ok) assert.equal(deleted.error.code, 'gateway/lookup-not-found')
    const roots: Record<string, string> = { a: '/work/a', b: '/work/b' }
    const fixture = createWorkspaceFilesMock(id => roots[id])
    fixture.updateText('README.md', 'A のファイル', 'a')
    fixture.updateText('README.md', 'B のファイル', 'b')
    for (const [id, text] of [['a', 'A のファイル'], ['b', 'B のファイル']]) {
      const read = unwrapRemoteResult(await fixture.remote.read(id!, 'README.md', {}))
      assert.equal(read.text, text)
      assert.equal(read.absolutePath, `/work/${id}/README.md`)
    }
  } finally { ctx.dispose() }
})

test('M9 行とバイトの範囲は省略だけを補完しnullを拒否する', async () => {
  const { remote } = createWorkspaceFilesMock()
  assert.equal(unwrapRemoteResult(await remote.read('s', 'README.md', {})).offset, 1)
  assert.equal(unwrapRemoteResult(await remote.readBytes('s', 'README.md', { range: {} })).offset, 0)
  for (const result of await Promise.all([
    remote.read('s', 'README.md', { offset: null } as never), remote.read('s', 'README.md', { limit: null } as never),
    remote.readBytes('s', 'README.md', { range: { offset: null } } as never), remote.readBytes('s', 'README.md', { range: { length: null } } as never),
  ])) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'gateway/bad-request')
  }
})

test('m3 baseFileからの相対バックスラッシュを正規化する', async () => {
  const { remote } = createWorkspaceFilesMock()
  const actual = unwrapRemoteResult(await remote.readBytes('s', '..\\README.md', { baseFile: 'docs/handoff.md' }))
  assert.deepEqual(actual, unwrapRemoteResult(await remote.readBytes('s', 'README.md', {})))
})
