import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { remoteErrorMessage, remoteFailureOf, unwrapRemoteResult } from '../../dsh/remote-result.ts'

/** dsh-api-workspace-files/lib/types/types.d.ts uses the singular prefix. */
export const workspaceFileErrors = {
  notFound: 'workspace-file/not-found', notText: 'workspace-file/not-text', tooLarge: 'workspace-file/too-large',
} as const
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const IMAGE_READ_BYTES = 256 * 1024

/** Wire contracts verified against the installed workspace-files API. */
export interface WorkspaceFileStat { readonly absolutePath: string; readonly version: string; readonly bytes?: number }
export interface WorkspaceFileText extends WorkspaceFileStat { readonly offset: number; readonly text: string; readonly lines: number; readonly eof: boolean }
export interface WorkspaceFileBytes extends WorkspaceFileStat { readonly offset: number; readonly data: Uint8Array<ArrayBuffer>; readonly eof: boolean }
export interface WorkspaceByteReadOptions { readonly range?: { readonly offset?: number; readonly length?: number }; readonly baseFile?: string }
export interface WorkspaceDirectoryEntry { readonly name: string; readonly type: 'file' | 'directory' | 'other'; readonly size?: number }
export interface WorkspaceDirectoryListing { readonly path: string; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }
export type WorkspaceFileChange = { readonly absolutePath: string; readonly version: string } | { readonly absolutePath: string; readonly absent: true }
export type WorkspaceFileWatchFrame = { readonly kind: 'ready' } | { readonly kind: 'change'; readonly change: WorkspaceFileChange }
export interface WorkspaceFileWatch extends AsyncIterable<WorkspaceFileWatchFrame> {
  send(item: never): void
  end(): void
  dispose(): void
}
export interface WorkspaceFilesRemote {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  read(sessionId: string, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileText>>
  readBytes(sessionId: string, path: string, options: WorkspaceByteReadOptions, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileStat>>
  /** Structural shape of DSH's RemoteStreamHandle<WorkspaceFileWatchFrame, never>. */
  changes(sessionId: string, path: string, signal?: AbortSignal): WorkspaceFileWatch
}

export function workspaceFilesOf(remote: DshRemote): WorkspaceFilesRemote | undefined {
  const value = remote.workspaceFiles as Partial<WorkspaceFilesRemote> | undefined
  return value && ['list', 'read', 'readBytes', 'stat', 'changes'].every(name => typeof value[name as keyof WorkspaceFilesRemote] === 'function')
    ? value as WorkspaceFilesRemote : undefined
}

export function sortFileEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory')
    || a.name.localeCompare(b.name, 'ja', { numeric: true }))
}

