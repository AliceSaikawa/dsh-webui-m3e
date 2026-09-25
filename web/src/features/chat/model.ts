import type {
  ContentBlock, FileAttachmentRef, ImageAttachmentRef, PendingSubmission,
  SessionWireEvent,
} from '../../dsh/services.ts'
import type { AssistantStream } from '../../dsh/session-journal.ts'

/** Unknown content is kept as a label, without attempting to render its payload. */
export type ChatContentBlock = Exclude<ContentBlock, { type: 'tool-result' }>
  | { type: 'tool-result'; toolCallId: string; content: ChatContentBlock[]; isError?: boolean }
  | { type: 'unsupported'; originalType: string }

interface RowBase {
  readonly key: string
  readonly seq?: number
  readonly time?: number
}
export interface UserRow extends RowBase {
  readonly kind: 'user'
  readonly content: readonly ChatContentBlock[]
  readonly text: string
}
export interface TextRow extends RowBase {
  readonly kind: 'assistant' | 'reasoning'
  readonly text: string
  readonly streaming: boolean
}
export interface ToolRow extends RowBase {
  readonly kind: 'tool'
  readonly callId: string
  readonly name: string
  readonly arguments: string
  readonly result: readonly ChatContentBlock[]
  readonly status: 'running' | 'success' | 'error'
  readonly durationMs?: number
  readonly error?: unknown
}
export interface SystemRow extends RowBase {
  readonly kind: 'system'
  readonly text: string
}
export interface CommandRow extends RowBase {
  readonly kind: 'command'
  readonly name: string
  readonly text: string
}
export interface PendingRow extends RowBase {
  readonly kind: 'pending'
  readonly submission: PendingSubmission
  readonly text: string
}
export type ChatRow = UserRow | TextRow | ToolRow | SystemRow | CommandRow | PendingRow

type ObjectValue = Record<string, unknown>
const objectOf = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
const stringOf = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

function fileAttachment(value: unknown): FileAttachmentRef | undefined {
  const attachment = objectOf(value)
  if (attachment === undefined || typeof attachment.attachmentId !== 'string') return undefined
  return {
    attachmentId: attachment.attachmentId,
    name: stringOf(attachment.name) ?? '添付ファイル',
    bytes: typeof attachment.bytes === 'number' ? attachment.bytes : 0,
  }
}

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  const attachment = objectOf(value)
  const file = fileAttachment(value)
  if (attachment === undefined || file === undefined) return undefined
  const mediaType = attachment.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') return undefined
  return {
    ...file, mediaType,
    width: typeof attachment.width === 'number' ? attachment.width : 0,
    height: typeof attachment.height === 'number' ? attachment.height : 0,
  }
}

/** Narrow wire JSON locally; the shared service contracts stay untouched. */
function contentOf(value: unknown): ChatContentBlock[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value): ChatContentBlock[] => {
    const block = objectOf(value)
    if (block === undefined || typeof block.type !== 'string') return []
    if (block.type === 'text' || block.type === 'reasoning') {
      return typeof block.text === 'string' ? [{ type: block.type, text: block.text }] : []
    }
    if (block.type === 'tool-call') {
      return typeof block.id === 'string' ? [{ type: 'tool-call', id: block.id, name: stringOf(block.name) ?? 'ツール', arguments: stringOf(block.arguments) ?? '' }] : []
    }
    if (block.type === 'image') {
      const attachment = imageAttachment(block.attachment)
      return attachment === undefined ? [] : [{ type: 'image', attachment }]
    }
    if (block.type === 'file') {
      const attachment = fileAttachment(block.attachment)
      return attachment === undefined ? [] : [{ type: 'file', attachment }]
    }
    if (block.type === 'tool-result') {
      // The envelope is flattened below when correlating a result with its call.
      // Nested envelopes are retained so the detail view can render their kinds.
      return [{ type: 'tool-result', toolCallId: stringOf(block.toolCallId) ?? '', content: contentOf(block.content), ...(block.isError === true ? { isError: true } : {}) }]
    }
    return [{ type: 'unsupported', originalType: block.type }]
  })
}

const textOf = (content: readonly ChatContentBlock[]): string => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')

export interface StreamBlock {
  readonly index: number
  readonly block: ContentBlock
  readonly complete: boolean
}

