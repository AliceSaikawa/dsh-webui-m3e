import type {
  ContentBlock, FileAttachmentRef, ImageAttachmentRef, PendingSubmission,
  SessionWireEvent,
} from '../../dsh/services.ts'
import { streamBlocksOf, type AssistantStream, type StreamBlock } from '../../dsh/session-journal.ts'

/** Unknown content is kept as a label, without attempting to render its payload. */
export type ChatContentBlock = Exclude<ContentBlock, { type: `plugin:${string}` | 'tool-addition' | 'tool-removal' }>
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
  /** Provider call IDs may repeat in another turn or step. */
  readonly callKey: string
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
  readonly content: readonly ChatContentBlock[]
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

interface ToolScope { readonly turn?: unknown; readonly step?: unknown }
function toolCallKey(scope: ToolScope, callId: string): string {
  const coordinate = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  return JSON.stringify([coordinate(scope.turn), coordinate(scope.step), callId])
}

/** Replacement messages summarize model context; they are not chat history. */
function isChatEvent(event: SessionWireEvent): boolean {
  return event.ignorable !== true && event.surfaceOp !== 'replace' && objectOf(event.surfaceOp)?.op !== 'replace'
}

/** A step has one accepted assistant message; retries remain attempt events. */
function assistantStepKey(turn: unknown, step: unknown): string | undefined {
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0
    && typeof step === 'number' && Number.isSafeInteger(step) && step >= 0
    ? `assistant:${turn}:${step}` : undefined
}

function assistantBlockKey(turn: unknown, step: unknown, index: number, fallback: string): string {
  return `${assistantStepKey(turn, step) ?? fallback}:${index}`
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

/** Narrow V4 wire JSON, preserving unknown kinds only as labels. */
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
  if (kind?.startsWith('plugin:')) return { role: 'inject', label: kind.slice('plugin:'.length) || kind }
  if (kind === 'skill-invocation') return { role: 'inject', label: stringOf(source.name) || kind }
  // Preserve the producer names shown before the wire vocabulary changed.
  // ptc-mode has two historical producers, so it uses the stock UI fallback.
  const producerNames: Record<string, string> = {
    'compact-checkpoint': 'compact', 'compact-basic': 'dsh-compaction-basic',
    'runtime-context': '@deepseek-ai/dsh-system-prompt', 'system-prompt': '@deepseek-ai/dsh-system-prompt',
  }
  if (kind && Object.hasOwn(producerNames, kind)) return { role: 'inject', label: producerNames[kind]! }
  return { role: 'inject', label: kind }
}

const textOf = (content: readonly ChatContentBlock[]): string => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')

export type { StreamBlock }

/** Identify blocks by index and display them in the assembler's first-seen order. */
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
  const message = objectOf(data.message)
  if (message?.role !== 'tool') return []
  const content = contentOf(message.content)
  const failure = data.error !== undefined && data.error !== null && data.error !== false
  const callId = stringOf(message.toolCallId)
  return !callId ? [] : [{ callId, result: { event, content, isError: failure || message.isError === true, ...(failure ? { error: data.error } : {}) } }]
}

/** Map accepted positions back to stream indices; only explicit boundaries time reasoning. */
function assistantBlockMetadata(value: unknown, content: readonly unknown[]): { indices: readonly number[]; durations: ReadonlyMap<number, number> } {
  const boundaries = new Map<number, { type: string; start?: number; end?: number; text?: string; invalid: boolean }>()
  const durations = new Map<number, number>()
  if (!Array.isArray(value)) return { indices: [], durations }
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
  // The DSH assembler keeps first-seen order, not numeric stream indices, and
  // omits tool calls when a max-token finish truncates the accepted message.
  const ordered = [...boundaries.entries()].filter(([, block]) => !dropsToolCalls || block.type !== 'tool-call')
  if (ordered.length !== content.length || ordered.some(([, block], index) => objectOf(content[index])?.type !== block.type)) return { indices: [], durations }
  for (const [index, [, { type, start, end, text, invalid }]] of ordered.entries()) {
    if (type !== 'reasoning' || invalid || start === undefined || end === undefined || text === undefined || objectOf(content[index])?.text !== text) continue
    const duration = end - start
    if (Number.isSafeInteger(duration) && duration >= 0) durations.set(index, duration)
  }
  return { indices: ordered.map(([index]) => index), durations }
}

