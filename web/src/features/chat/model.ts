import type {
  ContentBlock, FileAttachmentRef, ImageAttachmentRef, PendingSubmission,
  SessionWireEvent,
} from '../../dsh/services.ts'
import { streamBlocksOf, type AssistantStream, type StreamBlock } from '../../dsh/session-journal.ts'

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
  readonly durationMs?: number
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
/** Producer-supplied context that DSH logs as a user message; the model reads it, the user did not write it. */
export interface ContextRow extends RowBase {
  readonly kind: 'context'
  readonly role: 'inject' | 'recall'
  /** Producer named by the durable source, such as the instruction file paths. */
  readonly label: string | null
  readonly text: string
}
export interface CommandRow extends RowBase {
  readonly kind: 'command'
  readonly name: string
  readonly text: string
  readonly status: 'success' | 'error' | 'unknown'
}
export interface PendingRow extends RowBase {
  readonly kind: 'pending'
  readonly submission: PendingSubmission
  readonly text: string
}
export type ChatRow = UserRow | ContextRow | TextRow | ToolRow | SystemRow | CommandRow | PendingRow

type ObjectValue = Record<string, unknown>
const objectOf = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
const stringOf = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

/** Replacement messages summarize model context; they are not chat history. */
function isChatEvent(event: SessionWireEvent): boolean {
  return event.ignorable !== true && event.surfaceOp !== 'replace' && objectOf(event.surfaceOp)?.op !== 'replace'
}

/** A step has one accepted assistant message; retries remain attempt events. */
function assistantBlockKey(turn: unknown, step: unknown, index: number, fallback: string): string {
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0
    && typeof step === 'number' && Number.isSafeInteger(step) && step >= 0
    ? `assistant:${turn}:${step}:${index}`
    : `${fallback}:${index}`
}

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

function distinctStrings(list: unknown, field: string): string[] {
  if (!Array.isArray(list)) return []
  const seen: string[] = []
  for (const entry of list) {
    const value = stringOf(objectOf(entry)?.[field])
    if (value && !seen.includes(value)) seen.push(value)
  }
  return seen
}

/** Mirrors DSH's contextProvenance: the row header names who injected the context. */
function contextProvenance(source: ObjectValue): Pick<ContextRow, 'role' | 'label'> {
  const kind = stringOf(source.kind) || null
  const joined = (names: string[]) => names.length > 0 ? names.join(', ') : kind
  if (kind === 'session-reference') return { role: 'recall', label: joined(distinctStrings(source.references, 'label')) }
  if (kind === 'agent-instructions') return { role: 'inject', label: joined(distinctStrings(source.changes, 'path')) }
  if (kind === 'plugin') return { role: 'inject', label: stringOf(source.plugin) || kind }
  if (kind === 'skill-invocation') return { role: 'inject', label: stringOf(source.name) || kind }
  return { role: 'inject', label: kind }
}

const textOf = (content: readonly ChatContentBlock[]): string => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')

export type { StreamBlock }

/** Fold by block index rather than arrival order; final blocks replace all deltas. */
export function getStreamBlocks(stream: AssistantStream): readonly StreamBlock[] {
  return streamBlocksOf(stream)
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

/** Only explicit per-block boundaries establish the full reasoning interval. */
function reasoningDurations(value: unknown, content: readonly unknown[]): ReadonlyMap<number, number> {
  const boundaries = new Map<number, { type: string; start?: number; end?: number; text?: string; invalid: boolean }>()
  if (!Array.isArray(value)) return new Map()
  let dropsToolCalls = false
  for (const candidate of value) {
    const record = objectOf(candidate)
    if (record === undefined) continue
    const chunk = record.type === 'chunk' ? objectOf(record.chunk) : undefined
    if (chunk?.type === 'finish') {
      dropsToolCalls = objectOf(chunk.reason)?.kind === 'max-tokens'
      continue
    }
    const type = chunk?.type === 'block-start' ? stringOf(chunk.blockType)
      : chunk?.type === 'block-end' ? stringOf(objectOf(chunk.block)?.type)
      : chunk?.type === 'text-delta' || record.type === 'text-chunks' ? 'text'
      : chunk?.type === 'reasoning-delta' || record.type === 'reasoning-chunks' ? 'reasoning'
      : chunk?.type === 'tool-call-delta' || record.type === 'tool-call-chunks' ? 'tool-call'
      : undefined
    if (type === undefined) continue
    const index = chunk?.index ?? record.index
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) continue
    const previous = boundaries.get(index)
    const state = previous ?? { type, invalid: false }
    boundaries.set(index, state)
    if (state.type !== type) state.invalid = true
    if (type !== 'reasoning' || (chunk?.type !== 'block-start' && chunk?.type !== 'block-end')) continue
    const time = record.time
    if (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0) {
      state.invalid = true
      continue
    }
    if (chunk.type === 'block-start') {
      if (state.start !== undefined || state.end !== undefined) state.invalid = true
      state.start = time
    } else {
      if (state.start === undefined || state.end !== undefined) state.invalid = true
      state.end = time
      state.text = stringOf(objectOf(chunk.block)?.text)
    }
  }
  const durations = new Map<number, number>()
  // The DSH assembler keeps first-seen order, not numeric stream indices, and
  // omits tool calls when a max-token finish truncates the accepted message.
  const ordered = [...boundaries.values()].filter(block => !dropsToolCalls || block.type !== 'tool-call')
  if (ordered.length !== content.length || ordered.some((block, index) => objectOf(content[index])?.type !== block.type)) return durations
  for (const [index, { type, start, end, text, invalid }] of ordered.entries()) {
    if (type !== 'reasoning' || invalid || start === undefined || end === undefined || text === undefined || objectOf(content[index])?.text !== text) continue
    const duration = end - start
    if (Number.isSafeInteger(duration) && duration >= 0) durations.set(index, duration)
  }
  return durations
}