/** Fold by block index rather than arrival order; final blocks replace all deltas. */
export function getStreamBlocks(stream: AssistantStream): StreamBlock[] {
  if (stream.chunks.length === 0) {
    return stream.content.map((block, index) => ({ index, block, complete: stream.finishReason !== undefined }))
  }
  const blocks = new Map<number, StreamBlock>()
  let finished = false
  for (const chunk of stream.chunks) {
    if (chunk.type === 'usage') continue
    if (chunk.type === 'finish') { finished = true; continue }
    const previous = blocks.get(chunk.index)
    if (chunk.type === 'block-end') {
      blocks.set(chunk.index, { index: chunk.index, block: chunk.block, complete: true })
      continue
    }
    if (chunk.type === 'block-start') {
      if (chunk.blockType === 'text' || chunk.blockType === 'reasoning') {
        blocks.set(chunk.index, { index: chunk.index, block: { type: chunk.blockType, text: '' }, complete: false })
      }
      continue
    }
    if (previous?.complete) continue
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const prefix = previous?.block.type === type ? previous.block.text : ''
      blocks.set(chunk.index, { index: chunk.index, block: { type, text: prefix + chunk.text }, complete: false })
    } else if (chunk.type === 'tool-call-delta') {
      const previousCall = previous?.block.type === 'tool-call' ? previous.block : undefined
      blocks.set(chunk.index, {
        index: chunk.index, complete: false,
        block: { type: 'tool-call', id: chunk.id, name: chunk.name ?? previousCall?.name ?? '', arguments: (previousCall?.arguments ?? '') + chunk.argumentsDelta },
      })
    }
  }
  return [...blocks.values()].sort((a, b) => a.index - b.index).map(value => finished || stream.finishReason !== undefined ? { ...value, complete: true } : value)
}

interface ResultInfo {
  event: SessionWireEvent
  content: readonly ChatContentBlock[]
  isError: boolean
  error?: unknown
}

function resultsOf(event: SessionWireEvent): { callId: string; result: ResultInfo }[] {
  const data = objectOf(event.data)
  if (data === undefined) return []
  const message = objectOf(data.message) ?? data
  const content = contentOf(message.content)
  const results = content.filter((block): block is Extract<ChatContentBlock, { type: 'tool-result' }> => block.type === 'tool-result')
  const failure = data.error !== undefined && data.error !== null && data.error !== false
  if (results.length > 0) {
    return results.map(block => ({ callId: block.toolCallId, result: { event, content: block.content, isError: failure || data.isError === true || message.isError === true || block.isError === true, ...(failure ? { error: data.error } : {}) } }))
  }
  const source = objectOf(message.source)
  const callId = stringOf(data.callId) ?? stringOf(message.toolCallId) ?? stringOf(source?.callId)
  return callId === undefined ? [] : [{ callId, result: { event, content, isError: failure || data.isError === true || message.isError === true, ...(failure ? { error: data.error } : {}) } }]
}

