import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteFailureOf, unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import {
  fileKind, fileReadErrorMessage, FileVersionChanged, IMAGE_READ_BYTES, ImageFileTooLarge,
  MAX_IMAGE_BYTES, readImageFile, readTextFilePage, type WorkspaceFilesRemote,
} from '../web/src/features/session-tools/files.ts'
import { createWorkspaceFilesMock } from '../web/src/features/session-tools/mock-files.ts'

test('拡張子から判別できない NUL と不正 UTF-8 は実物のエラーコードからバイナリ表示へ切り替える', async () => {
  const { remote } = createWorkspaceFilesMock()
  for (const [path, size] of [['unknown-format', 3], ['undecodable.data', 2]] as const) {
    assert.equal(fileKind(path), 'text')
    const result = await remote.read('s', path, {})
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'workspace-file/not-text')
    const content = await readTextFilePage(remote, 's', path, 1, new AbortController().signal)
    assert.equal(content.kind, 'binary')
    if (content.kind !== 'binary') assert.fail('バイナリの情報が必要です。')
    assert.equal(content.metadata.bytes, size)
    assert.ok(content.metadata.absolutePath.endsWith(`/${path}`))
  }
  const text = await readTextFilePage(remote, 's', 'README.md', 1, new AbortController().signal)
  assert.equal(text.kind, 'text')
})

test('大きすぎるテキストページと存在しないパスの偽エラーは実物と同じ単数形を使う', async () => {
  const { remote } = createWorkspaceFilesMock()
  for (const result of await Promise.all([
    remote.list('s', 'missing'), remote.stat('s', 'missing'), remote.read('s', 'missing', {}), remote.readBytes('s', 'missing', {}),
  ])) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'workspace-file/not-found')
  }
  assert.equal(unwrapRemoteResult(await remote.stat('s', 'too-large.txt')).bytes, 2 * 1024 * 1024 + 1)
  await assert.rejects(readTextFilePage(remote, 's', 'too-large.txt', 1, new AbortController().signal), failure => {
    assert.equal(remoteFailureOf(failure)?.code, 'workspace-file/too-large')
    assert.equal(fileReadErrorMessage(failure), 'ファイルが大きいため表示できません。')
    return true
  })
  const range = await remote.readBytes('s', 'preview.png', { range: { length: 2 * 1024 * 1024 + 1 } })
  assert.equal(range.ok, false)
  if (!range.ok) assert.equal(range.error.code, 'workspace-file/too-large')
})

test('10 MiB を超える画像は stat だけで拒否し、本文を読み始めない', async () => {
  const fixture = createWorkspaceFilesMock()
  let reads = 0
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async readBytes(...args) { reads++; return fixture.remote.readBytes(...args) },
  }
  assert.equal(unwrapRemoteResult(await remote.stat('s', 'too-large.png')).bytes, MAX_IMAGE_BYTES + 1)
  await assert.rejects(readImageFile(remote, 's', 'too-large.png', new AbortController().signal), failure => {
    assert.ok(failure instanceof ImageFileTooLarge)
    assert.match(fileReadErrorMessage(failure), /画像は 10 MB まで表示できます/)
    return true
  })
  assert.equal(reads, 0)
})

test('上限ぴったりの画像を小さい窓で読み、上限を越える要求は出さない', async () => {
  const fixture = createWorkspaceFilesMock()
  const chunk = new Uint8Array(IMAGE_READ_BYTES).fill(65)
  const ranges: { offset: number; length: number }[] = []
  const metadata = { absolutePath: '/work/boundary.png', version: 'v1', bytes: MAX_IMAGE_BYTES }
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async stat() { return { ok: true, value: metadata } },
    async readBytes(_sessionId, _path, { range = {} }) {
      const offset = range.offset!, length = range.length!
      ranges.push({ offset, length })
      assert.equal(length, IMAGE_READ_BYTES)
      assert.ok(offset + length <= MAX_IMAGE_BYTES)
      return { ok: true, value: { ...metadata, offset, data: chunk, eof: offset + length === MAX_IMAGE_BYTES } }
    },
  }
  const image = await readImageFile(remote, 's', 'boundary.png', new AbortController().signal)
  assert.equal(image.data.length, MAX_IMAGE_BYTES)
  assert.equal(image.data[0], 65)
  assert.equal(image.data.at(-1), 65)
  assert.equal(ranges.length, MAX_IMAGE_BYTES / IMAGE_READ_BYTES)
})