/** Rows built from durable records, plus what live rows need to join them. */
export interface SettledChat {
  readonly rows: readonly ChatRow[]
  readonly keys: ReadonlySet<string>
  readonly shownCalls: ReadonlySet<string>
  toolRow(callId: string, name: string, args: string, base: RowBase): ToolRow
}

/**
 * Build the rows for durable records once per records array. A streaming
 * response only changes the live rows, so these rows keep their identity.
 */
export function buildSettledChat(records: readonly SessionWireEvent[]): SettledChat {
  const events = records.filter(isChatEvent).sort((a, b) => a.seq - b.seq)
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
      // DSH logs injected context (instruction files, skills, recalls) as user
      // messages whose source is not the user; only the user's own input is a bubble.
      const source = objectOf(data.source)
      if (source !== undefined && source.kind !== 'user') {
        rows.push({ ...base, kind: 'context', ...contextProvenance(source), text: textOf(content) })
      } else {
        rows.push({ ...base, kind: 'user', content, text: textOf(content) })
      }
    } else if (event.type === 'assistant/message') {
      const message = objectOf(data.message) ?? data
      const content = Array.isArray(message.content) ? message.content : []
      const durations = reasoningDurations(data.stream, content)
      content.forEach((value, index) => {
        const block = contentOf([value])[0]
        if (block === undefined) return
        const blockBase = { ...base, key: assistantBlockKey(data.turn, data.step, index, base.key) }
        if (block.type === 'text' || block.type === 'reasoning') {
          const durationMs = block.type === 'reasoning' ? durations.get(index) : undefined
          rows.push({ ...blockBase, kind: block.type === 'text' ? 'assistant' : 'reasoning', text: block.text, streaming: false,
            ...(durationMs === undefined ? {} : { durationMs }),
          })
        } else if (block.type === 'tool-call' && !shownCalls.has(block.id)) {
          shownCalls.add(block.id)
          rows.push(toolRow(block.id, block.name, block.arguments, blockBase))
        }
      })
    } else if (event.type === 'tool/result') {
      for (const { callId } of resultsOf(event)) {
        if (shownCalls.has(callId) || assistantCallIds.has(callId)) continue
        shownCalls.add(callId)
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
      const status = data.kind === 'success' || data.kind === 'error' ? data.kind : 'unknown'
      rows.push({ ...base, kind: 'command', name, text: stringOf(data.text) ?? '', status })
    }
  }
  return { rows, keys: new Set(rows.map(row => row.key)), shownCalls, toolRow }
}

/** A text block that has not changed keeps its row, so its Markdown is not rendered again. */
const liveTextRows = new WeakMap<StreamBlock, TextRow>()

/** Append the live stream and unsent submissions to settled rows without touching them. */
export function appendLiveRows(
  settled: SettledChat,
  stream: AssistantStream | null,
  pendingSubmissions: readonly PendingSubmission[] = [],
): ChatRow[] {
  const rows = [...settled.rows]
  if (stream !== null) {
    const shownCalls = new Set<string>()
    for (const value of getStreamBlocks(stream)) {
      const { index, block, complete } = value
      const base = { key: assistantBlockKey(stream.turn, stream.step, index, `stream:${stream.attemptId}`) }
      if (settled.keys.has(base.key)) continue
      if (block.type === 'text' || block.type === 'reasoning') {
        let row = liveTextRows.get(value)
        if (row?.key !== base.key) {
          row = { ...base, kind: block.type === 'text' ? 'assistant' : 'reasoning', text: block.text, streaming: !complete }
          liveTextRows.set(value, row)
        }
        rows.push(row)
      } else if (block.type === 'tool-call' && !settled.shownCalls.has(block.id) && !shownCalls.has(block.id)) {
        shownCalls.add(block.id)
        rows.push(settled.toolRow(block.id, block.name, block.arguments, base))
      }
    }
  }
  for (const submission of pendingSubmissions) {
    if (submission.placement !== 'transcript') continue
    rows.push({ key: `pending:${submission.requestId}`, kind: 'pending', time: submission.time, submission, text: submission.text })
  }
  return rows
}

/** Produce one immutable display list without mutating the controller journal. */
export function buildChatRows(
  records: readonly SessionWireEvent[],
  stream: AssistantStream | null = null,
  pendingSubmissions: readonly PendingSubmission[] = [],
): ChatRow[] {
  return appendLiveRows(buildSettledChat(records), stream, pendingSubmissions)
}

export interface CommandPresentation {
  readonly label: string
  readonly icon: 'terminal' | 'error' | 'info'
  readonly failureReason?: string
}

/** Keep missing outcomes neutral and failures distinct in the collapsed row. */
export function commandPresentation(row: Pick<CommandRow, 'name' | 'text' | 'status'>): CommandPresentation {
  const name = row.name ? `/${row.name} ` : 'コマンド'
  if (row.status === 'error') {
    return { label: `${name}の実行に失敗しました`, icon: 'error', failureReason: row.text.trim() || '詳しい理由は記録されていません。' }
  }
  if (row.status === 'success') return { label: `${name}を実行しました`, icon: 'terminal' }
  return { label: `${name}の結果を受け取りました`, icon: 'info' }
}

/** Tool identity stays independent of its running or failed status. */
export function toolIcon(name: string): 'description' | 'terminal' {
  return name === 'read_file' ? 'description' : 'terminal'
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
