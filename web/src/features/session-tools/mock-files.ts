import type { RemoteResult } from '../../dsh/services.ts'
import { imageBase64 } from '../../dsh/mock/fixtures.ts'
import { MAX_IMAGE_BYTES, workspaceFileErrors } from './files.ts'
import type {
  WorkspaceDirectoryEntry, WorkspaceFileChange, WorkspaceFileWatchFrame,
  WorkspaceFilesRemote,
} from './files.ts'

const ROOT = '/mock/dsh-webui-m3e'
const encoder = new TextEncoder()
const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })
const bytesOf = (data: string) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
const base64Of = (bytes: Uint8Array) => btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(''))

const MAX_PAGE_BYTES = 2 * 1024 * 1024
// Virtual files are one repeated ASCII line; no large fixture buffer is kept.
interface MockFile { bytes: Uint8Array; revision: number; virtualSize?: number }
const sizeOf = (file: MockFile) => file.virtualSize ?? file.bytes.length

/** The RPC remains read-only; updateText is a local driver for change tests. */
export function createWorkspaceFilesMock() {
  const files = new Map<string, MockFile>()
  const directories = new Set(['', 'docs', 'docs/canvas'])
  const watchers = new Set<(frame: WorkspaceFileWatchFrame) => void>()
  const addText = (path: string, text: string) => files.set(path, { bytes: encoder.encode(text), revision: 1 })
  addText('README.md', '# スマートフォン向けの画面\n\n作業フォルダのファイルを読み取り専用で確認できます。')
  addText('docs/handoff.md', '# 引き継ぎ\n\n会話のメニューと補助の画面を実装しています。')
  addText('docs/ui-spec.md', Array.from({ length: 6000 }, (_, index) => `${index + 1} 行目: スマートフォン向けの画面の仕様です。`).join('\n'))
  addText('docs/canvas/screens.md', '# 画面\n\n- 会話\n- ファイル\n- ゴール')
  files.set('preview.png', { bytes: bytesOf(imageBase64), revision: 1 })
  files.set('sample.bin', { bytes: new Uint8Array([0, 255, 128, 0, 16, 32]), revision: 1 })
  files.set('unknown-format', { bytes: new Uint8Array([65, 0, 66]), revision: 1 })
  files.set('undecodable.data', { bytes: new Uint8Array([255, 128]), revision: 1 })
  files.set('too-large.txt', { bytes: new Uint8Array(), virtualSize: MAX_PAGE_BYTES + 1, revision: 1 })
  files.set('too-large.png', { bytes: new Uint8Array(), virtualSize: MAX_IMAGE_BYTES + 1, revision: 1 })

  function relativePath(input: string): string | undefined {
    const path = input === ROOT ? '' : input.startsWith(`${ROOT}/`) ? input.slice(ROOT.length + 1) : input
    if (path.startsWith('/') || path.includes('\\')) return undefined
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') { if (!parts.length) return undefined; parts.pop() }
      else parts.push(part)
    }
    return parts.join('/')
  }

  const absolutePath = (path: string) => path ? `${ROOT}/${path}` : ROOT
  const requestFailure = (input: string, signal?: AbortSignal) => signal?.aborted ? failure('rpc/aborted', '読み込みを取り消しました。')
    : input.length === 0 ? failure('gateway/bad-request', 'パスを指定してください。') : undefined
  const metadata = (path: string, file?: MockFile) => ({ absolutePath: absolutePath(path), version: `mock-${file?.revision ?? 1}`, ...(file ? { bytes: sizeOf(file) } : {}) })

  const remote: WorkspaceFilesRemote = {
    async list(_sessionId, input, signal) {
      const invalid = requestFailure(input, signal)
      if (invalid) return invalid
      const path = relativePath(input)
      if (path === undefined || !directories.has(path)) return failure(workspaceFileErrors.notFound, 'フォルダが見つかりません。')
      const prefix = path ? `${path}/` : ''
      const entries: WorkspaceDirectoryEntry[] = []
      for (const directory of directories) {
        if (!directory || !directory.startsWith(prefix)) continue
        const name = directory.slice(prefix.length)
        if (name && !name.includes('/')) entries.push({ name, type: 'directory' })
      }
      for (const [filePath, file] of files) {
        if (!filePath.startsWith(prefix)) continue
        const name = filePath.slice(prefix.length)
        if (name && !name.includes('/')) entries.push({ name, type: 'file', size: sizeOf(file) })
      }
      return success({ path, entries, truncated: false })
    },
    async stat(_sessionId, input, signal) {
      const invalid = requestFailure(input, signal)
      if (invalid) return invalid
      const path = relativePath(input)
      if (path === undefined) return failure(workspaceFileErrors.notFound, 'ファイルが見つかりません。')
      const file = files.get(path)
      if (!file && !directories.has(path)) return failure(workspaceFileErrors.notFound, 'ファイルが見つかりません。')
      return success(metadata(path, file))
    },
    async read(_sessionId, input, options = {}, signal) {
      const invalid = requestFailure(input, signal)
      if (invalid) return invalid
      const path = relativePath(input)
      const file = path === undefined ? undefined : files.get(path)
      if (path === undefined || !file) return failure(workspaceFileErrors.notFound, 'ファイルが見つかりません。')
      const offset = Math.max(1, Math.trunc(options.offset ?? 1))
      const limit = Math.max(1, Math.trunc(options.limit ?? 5000))
      if (file.virtualSize !== undefined) {
        if (offset === 1 && file.virtualSize > MAX_PAGE_BYTES) return failure(workspaceFileErrors.tooLarge, 'ファイルが大きいため表示できません。')
        return success({ ...metadata(path, file), offset, text: '', lines: 0, eof: true })
      }
      let text: string
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes) }
      catch { return failure(workspaceFileErrors.notText, 'このファイルは表示できません。') }
      const allLines = text ? text.replace(/\n$/, '').split('\n') : []
      const lines = allLines.slice(offset - 1, offset - 1 + limit)
      const page = lines.join('\n')
      if (encoder.encode(page).length > MAX_PAGE_BYTES) return failure(workspaceFileErrors.tooLarge, 'ファイルが大きいため表示できません。')
      if (page.includes(String.fromCharCode(0))) return failure(workspaceFileErrors.notText, 'このファイルは表示できません。')
      return success({ ...metadata(path, file), offset, text: page, lines: lines.length, eof: offset - 1 + lines.length >= allLines.length })
    },
    async readBytes(_sessionId, input, options = {}, signal) {
      const invalid = requestFailure(input, signal)
      if (invalid) return invalid
      const path = relativePath(input)
      const file = path === undefined ? undefined : files.get(path)
      if (path === undefined || !file) return failure(workspaceFileErrors.notFound, 'ファイルが見つかりません。')
      const offset = Math.max(0, Math.trunc(options.offset ?? 0))
      const length = options.length ?? MAX_PAGE_BYTES
      if (!Number.isSafeInteger(length) || length < 1) return failure('gateway/bad-request', '読み込み範囲を確認してください。')
      if (length > MAX_PAGE_BYTES) return failure(workspaceFileErrors.tooLarge, '読み込み範囲が大きすぎます。')
      const bytes = file.virtualSize === undefined ? file.bytes.slice(offset, offset + length)
        : new Uint8Array(Math.min(length, Math.max(0, file.virtualSize - offset))).fill(65)
      return success({ ...metadata(path, file), offset, data: base64Of(bytes), eof: offset + bytes.length >= sizeOf(file) })
    },
    changes(_sessionId, signal) {
      return {
        [Symbol.asyncIterator](): AsyncIterableIterator<WorkspaceFileWatchFrame> {
          let closed = false
          const queue: WorkspaceFileWatchFrame[] = [{ kind: 'ready' }]
          const waiting: ((result: IteratorResult<WorkspaceFileWatchFrame>) => void)[] = []
          const push = (frame: WorkspaceFileWatchFrame) => {
            if (closed) return
            const resolve = waiting.shift()
            if (resolve) resolve({ done: false, value: frame })
            else queue.push(frame)
          }
          const close = () => {
            closed = true
            queue.length = 0
            watchers.delete(push)
            signal?.removeEventListener('abort', close)
            for (const resolve of waiting.splice(0)) resolve({ done: true, value: undefined })
          }
          if (signal?.aborted) close()
          else {
            watchers.add(push)
            signal?.addEventListener('abort', close, { once: true })
          }
          return {
            [Symbol.asyncIterator]() { return this },
            next() {
              if (closed) return Promise.resolve({ done: true, value: undefined })
              const frame = queue.shift()
              if (frame) return Promise.resolve({ done: false, value: frame })
              return new Promise((resolve) => waiting.push(resolve))
            },
            async return() { close(); return { done: true, value: undefined } },
          }
        },
      }
    },
  }

  function publishChange(change: WorkspaceFileChange) {
    for (const watcher of watchers) watcher({ kind: 'change', change })
  }

  return {
    remote,
    updateText(input: string, text: string) {
      const path = relativePath(input)
      const file = path === undefined ? undefined : files.get(path)
      if (path === undefined || !file) throw new Error('更新する偽のファイルが見つかりません。')
      file.bytes = encoder.encode(text)
      delete file.virtualSize
      file.revision++
      publishChange({ absolutePath: absolutePath(path), version: `mock-${file.revision}` })
    },
    publishChange,
    get subscriberCount() { return watchers.size },
  }
}
