import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceFilesMock } from '../web/src/features/session-tools/mock-files.ts'
import { RemoteCallError, remoteErrorMessage, unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'

test('0.2 のバイト読み込みは range の入れ子・native bytes・baseFile と全体読込を使う', async () => {
  const fixture = createWorkspaceFilesMock()
  const { remote } = fixture
  const expected = new TextEncoder().encode('M3E RPC: 日本語と byte ranges')
  fixture.updateText('README.md', new TextDecoder().decode(expected))
  const complete = unwrapRemoteResult(await remote.readBytes('s', 'README.md', {}))
  assert.ok(complete.data instanceof Uint8Array)
  assert.deepEqual(complete.data, expected)
  assert.equal(complete.eof, true)
  const window = unwrapRemoteResult(await remote.readBytes('s', '../README.md', { baseFile: 'docs/handoff.md', range: { offset: 1, length: 3 } }))
  assert.deepEqual(window.data, expected.slice(1, 4))
  assert.equal(window.offset, 1)
  assert.equal(window.eof, false)
  for (const options of [{ offset: 0, length: 1 }, { range: { offset: -1 } }, { range: { length: 0 } }, { range: { length: 1.5 } }, { range: { offset: Number.MAX_SAFE_INTEGER, length: 1 } }]) {
    const result = await remote.readBytes('s', 'README.md', options)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'gateway/bad-request')
  }
  for (const range of [{ offset: 0 }, { limit: 5001 }, { offset: 1.5 }]) {
    const result = await remote.read('s', 'README.md', range)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'gateway/bad-request')
  }
})

test('監視は生成時に開始し対象の直下だけを通知、dispose で終了する', async () => {
  const fixture = createWorkspaceFilesMock()
  const watch = fixture.remote.changes('s', 'docs')
  assert.equal(fixture.subscriberCount, 1)
  const iterator = watch[Symbol.asyncIterator]()
  assert.deepEqual(await iterator.next(), { done: false, value: { kind: 'ready' } })
  fixture.updateText('README.md', '無関係')
  fixture.updateText('docs/canvas/screens.md', '孫のファイル')
  fixture.updateText('docs/handoff.md', '対象')
  const next = await iterator.next()
  assert.equal(next.value?.kind, 'change')
  if (next.value?.kind === 'change') {
    assert.deepEqual(next.value.change, { absolutePath: '/mock/dsh-webui-m3e/docs', version: 'mock-1' })
  }
  const stat = await fixture.remote.stat('s', 'docs')
  assert.equal(stat.ok, false)
  if (!stat.ok) assert.equal(stat.error.code, 'workspace-file/not-regular-file')
  const pending = iterator.next()
  watch.dispose()
  assert.deepEqual(await pending, { done: true, value: undefined })
  assert.equal(fixture.subscriberCount, 0)
  // @ts-expect-error The former path-less call must not start a whole-session watch.
  const invalid = fixture.remote.changes('s', new AbortController().signal)
  await assert.rejects(invalid[Symbol.asyncIterator]().next(), error => error instanceof RemoteCallError && error.rpcError.code === 'gateway/bad-request')
  assert.equal(fixture.subscriberCount, 0)
})

test('利用できないモデル・監視・実行中アーカイブは理由と次の操作を日本語で案内する', () => {
  const message = (code: string) => remoteErrorMessage({ code, message: 'Host detail', details: {} })
  assert.match(message('session/model-unavailable'), /モデルを選び直して/)
  assert.match(message('session/provider-credentials-unavailable'), /API キーの登録状況を確認する機能を利用できません。DSH の構成を確認してください。/)
  assert.match(message('session/provider-models-unavailable'), /利用できるモデルがありません/)
  assert.match(message('workspace-file/watch-unsupported'), /更新通知は利用できません。読み直して/)
  assert.match(message('workspace/session-active'), /実行中の会話はアーカイブできません。実行を止めて/)
})