/** Produce one immutable display list without mutating the controller journal. */
export function buildChatRows(
  records: readonly SessionWireEvent[],
  stream: AssistantStream | null = null,
  pendingSubmissions: readonly PendingSubmission[] = [],
): ChatRow[] {
  const events = records.filter(event => event.ignorable !== true).slice().sort((a, b) => a.seq - b.seq)
  const calls = new Map<string, { event: SessionWireEvent; name: string; arguments: string }>()
  const results = new Map<string, ResultInfo>()
  const commandNames = new Map<string | number, string>()
  for (const event of events) {
    const data = objectOf(event.data)
    if (data === undefined) continue
    if (event.type === 'tool/call' && typeof data.callId === 'string') {
      calls.set(data.callId, { event, name: stringOf(data.name) ?? 'ツール', arguments: stringOf(data.arguments) ?? '' })
    } else if (event.type === 'tool/result') {
      for (const { callId, result } of resultsOf(event)) results.set(callId, result)
    } else if (event.type === 'command/run') {
      const name = stringOf(data.name)
      if (name !== undefined) {
        commandNames.set(event.seq, name)
        if (typeof data.commandId === 'string') commandNames.set(data.commandId, name)
      }
    }
  }
  const rows: ChatRow[] = []
  const shownCalls = new Set<string>()
  const assistantCallIds = new Set<string>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = objectOf(event.data)
    const message = objectOf(data?.message) ?? data
    for (const block of contentOf(message?.content)) if (block.type === 'tool-call') assistantCallIds.add(block.id)
  }
  const toolRow = (callId: string, name: string, args: string, base: RowBase): ToolRow => {
    shownCalls.add(callId)
    const result = results.get(callId)
    const call = calls.get(callId)
    const duration = result !== undefined && call !== undefined ? result.event.time - call.event.time : undefined
    return {
      ...base, kind: 'tool', callId, name: name || call?.name || 'ツール', arguments: args || call?.arguments || '',
      result: result?.content ?? [], status: result === undefined ? 'running' : result.isError ? 'error' : 'success',
      ...(duration !== undefined && Number.isFinite(duration) ? { durationMs: Math.max(0, duration) } : {}),
      ...(result?.error !== undefined ? { error: result.error } : {}),
    }
  }
  for (const event of events) {
    const data = objectOf(event.data)
    if (data === undefined) continue
    const base = { key: `event:${event.seq}`, seq: event.seq, time: event.time }
    if (event.type === 'user/message') {
      const content = contentOf(data.content)
      rows.push({ ...base, kind: 'user', content, text: textOf(content) })
    } else if (event.type === 'assistant/message') {
      const message = objectOf(data.message) ?? data
      contentOf(message.content).forEach((block, index) => {
        const blockBase = { ...base, key: `${base.key}:${index}` }
        if (block.type === 'text' || block.type === 'reasoning') {
          rows.push({ ...blockBase, kind: block.type === 'text' ? 'assistant' : 'reasoning', text: block.text, streaming: false })
        } else if (block.type === 'tool-call' && !shownCalls.has(block.id)) {
          rows.push(toolRow(block.id, block.name, block.arguments, blockBase))
        }
      })
    } else if (event.type === 'tool/result') {
      for (const { callId } of resultsOf(event)) {
        if (shownCalls.has(callId) || assistantCallIds.has(callId)) continue
        const call = calls.get(callId)
        rows.push(toolRow(callId, call?.name ?? 'ツール', call?.arguments ?? '', { ...base, key: `${base.key}:${callId}` }))
      }
    } else if (event.type === 'system/message') {
      const message = objectOf(data.message)
      const content = contentOf(message?.content ?? data.content)
      const text = stringOf(data.message) ?? stringOf(message?.text) ?? stringOf(data.text) ?? textOf(content)
      if (text) rows.push({ ...base, kind: 'system', text })
    } else if (event.type === 'command/done') {
      const name = stringOf(data.name)
        ?? (typeof data.commandId === 'string' ? commandNames.get(data.commandId) : undefined)
        ?? (typeof data.sourceEventSeq === 'number' ? commandNames.get(data.sourceEventSeq) : undefined)
        ?? ''
      rows.push({ ...base, kind: 'command', name, text: stringOf(data.text) ?? '' })
    }
  }
  if (stream !== null) {
    for (const { index, block, complete } of getStreamBlocks(stream)) {
      const base = { key: `stream:${stream.attemptId}:${index}` }
      if (block.type === 'text' || block.type === 'reasoning') {
        rows.push({ ...base, kind: block.type === 'text' ? 'assistant' : 'reasoning', text: block.text, streaming: !complete })
      } else if (block.type === 'tool-call' && !shownCalls.has(block.id)) {
        rows.push(toolRow(block.id, block.name, block.arguments, base))
      }
    }
  }
  for (const submission of pendingSubmissions) {
    if (submission.placement !== 'transcript') continue
    rows.push({ key: `pending:${submission.requestId}`, kind: 'pending', time: submission.time, submission, text: submission.text })
  }
  return rows
}

export function summarizeToolArguments(raw: string, maxLength = 100): string | undefined {
  let parsed: ObjectValue | undefined
  try { parsed = objectOf(JSON.parse(raw)) } catch { return undefined }
  if (parsed === undefined) return undefined
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'url']) {
    const value = parsed[key]
    if (typeof value !== 'string') continue
    const characters = Array.from(value.replace(/\s+/gu, ' ').trim())
    if (characters.length === 0) continue
    const limit = Math.max(1, Math.floor(maxLength))
    return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('')
  }
  return undefined
}

export function formatToolArguments(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '不明'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ミリ秒`
  if (milliseconds < 60000) return `${Number((milliseconds / 1000).toFixed(1))} 秒`
  const minutes = Math.floor(milliseconds / 60000)
  const seconds = Math.floor((milliseconds % 60000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

export interface ScrollMetrics { readonly scrollHeight: number; readonly clientHeight: number; readonly scrollTop: number }
export function isNearBottom(metrics: ScrollMetrics, threshold = 64): boolean {
  return metrics.scrollHeight - metrics.clientHeight - Math.max(0, metrics.scrollTop) <= threshold
}
export function preservePrependScroll(before: ScrollMetrics, afterHeight: number): number {
  return Math.max(0, before.scrollTop + afterHeight - before.scrollHeight)
}
