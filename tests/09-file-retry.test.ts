import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteFailureOf, unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { appendFilePage, nextFilePageRequest, type FilePageRequest, type FileTextContent, type WorkspaceFilesRemote } from '../web/src/features/session-tools/files.ts'
import { createWorkspaceFilesMock } from '../web/src/features/session-tools/mock-files.ts'

test('5001 行目の読込失敗後も同じページを再要求し、先頭の内容を保って重複なく復元する', async () => {
  const fixture = createWorkspaceFilesMock()
  const requests: number[] = []
  let failNextPage = true
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async read(sessionId, path, range, signal) {
      requests.push(range.offset ?? 1)
      if (range.offset === 5001 && failNextPage) {
        failNextPage = false
        return { ok: false, error: { code: 'gateway/unavailable', message: '一時的に読み込めません。', details: {} } }
      }
      return fixture.remote.read(sessionId, path, range, signal)
    },
  }
  let request: FilePageRequest = { offset: 1, requestId: 0 }
  let content: FileTextContent | undefined
  const load = async () => {
    const page = unwrapRemoteResult(await remote.read('session', 'docs/ui-spec.md', { offset: request.offset, limit: 5000 }))
    content = appendFilePage(content, page)
  }
  await load()
  const first = content!
  assert.equal(first.nextOffset, 5001)
  request = nextFilePageRequest(request, first.nextOffset)
  await assert.rejects(load(), failure => remoteFailureOf(failure)?.code === 'gateway/unavailable')
  assert.equal(content, first)
  assert.equal(content!.eof, false)

  const failedRequest = request
  request = nextFilePageRequest(request, content!.nextOffset)
  assert.equal(request.offset, failedRequest.offset)
  assert.notEqual(request.requestId, failedRequest.requestId)
  assert.equal(Object.is(request, failedRequest), false)
  await load()
  assert.deepEqual(requests, [1, 5001, 5001])
  assert.equal(content!.nextOffset, 6001)
  assert.equal(content!.eof, true)
  const lines = content!.text.split('\n')
  assert.equal(lines.length, 6000)
  lines.forEach((line, index) => assert.ok(line.startsWith(`${index + 1} 行目:`)))
  assert.equal(new TextEncoder().encode(content!.text).length, first.bytes)

  const reload = nextFilePageRequest(request, 1)
  assert.equal(reload.offset, 1)
  assert.ok(reload.requestId > request.requestId)
})
