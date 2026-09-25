export interface ReferenceToken {
  start: number
  end: number
  query: string
}

/** Find the mention containing the cursor, while querying only what precedes it. */
export function findReferenceToken(text: string, cursor: number): ReferenceToken | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null
  const before = text.slice(0, cursor)
  const match = /(^|\s)@(?:"([^"\r\n]*)|([^\s"]*))$/u.exec(before)
  if (!match) return null
  const quoted = match[2] !== undefined
  const query = match[2] ?? match[3] ?? ''
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(query)) return null
  const tail = text.slice(cursor)
  const suffix = quoted ? /^[^"\r\n]*"?/u.exec(tail)?.[0] : /^[^\s"]*/u.exec(tail)?.[0]
  return {
    start: before.length - match[0].length + (match[1]?.length ?? 0),
    end: cursor + (suffix?.length ?? 0),
    query,
  }
}

/** The existing DSH mention grammar cannot encode quotes or control characters. */
export function isReferencePathSafe(path: string): boolean {
  return path.length > 0 && !/[\u0000-\u001f\u007f-\u009f"]/u.test(path)
}

export function replaceReference(
  text: string,
  token: ReferenceToken,
  path: string,
  kind: 'file' | 'directory' = 'file',
): { text: string; cursor: number } {
  if (!isReferencePathSafe(path)) throw new Error('このファイル名は参照に使えません。')
  const value = kind === 'directory' && !path.endsWith('/') ? `${path}/` : path
  const mention = /\s/u.test(value) ? `@"${value}"` : `@${value}`
  const suffix = text.slice(token.end)
  // Reuse an existing separator so replacing a word does not add another space.
  const separator = /^\s/u.test(suffix) ? '' : ' '
  const insertion = `${mention}${separator}`
  return {
    text: `${text.slice(0, token.start)}${insertion}${suffix}`,
    cursor: token.start + insertion.length + (separator === '' ? 1 : 0),
  }
}

function commandName(command: { name: string }): string {
  return command.name.replace(/^\//u, '')
}

/** Arguments end name completion; command execution is checked separately. */
export function filterCommands<T extends { name: string }>(commands: readonly T[], text: string): T[] {
  if (!/^\/[^\s]*$/u.test(text)) return []
  const query = text.slice(1)
  return commands.filter(command => commandName(command).startsWith(query))
}

export function isKnownCommand(text: string, commands: readonly { name: string }[]): boolean {
  if (!text.startsWith('/')) return false
  const name = /^\/([^\s]+)/u.exec(text)?.[1]
  return name !== undefined && commands.some(command => commandName(command) === name)
}

export function visibleQueue<T extends { placement: string }>(queue: readonly T[]): T[] {
  return queue.filter(item => item.placement === 'queued' || item.placement === 'steering')
}

export const imageMaxEdge = 2048
export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export function isSupportedImageMediaType(mediaType: string): mediaType is SupportedImageMediaType {
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif'
}

export function shouldConvertImage(mediaType: string, width: number, height: number): boolean {
  return !isSupportedImageMediaType(mediaType) || Math.max(width, height) > imageMaxEdge
}

export function fitImageDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('画像の大きさを読み取れませんでした。')
  }
  const scale = Math.min(1, imageMaxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