/** Rows built from durable records, plus what live rows need to join them. */
export interface SettledChat {
  readonly rows: readonly ChatRow[]
  readonly acceptedSteps: ReadonlySet<string>
  readonly rpcIds: ReadonlySet<string>
  readonly keys: ReadonlySet<string>
  readonly shownCalls: ReadonlySet<string>
  toolRow(callId: string, name: string, args: string, base: RowBase, scope: ToolScope): ToolRow
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
      calls.set(toolCallKey(data, data.callId), { event, name: stringOf(data.name) ?? 'ツール', arguments: stringOf(data.arguments) ?? '' })
    } else if (event.type === 'tool/result') {
      for (const { callId, result } of resultsOf(event)) results.set(toolCallKey(data, callId), result)
    } else if (event.type === 'command/run') {
      const name = stringOf(data.name)
      if (name !== undefined) {
        commandNames.set(event.seq, name)
        if (typeof data.commandId === 'string') commandNames.set(data.commandId, name)
      }
    }
  }
  const rows: ChatRow[] = []
  const acceptedSteps = new Set<string>()
  const rpcIds = new Set<string>()
  const shownCalls = new Set<string>()
  const assistantCallIds = new Set<string>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = objectOf(event.data)
    const message = objectOf(data?.message)
    for (const block of contentOf(message?.content)) if (block.type === 'tool-call') assistantCallIds.add(toolCallKey(data ?? {}, block.id))
  }
  const toolRow = (callId: string, name: string, args: string, base: RowBase, scope: ToolScope): ToolRow => {
    const callKey = toolCallKey(scope, callId)
    const result = results.get(callKey)
    const call = calls.get(callKey)
    const duration = result !== undefined && call !== undefined ? result.event.time - call.event.time : undefined
    return {
      ...base, kind: 'tool', callId, callKey, name: name || call?.name || 'ツール', arguments: args || call?.arguments || '',
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
      const source = objectOf(data.source) ?? {}
      if (source.kind !== 'user') {
        rows.push({ ...base, kind: 'context', ...contextProvenance(source), content, text: textOf(content) })
      } else {
        if (typeof source.rpcId === 'string') rpcIds.add(source.rpcId)
        rows.push({ ...base, kind: 'user', content, text: textOf(content) })
      }
    } else if (event.type === 'assistant/message') {
      const stepKey = assistantStepKey(data.turn, data.step)
      if (stepKey !== undefined) acceptedSteps.add(stepKey)
      const message = objectOf(data.message) ?? {}
      const content = Array.isArray(message.content) ? message.content : []
      const { indices, durations } = assistantBlockMetadata(data.stream, content)
      content.forEach((value, index) => {
        const block = contentOf([value])[0]
        if (block === undefined) return
        const blockBase = { ...base, key: assistantBlockKey(data.turn, data.step, indices[index] ?? index, base.key) }
        if (block.type === 'text' || block.type === 'reasoning') {
          const durationMs = block.type === 'reasoning' ? durations.get(index) : undefined
          rows.push({ ...blockBase, kind: block.type === 'text' ? 'assistant' : 'reasoning', text: block.text, streaming: false,
            ...(durationMs === undefined ? {} : { durationMs }),
          })
        } else if (block.type === 'tool-call') {
          const callKey = toolCallKey(data, block.id)
          if (shownCalls.has(callKey)) return
          shownCalls.add(callKey)
          rows.push(toolRow(block.id, block.name, block.arguments, blockBase, data))
        }
      })
    } else if (event.type === 'tool/result') {
      for (const { callId } of resultsOf(event)) {
        const callKey = toolCallKey(data, callId)
        if (shownCalls.has(callKey) || assistantCallIds.has(callKey)) continue
        shownCalls.add(callKey)
        const call = calls.get(callKey)
        rows.push(toolRow(callId, call?.name ?? 'ツール', call?.arguments ?? '', { ...base, key: `${base.key}:${callId}` }, data))
      }
    } else if (event.type === 'system/message') {
      const message = objectOf(data.message)
      const text = textOf(contentOf(message?.content))
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
  return { rows, rpcIds, keys: new Set(rows.map(row => row.key)), shownCalls, acceptedSteps, toolRow }
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
  if (stream !== null && !settled.acceptedSteps.has(assistantStepKey(stream.turn, stream.step) ?? '')) {
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
      } else if (block.type === 'tool-call') {
        const callKey = toolCallKey(stream, block.id)
        if (settled.shownCalls.has(callKey) || shownCalls.has(callKey)) continue
        shownCalls.add(callKey)
        rows.push(settled.toolRow(block.id, block.name, block.arguments, base, stream))
      }
    }
  }
  for (const submission of pendingSubmissions) {
    if (submission.placement !== 'transcript' || settled.rpcIds.has(submission.requestId)) continue
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