test('大きさ不明の画像でも上限までで読み込みを打ち切り、追加の要求を出さない', async () => {
  const fixture = createWorkspaceFilesMock()
  const chunk = new Uint8Array(IMAGE_READ_BYTES).fill(65)
  const metadata = { absolutePath: '/work/unknown.png', version: 'v1' }
  let requestedBytes = 0
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async stat() { return { ok: true, value: metadata } },
    async readBytes(_sessionId, _path, { range = {} }) {
      requestedBytes += range.length!
      assert.ok(requestedBytes <= MAX_IMAGE_BYTES)
      return { ok: true, value: { ...metadata, offset: range.offset!, data: chunk, eof: false } }
    },
  }
  await assert.rejects(readImageFile(remote, 's', 'unknown.png', new AbortController().signal), ImageFileTooLarge)
  assert.equal(requestedBytes, MAX_IMAGE_BYTES)
})

test('画像の読み込み途中に大きさが上限を越えた場合も後続ページを要求しない', async () => {
  const fixture = createWorkspaceFilesMock()
  const metadata = { absolutePath: '/work/growing.png', version: 'v1', bytes: 2 }
  let reads = 0
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async stat() { return { ok: true, value: metadata } },
    async readBytes(_sessionId, _path, { range = {} }) {
      reads++
      return { ok: true, value: { ...metadata, bytes: reads === 1 ? 2 : MAX_IMAGE_BYTES + 1, offset: range.offset!, data: new Uint8Array([65]), eof: false } }
    },
  }
  await assert.rejects(readImageFile(remote, 's', 'growing.png', new AbortController().signal), ImageFileTooLarge)
  assert.equal(reads, 2)
})

test('stat と先頭の画像ページで版が違う場合は混ぜず、中断後も本文を読まない', async () => {
  const fixture = createWorkspaceFilesMock()
  const metadata = { absolutePath: '/work/change.png', version: 'v1', bytes: 1 }
  let reads = 0
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async stat() { return { ok: true, value: metadata } },
    async readBytes(_sessionId, _path, { range = {} }) {
      reads++
      return { ok: true, value: { ...metadata, version: 'v2', offset: range.offset!, data: new Uint8Array([65]), eof: true } }
    },
  }
  await assert.rejects(readImageFile(remote, 's', 'change.png', new AbortController().signal), FileVersionChanged)
  assert.equal(reads, 1)
  const controller = new AbortController()
  remote.stat = async () => { controller.abort(); return { ok: true, value: metadata } }
  await assert.rejects(readImageFile(remote, 's', 'change.png', controller.signal), { name: 'AbortError' })
  assert.equal(reads, 1)
})

test('画像の返却データが要求範囲を越える場合は蓄積せずに拒否する', async () => {
  const fixture = createWorkspaceFilesMock()
  const metadata = { absolutePath: '/work/oversized.png', version: 'v1' }
  let reads = 0
  const remote: WorkspaceFilesRemote = {
    ...fixture.remote,
    async stat() { return { ok: true, value: metadata } },
    async readBytes(_sessionId, _path, { range = {} }) {
      reads++
      return { ok: true, value: { ...metadata, offset: range.offset!, data: new Uint8Array(IMAGE_READ_BYTES + 1), eof: false } }
    },
  }
  await assert.rejects(readImageFile(remote, 's', 'oversized.png', new AbortController().signal), ImageFileTooLarge)
  assert.equal(reads, 1)
})
