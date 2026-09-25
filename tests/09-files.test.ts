import assert from 'node:assert/strict'
import test from 'node:test'
import { appendFilePage, directoryChanged, fileBreadcrumbs, fileChanged, fileKind, fileRoute, fileSize, FileVersionChanged, readImageFile, sortFileEntries, type WorkspaceDirectoryEntry, type WorkspaceFilesRemote } from '../web/src/features/session-tools/files.ts'

test('file entries place directories first and use natural names without mutating the listing', () => {
  const entries: WorkspaceDirectoryEntry[] = [{ name: 'z.md', type: 'file' }, { name: 'docs10', type: 'directory' }, { name: 'a.md', type: 'file' }, { name: 'docs2', type: 'directory' }]
  assert.deepEqual(sortFileEntries(entries).map(entry => entry.name), ['docs2', 'docs10', 'a.md', 'z.md'])
  assert.equal(entries[0]?.name, 'z.md')
})

test('file kind handles case, binary types, unknown text, and dots in parent paths', () => {
  assert.equal(fileKind('docs/README.MD'), 'markdown')
  for (const extension of ['png', 'JPG', 'jpeg', 'gif', 'webp', 'svg']) assert.equal(fileKind(`photo.${extension}`), 'image')
  assert.equal(fileKind('artifact.bin'), 'binary')
  assert.equal(fileKind('docs.md/README'), 'text')
  assert.equal(fileKind('main.ts'), 'text')
})

test('file URLs preserve special path characters and breadcrumbs remain rooted', () => {
  assert.equal(fileRoute('a/b', 'file', 'docs/a ?#%.md'), '/s/a%2Fb/file?path=docs%2Fa%20%3F%23%25.md')
  assert.equal(fileRoute('s', 'files', ''), '/s/s/files')
  assert.deepEqual(fileBreadcrumbs('docs/canvas'), [{ name: '作業フォルダ', path: '' }, { name: 'docs', path: 'docs' }, { name: 'canvas', path: 'docs/canvas' }])
})

test('directory changes refresh direct children and remain conservative for resolved roots', () => {
  assert.equal(directoryChanged({ absolutePath: '/work/docs/a.md', version: 'v' }, '/work', 'docs'), true)
  assert.equal(directoryChanged({ absolutePath: '/work/docs/nested/a.md', version: 'v' }, '/work', 'docs'), false)
  assert.equal(directoryChanged({ absolutePath: '/work/README.md', version: 'v' }, '/work', 'docs'), false)
  assert.equal(directoryChanged({ absolutePath: '/work/docs', absent: true }, '/work', 'docs'), true)
  assert.equal(directoryChanged({ absolutePath: '/resolved/docs/a.md', version: 'v' }, '/alias', 'docs'), true)
  assert.equal(directoryChanged({ absolutePath: '/work/docs/a.md', version: 'v' }, undefined, 'docs'), true)
})

test('file updates ignore same versions and unrelated paths but include deletion', () => {
  const file = { absolutePath: '/work/a.md', version: 'v1' }
  assert.equal(fileChanged({ absolutePath: '/work/a.md', version: 'v1' }, file), false)
  assert.equal(fileChanged({ absolutePath: '/work/b.md', version: 'v2' }, file), false)
  assert.equal(fileChanged({ absolutePath: '/work/a.md', version: 'v2' }, file), true)
  assert.equal(fileChanged({ absolutePath: '/work/a.md', absent: true }, file), true)
})

test('text pagination is one-based and retains empty lines between pages', () => {
  const page = { absolutePath: '/work/a.md', version: 'v1', offset: 1, text: 'a\n', lines: 2, eof: false }
  const first = appendFilePage(undefined, page)
  assert.equal(first.nextOffset, 3)
  assert.equal(appendFilePage(first, { ...page, offset: 3, text: '\nc', lines: 2, eof: true }).text, 'a\n\n\nc')
  assert.equal(appendFilePage(first, { ...page, offset: 3, text: '', lines: 0, eof: true }).text, 'a\n')
  assert.throws(() => appendFilePage(first, { ...page, offset: 3, version: 'v2' }), FileVersionChanged)
  assert.throws(() => appendFilePage(first, { ...page, offset: 1 }))
  assert.throws(() => appendFilePage(undefined, { ...page, text: '', lines: 0 }))
})

test('image pages are joined using byte offsets and never mix versions', async () => {
  const offsets: number[] = []
  let revision = 'v1'
  const api = { async readBytes(_id: string, _path: string, range: { offset?: number }) {
    offsets.push(range.offset ?? 0)
    return { ok: true as const, value: { absolutePath: '/work/a.png', version: range.offset ? revision : 'v1', bytes: 3, offset: range.offset ?? 0, data: range.offset ? 'Aw==' : 'AQI=', eof: Boolean(range.offset) } }
  } } as WorkspaceFilesRemote
  const image = await readImageFile(api, 's', 'a.png', new AbortController().signal)
  assert.deepEqual([...image.data], [1, 2, 3])
  assert.deepEqual(offsets, [0, 2])
  revision = 'v2'
  await assert.rejects(readImageFile(api, 's', 'a.png', new AbortController().signal), FileVersionChanged)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readImageFile(api, 's', 'a.png', controller.signal), { name: 'AbortError' })
})

test('file sizes retain zero and do not invent unavailable sizes', () => {
  assert.equal(fileSize(0), '0 バイト')
  assert.equal(fileSize(1024), '1 KB')
  assert.equal(fileSize(1024 * 1024), '1 MB')
  assert.equal(fileSize(undefined), '大きさ不明')
  assert.equal(fileSize(NaN), '大きさ不明')
})