// SVG stays on the text path: opening an SVG Blob can execute scripts in our origin.
export const imageMediaTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}
export function fileExtension(path: string): string { return fileName(path).split('.').slice(1).at(-1)?.toLowerCase() ?? '' }
export function fileKind(path: string): 'markdown' | 'image' | 'text' | 'binary' {
  const extension = fileExtension(path)
  if (extension === 'md') return 'markdown'
  if (imageMediaTypes[extension]) return 'image'
  if (['bin', 'pdf', 'zip', 'gz', 'tar', '7z', 'exe', 'dmg', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'mov', 'mp3', 'wav', 'sqlite', 'db'].includes(extension)) return 'binary'
  return 'text'
}
export function fileName(path: string): string { return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'ファイル' }
export function fileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '大きさ不明'
  if (bytes < 1024) return `${bytes.toLocaleString('ja-JP')} バイト`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / 1024 / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} MB`
}
export function childFilePath(parent: string, name: string): string { return parent ? `${parent.replace(/\/+$/, '')}/${name}` : name }
/** URLs and listing responses use an empty root, but the RPC requires a path. */
export function directoryRequestPath(path: string): string { return path || '.' }
export function fileRoute(sessionId: string, screen: 'files' | 'file', path: string): string {
  return `/s/${encodeURIComponent(sessionId)}/${screen}${path ? `?path=${encodeURIComponent(path)}` : ''}`
}
export function fileBreadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  return [{ name: '作業フォルダ', path: '' }, ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }))]
}
const comparablePath = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
export function directoryChanged(change: WorkspaceFileChange, cwd: string | undefined, path: string): boolean {
  if (!cwd) return true
  const root = comparablePath(cwd)
  const absolute = comparablePath(change.absolutePath)
  // A symlink-resolved workspace may differ from cwd. Conservatively refresh it.
  if (absolute !== root && !absolute.startsWith(root + '/')) return true
  const directory = comparablePath(childFilePath(root, path))
  return absolute === directory || absolute.slice(0, absolute.lastIndexOf('/')) === directory
}
export function fileChanged(change: WorkspaceFileChange, file: WorkspaceFileStat): boolean {
  return comparablePath(change.absolutePath) === comparablePath(file.absolutePath)
    && ('absent' in change || change.version !== file.version)
}

export class FileVersionChanged extends Error {}
export class ImageFileTooLarge extends Error {}
export function fileReadErrorMessage(failure: unknown): string {
  if (failure instanceof ImageFileTooLarge) return '画像は 10 MB まで表示できます。上限内で読み込みを完了できませんでした。'
  if (remoteFailureOf(failure)?.code === workspaceFileErrors.tooLarge) return 'ファイルが大きいため表示できません。'
  return remoteErrorMessage(failure, 'ファイルを読み込めませんでした。')
}

function checkFileReadAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('読み込みを取り消しました。', 'AbortError')
}

/** Unknown extensions can still be binary; use the host's content verdict. */
export async function readTextFilePage(remote: WorkspaceFilesRemote, sessionId: string, path: string, offset: number, signal: AbortSignal): Promise<
  { kind: 'text'; page: WorkspaceFileText } | { kind: 'binary'; metadata: WorkspaceFileStat }
> {
  checkFileReadAbort(signal)
  const result = await remote.read(sessionId, path, { offset, limit: 5000 }, signal)
  checkFileReadAbort(signal)
  if (!result.ok && result.error.code === workspaceFileErrors.notText) {
    const metadata = unwrapRemoteResult(await remote.stat(sessionId, path, signal))
    checkFileReadAbort(signal)
    return { kind: 'binary', metadata }
  }
  return { kind: 'text', page: unwrapRemoteResult(result) }
}
export interface FileTextContent extends WorkspaceFileStat { readonly text: string; readonly nextOffset: number; readonly eof: boolean }
export interface FilePageRequest { readonly offset: number; readonly requestId: number }
/** A retry must trigger another load even when its line offset has not changed. */
export function nextFilePageRequest(previous: FilePageRequest, offset: number): FilePageRequest {
  return { offset, requestId: previous.requestId + 1 }
}
export function appendFilePage(previous: FileTextContent | undefined, page: WorkspaceFileText): FileTextContent {
  if (previous && (previous.version !== page.version || previous.absolutePath !== page.absolutePath)) throw new FileVersionChanged()
  if (page.offset !== (previous?.nextOffset ?? 1) || (!page.eof && page.lines === 0)) throw new Error('読み込み位置を確認できませんでした。')
  return { absolutePath: page.absolutePath, version: page.version, bytes: page.bytes,
    text: previous ? `${previous.text}${page.lines ? '\n' : ''}${page.text}` : page.text,
    nextOffset: page.offset + page.lines, eof: page.eof }
}

/** Byte reads can be capped by the host. Only display complete, same-version images. */
export async function readImageFile(remote: WorkspaceFilesRemote, sessionId: string, path: string, signal: AbortSignal): Promise<WorkspaceFileStat & { data: Uint8Array<ArrayBuffer> }> {
  checkFileReadAbort(signal)
  const stat = unwrapRemoteResult(await remote.stat(sessionId, path, signal))
  checkFileReadAbort(signal)
  if (stat.bytes !== undefined && stat.bytes > MAX_IMAGE_BYTES) throw new ImageFileTooLarge()
  let offset = 0
  const parts: Uint8Array<ArrayBuffer>[] = []
  while (!signal.aborted) {
    const length = Math.min(IMAGE_READ_BYTES, MAX_IMAGE_BYTES - offset)
    if (length === 0) throw new ImageFileTooLarge()
    const page = unwrapRemoteResult(await remote.readBytes(sessionId, path, { range: { offset, length } }, signal))
    checkFileReadAbort(signal)
    if (page.version !== stat.version || page.absolutePath !== stat.absolutePath) throw new FileVersionChanged()
    if (page.bytes !== undefined && page.bytes > MAX_IMAGE_BYTES) throw new ImageFileTooLarge()
    const bytes = page.data
    if (!(bytes instanceof Uint8Array)) throw new Error('画像のデータを確認できませんでした。')
    if (bytes.length > length) throw new ImageFileTooLarge()
    if (bytes.length > MAX_IMAGE_BYTES - offset) throw new ImageFileTooLarge()
    if (page.offset !== offset || (!page.eof && bytes.length === 0)) throw new Error('読み込み位置を確認できませんでした。')
    parts.push(bytes)
    offset += bytes.length
    if (page.eof) {
      const data = new Uint8Array(offset)
      let start = 0
      for (const part of parts) { data.set(part, start); start += part.length }
      return { absolutePath: page.absolutePath, version: page.version, bytes: page.bytes ?? stat.bytes, data }
    }
  }
  throw new DOMException('読み込みを取り消しました。', 'AbortError')
}
