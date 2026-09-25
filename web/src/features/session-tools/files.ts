import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'

/** Wire contracts verified against the installed workspace-files API. */
export interface WorkspaceFileStat { readonly absolutePath: string; readonly version: string; readonly bytes?: number }
export interface WorkspaceFileText extends WorkspaceFileStat { readonly offset: number; readonly text: string; readonly lines: number; readonly eof: boolean }
export interface WorkspaceFileBytes extends WorkspaceFileStat { readonly offset: number; readonly data: string; readonly eof: boolean }
export interface WorkspaceDirectoryEntry { readonly name: string; readonly type: 'file' | 'directory' | 'other'; readonly size?: number }
export interface WorkspaceDirectoryListing { readonly path: string; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }
export type WorkspaceFileChange = { readonly absolutePath: string; readonly version: string } | { readonly absolutePath: string; readonly absent: true }
export type WorkspaceFileWatchFrame = { readonly kind: 'ready' } | { readonly kind: 'change'; readonly change: WorkspaceFileChange }
export interface WorkspaceFilesRemote {
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceDirectoryListing>>
  read(sessionId: string, path: string, range: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileText>>
  readBytes(sessionId: string, path: string, range: { offset?: number; length?: number }, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileStat>>
  changes(sessionId: string, signal?: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
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

export const imageMediaTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
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
export interface FileTextContent extends WorkspaceFileStat { readonly text: string; readonly nextOffset: number; readonly eof: boolean }
export function appendFilePage(previous: FileTextContent | undefined, page: WorkspaceFileText): FileTextContent {
  if (previous && (previous.version !== page.version || previous.absolutePath !== page.absolutePath)) throw new FileVersionChanged()
  if (page.offset !== (previous?.nextOffset ?? 1) || (!page.eof && page.lines === 0)) throw new Error('読み込み位置を確認できませんでした。')
  return { absolutePath: page.absolutePath, version: page.version, bytes: page.bytes,
    text: previous ? `${previous.text}${page.lines ? '\n' : ''}${page.text}` : page.text,
    nextOffset: page.offset + page.lines, eof: page.eof }
}

/** Byte reads can be capped by the host. Only display complete, same-version images. */
export async function readImageFile(remote: WorkspaceFilesRemote, sessionId: string, path: string, signal: AbortSignal): Promise<WorkspaceFileStat & { data: Uint8Array<ArrayBuffer> }> {
  let offset = 0
  let first: WorkspaceFileBytes | undefined
  const parts: Uint8Array<ArrayBuffer>[] = []
  while (!signal.aborted) {
    const page = unwrapRemoteResult(await remote.readBytes(sessionId, path, { offset }, signal))
    if (signal.aborted) throw new DOMException('読み込みを取り消しました。', 'AbortError')
    if (first && (page.version !== first.version || page.absolutePath !== first.absolutePath)) throw new FileVersionChanged()
    const bytes = Uint8Array.from(atob(page.data), character => character.charCodeAt(0))
    if (page.offset !== offset || (!page.eof && bytes.length === 0)) throw new Error('読み込み位置を確認できませんでした。')
    first ??= page
    parts.push(bytes)
    offset += bytes.length
    if (page.eof) {
      const data = new Uint8Array(offset)
      let start = 0
      for (const part of parts) { data.set(part, start); start += part.length }
      return { absolutePath: page.absolutePath, version: page.version, bytes: page.bytes, data }
    }
  }
  throw new DOMException('読み込みを取り消しました。', 'AbortError')
}
