import type { ContentBlock, SessionWireEvent, TokenUsage } from '../../dsh/services.ts'
import type { AssistantStream } from '../../dsh/session-journal.ts'
import { formatNumber } from '../../i18n/format.ts'
import { SOURCE_LOCALE, type Locale } from '../../i18n/locale.ts'
import { traceText, type TraceMessages } from './messages.ts'

type Data = Record<string, unknown>
export type TraceKind = 'user' | 'assistant' | 'tool' | 'subtool' | 'compaction'
/** View-only grouping for a V4 tool message in reconstructed model input. */
export type TraceInputBlock = ContentBlock | { type: 'tool-output'; toolCallId: string; content: ContentBlock[]; isError?: boolean }
export interface TraceTermination {
  kind: 'error' | 'aborted' | 'interrupted' | 'blocked' | 'max-tokens'
  message: string
}
export interface TraceAttempt {
  seq: number
  time: number
  termination?: TraceTermination
}
export interface TraceRow {
  id: string
  kind: TraceKind
  turn: number | null
  step?: number
  seq: number
  title: string
  toolName?: string
  content: ContentBlock[]
  /** Resolved only when details read it; list rendering must not access it. */
  readonly input: TraceInputBlock[]
  arguments?: string
  /** Formatting omitted part of the arguments or summary, so search covers only the shown text. */
  partialText?: boolean
  callId?: string
  parentCallId?: string
  rootCallId?: string
  depth: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  firstOutputMs?: number
  usage?: TokenUsage
  /** Number of durable assistant/attempt events, not the number of retries. */
  retries: number
  running: boolean
  failed: boolean
  error?: string
  termination?: TraceTermination
  attempts?: TraceAttempt[]
}
export interface TraceTurn {
  id: string
  number: number | null
  startedAt?: number
  completedAt?: number
  durationMs?: number
  running: boolean
  partial: boolean
  usage?: TokenUsage
  rows: TraceRow[]
  termination?: TraceTermination
}

export function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
}
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function validBlock(value: unknown): value is ContentBlock {
  const block = object(value)
  switch (block.type) {
    case 'text': case 'reasoning': return typeof block.text === 'string'
    case 'tool-call': return typeof block.name === 'string' && typeof block.arguments === 'string'
    case 'image': case 'file': {
      const attachment = object(block.attachment)
      return typeof attachment.attachmentId === 'string' && number(attachment.bytes) !== undefined
        && (attachment.name === undefined || typeof attachment.name === 'string')
        && (block.type === 'file' ? typeof attachment.name === 'string'
          : typeof attachment.mediaType === 'string' && number(attachment.width) !== undefined && number(attachment.height) !== undefined)
    }
    default: return typeof block.type === 'string' && block.type !== 'tool-output'
  }
}
export function blocks(value: unknown): ContentBlock[] {
  return Array.isArray(value) ? value.filter(validBlock) : []
}
export function elapsed(start: number | undefined, end: number | undefined): number | undefined {
  return start === undefined || end === undefined ? undefined : Math.max(0, end - start)
}
/** Match chat's units and rounding; absent timestamps remain unmeasured. */
export function formatDuration(ms: number | undefined, text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): string {
  if (ms === undefined) return text.durationNotMeasured
  if (!Number.isFinite(ms) || ms < 0) return text.durationInvalid
  if (ms < 1000) return text.durationMilliseconds(formatNumber(locale, Math.round(ms), { useGrouping: false }))
  if (ms < 60000) return text.durationSeconds(formatNumber(locale, Number((ms / 1000).toFixed(1)), { maximumFractionDigits: 1, useGrouping: false }))
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return text.durationMinutesSeconds(formatNumber(locale, minutes, { useGrouping: false }), formatNumber(locale, seconds, { useGrouping: false }))
}
export function formatCount(value: number, locale: Locale = SOURCE_LOCALE): string { return formatNumber(locale, value) }
const rowIcons: Record<TraceKind, string> = {
  user: 'person', assistant: 'smart_toy', tool: 'terminal', subtool: 'subdirectory_arrow_right', compaction: 'summarize',
}
export function traceRowIcon(row: TraceRow): string {
  if (row.kind === 'tool' || row.kind === 'subtool') {
    if (row.toolName === 'read_file') return 'description'
    if (row.toolName === 'bash') return 'terminal'
  }
  return rowIcons[row.kind]
}
function fillToolName(row: TraceRow, name: string | undefined, text: TraceMessages): void {
  if (row.toolName !== undefined || name === undefined) return
  row.toolName = name
  row.title = row.kind === 'subtool' ? text.subtoolTitle(name) : text.toolTitle(name)
}
/** Bounds for formatting untrusted JSON: visited values, nesting depth. */
export const JSON_NODE_LIMIT = 10000
export const JSON_DEPTH_LIMIT = 64
/** Bounds for collecting searchable text from nested content blocks. */
export const CONTENT_BLOCK_LIMIT = 10000
export const CONTENT_DEPTH_LIMIT = 64
export type JsonOmissionReason = 'cycle' | 'depth' | 'limit'
/** Placeholder in a safe copy. Printed unquoted, so it cannot be mistaken for a JSON string. */
export class JsonOmission {
  readonly reason: JsonOmissionReason
  constructor(reason: JsonOmissionReason) { this.reason = reason }
}
export type SafeJson = null | boolean | number | string | JsonOmission | SafeJson[] | { [key: string]: SafeJson }
function omissionText(reason: JsonOmissionReason, text: TraceMessages, locale: Locale): string {
  switch (reason) {
    case 'cycle': return text.jsonOmittedCycle
    case 'depth': return text.jsonOmittedDepth(formatNumber(locale, JSON_DEPTH_LIMIT))
    case 'limit': return text.jsonOmittedLimit(formatNumber(locale, JSON_NODE_LIMIT))
  }
}

/** The value JSON.stringify would serialize: toJSON first, then boxed primitives unwrapped. */
function jsonValue(value: unknown, key: string): unknown {
  if ((typeof value === 'object' && value !== null) || typeof value === 'bigint') {
    const toJSON = (value as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') value = toJSON.call(value, key)
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) return value.valueOf()
  return value
}
/**
 * Copy untrusted data into plain JSON values by explicit recursion. The
 * ancestor path detects cycles (shared, acyclic references stay), recursion
 * stops at JSON_DEPTH_LIMIT, and copying stops after JSON_NODE_LIMIT values.
 * Each cut is a JsonOmission carrying its reason. Throws like JSON.stringify
 * for BigInt and for failing accessors or toJSON.
 */
export function safeJsonCopy(input: unknown): { value: SafeJson | undefined; omissions: JsonOmissionReason[] } {
  const omissions = new Set<JsonOmissionReason>()
  const ancestors: { value: object; raw: unknown }[] = []
  let nodes = 0
  let exhausted = false
  const omit = (reason: JsonOmissionReason) => { omissions.add(reason); return new JsonOmission(reason) }
  const copy = (raw: unknown, key: string): SafeJson | undefined => {
    if (++nodes > JSON_NODE_LIMIT) { exhausted = true; return omit('limit') }
    const value = jsonValue(raw, key)
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'bigint') throw new TypeError('BigInt cannot be represented in JSON.')
    if (typeof value !== 'object') return undefined
    // Compare originals as well: a toJSON result can be a fresh object that leads back to its owner.
    const seen = (item: unknown) => item === value || item === raw
    if (ancestors.some(frame => seen(frame.value) || seen(frame.raw))) return omit('cycle')
    if (ancestors.length >= JSON_DEPTH_LIMIT) return omit('depth')
    ancestors.push({ value, raw })
    try {
      if (Array.isArray(value)) {
        const items: SafeJson[] = []
        for (let index = 0; index < value.length && !exhausted; index++) items.push(copy(value[index], String(index)) ?? null)
        return items
      }
      // A null prototype keeps a "__proto__" key as plain data.
      const entries = Object.create(null) as { [key: string]: SafeJson }
      for (const name of Object.keys(value)) {
        if (exhausted) break
        const child = copy((value as Data)[name], name)
        if (child !== undefined) entries[name] = child
      }
      return entries
    } finally { ancestors.pop() }
  }
  const value = copy(input, '')
  return { value, omissions: [...omissions] }
}
/** Same layout as JSON.stringify(value, null, 2); omissions are printed as unquoted marks. */
function printJson(value: SafeJson, indent: string, text: TraceMessages, locale: Locale): string {
  if (value instanceof JsonOmission) return omissionText(value.reason, text, locale)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map(item => inner + printJson(item, inner, text, locale)).join(',\n')}\n${indent}]` : '[]'
  }
  const keys = Object.keys(value)
  return keys.length ? `{\n${keys.map(key => `${inner}${JSON.stringify(key)}: ${printJson(value[key]!, inner, text, locale)}`).join(',\n')}\n${indent}}` : '{}'
}
/** Formatted JSON and whether any part of the original is missing from the text. */
export function formatJson(value: unknown, text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): { text: string; partial: boolean } {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return { text: value as string, partial: false } }
  }
  try {
    const copy = safeJsonCopy(value)
    return { text: copy.value === undefined ? '' : printJson(copy.value, '', text, locale), partial: copy.omissions.length > 0 }
  } catch { return { text: text.jsonUnreadable, partial: true } }
}
export function prettyJson(value: unknown, text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): string {
  return formatJson(value, text, locale).text
}
/** Searchable text of content blocks, and whether the bounded walk skipped any of them. */
export function contentSearchText(content: readonly TraceInputBlock[], text: TraceMessages = traceText): { text: string; partial: boolean } {
  const parts: string[] = []
  const stack: { items: readonly unknown[]; index: number }[] = [{ items: Array.isArray(content) ? content : [], index: 0 }]
  let partial = false
  let remaining = CONTENT_BLOCK_LIMIT
  while (stack.length) {
    const frame = stack.at(-1)!
    if (frame.index >= frame.items.length) { stack.pop(); continue }
    if (remaining-- <= 0) { partial = true; break }
    const block = object(frame.items[frame.index++])
    if (block.type === 'tool-output') {
      if (Array.isArray(block.content)) {
        if (stack.length < CONTENT_DEPTH_LIMIT) stack.push({ items: block.content, index: 0 })
        else if (block.content.length) partial = true
      }
      continue
    }
    if (!validBlock(block)) continue
    switch (block.type) {
      case 'text': case 'reasoning': parts.push(block.text); break
      case 'tool-call': parts.push(`${block.name} ${block.arguments}`); break
      case 'image': case 'file': parts.push(block.attachment.name ?? text.attachmentFallback); break
    }
  }
  return { text: parts.join('\n'), partial }
}
export function contentText(content: readonly TraceInputBlock[], text: TraceMessages = traceText): string {
  return contentSearchText(content, text).text
}
function usageOf(value: unknown): TokenUsage | undefined {
  const data = object(value)
  const inputTokens = number(data.inputTokens), outputTokens = number(data.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens + (number(data.cacheReadTokens) ?? 0) + (number(data.cacheWriteTokens) ?? 0),
    cacheReadTokens: number(data.cacheReadTokens), cacheWriteTokens: number(data.cacheWriteTokens), reasoningTokens: number(data.reasoningTokens) }
}
function sumUsage(rows: TraceRow[]): TokenUsage | undefined {
  const usages = rows.filter(row => row.kind === 'assistant' && !row.running).flatMap(row => row.usage ? [row.usage] : [])
  if (!usages.length) return undefined
  return usages.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens,
    totalTokens: (sum.totalTokens ?? 0) + (usage.totalTokens ?? usage.inputTokens + usage.outputTokens),
    cacheReadTokens: (sum.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: (sum.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
}
function failure(value: unknown, text: TraceMessages): string | undefined {
  if (value === undefined || value === null || value === false) return undefined
  return string(value) ?? string(object(value).message) ?? text.toolFailed
}
export function terminationLabel(termination: TraceTermination, text: TraceMessages = traceText): string {
  switch (termination.kind) {
    case 'error': return text.terminationError
    case 'aborted': case 'interrupted': return text.terminationAborted
    case 'blocked': return text.terminationBlocked
    case 'max-tokens': return text.terminationMaxTokens
  }
}
/** Only raw chunk records carry the durable model finish reason. */
function streamTermination(value: unknown, text: TraceMessages): TraceTermination | undefined {
  if (!Array.isArray(value)) return undefined
  for (let i = value.length - 1; i >= 0; i--) {
    const record = object(value[i]), chunk = object(record.chunk)
    if (record.type !== 'chunk' || chunk.type !== 'finish') continue
    const reason = object(chunk.reason)
    if (reason.kind === 'error' || reason.kind === 'aborted') return {
      kind: reason.kind, message: failure(reason.failure, text) ?? (reason.kind === 'error' ? text.modelRunFailed : text.modelOutputAborted),
    }
    if (reason.kind === 'max-tokens') return { kind: 'max-tokens', message: text.outputLimitReached }
    return undefined
  }
  return undefined
}
function turnTermination(value: unknown, text: TraceMessages): TraceTermination | undefined {
  const reason = object(value)
  if (reason.kind === 'error') return { kind: 'error', message: failure(reason.error, text) ?? text.turnRunFailed }
  if (reason.kind === 'interrupted') return { kind: 'interrupted', message: text.turnInterrupted }
  if (reason.kind === 'blocked') return { kind: 'blocked', message: text.turnBlocked }
  if (reason.kind === 'max-tokens') return { kind: 'max-tokens', message: text.outputLimitReached }
  if (reason.kind !== 'aborted') return undefined
  const cause = object(reason.reason)
  const messages: Record<string, string> = {
    user: text.abortedByUser, parent: text.abortedByParent,
    disposed: text.abortedByDispose, legacy: text.abortedLegacy,
  }
  return { kind: 'aborted', message: cause.kind === 'hook'
    ? text.abortedByHook(string(cause.reason) ?? '')
    : messages[String(cause.kind)] ?? text.abortedFallback }
}
function setTermination(row: TraceRow, termination: TraceTermination | undefined): void {
  row.termination = termination
  row.error = termination?.message
  row.failed = termination?.kind === 'error'
}
/** Expand only timestamps, using the same delta semantics as dsh-llm. */
export function firstOutputTime(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined
  for (const entry of value) {
    const record = object(entry)
    if (record.type === 'chunk') {
      const chunk = object(record.chunk)
      const output = ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && !!string(chunk.text))
        || (chunk.type === 'tool-call-delta' && (!!string(chunk.argumentsDelta) || string(chunk.name) !== undefined))
      if (output && number(record.time) !== undefined) return number(record.time)
    } else if (['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(String(record.type))) {
      let time = number(record.time0)
      const chunks = record.type === 'tool-call-chunks' ? record.args : record.texts
      if (time === undefined || !Array.isArray(chunks) || !Array.isArray(record.dt)) continue
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          const delta = number(record.dt[i - 1])
          if (delta === undefined) break
          time += delta
        }
        if (string(chunks[i]) || (i === 0 && record.type === 'tool-call-chunks' && string(record.name) !== undefined)) return time
      }
    }
  }
  return undefined
}
function rowOf(event: SessionWireEvent, kind: TraceKind, turn: TraceTurn, title: string): TraceRow {
  return { id: `${kind}:${event.seq}`, kind, turn: turn.number, seq: event.seq, title,
    input: [], content: [], depth: 0, retries: 0, running: false, failed: false }
}

/** One requested input per immutable journal window, shared across live updates. */
const detailInputs = new WeakMap<readonly SessionWireEvent[], { end: number; content: TraceInputBlock[] }>()
function readInput(records: readonly SessionWireEvent[], endExclusive: number): TraceInputBlock[] {
  const cached = detailInputs.get(records)
  if (cached?.end === endExclusive) return cached.content
  const context: { seq: number; content: TraceInputBlock[] }[] = []
  for (let index = 0; index < endExclusive; index++) {
    const event = records[index]!
    if (!['user/message', 'assistant/message', 'tool/result'].includes(event.type)) continue
    const data = object(event.data)
    const message = object(data.message)
    const content: TraceInputBlock[] = event.type === 'tool/result'
      ? message.role === 'tool' && string(message.toolCallId)
        ? [{ type: 'tool-output', toolCallId: message.toolCallId as string, content: blocks(message.content), ...(message.isError === true ? { isError: true } : {}) }]
        : []
      : blocks(event.type === 'user/message' ? data.content : message.content)
    const op = object(event.surfaceOp)
    const entry = { seq: event.seq, content }
    if (op.op === 'replace' && number(op.startSeq) !== undefined && number(op.endSeq) !== undefined) {
      // Replacements occupy the replaced position, including partial loaded windows.
      const start = context.findIndex(message => message.seq === op.startSeq)
      const end = context.findIndex(message => message.seq === op.endSeq)
      if (end >= 0) context.splice(Math.max(0, start), end - Math.max(0, start) + 1, entry)
      else context.splice(Math.max(0, start), start < 0 ? 0 : context.length - start, entry)
    } else context.push(entry)
  }
  const content = context.flatMap(message => message.content)
  detailInputs.set(records, { end: endExclusive, content })
  return content
}
function captureInput(row: TraceRow, records: readonly SessionWireEvent[], endExclusive: number): void {
  Object.defineProperty(row, 'input', {
    configurable: true, enumerable: true,
    get: () => readInput(records, endExclusive),
  })
}

const traceSelections = new WeakMap<readonly SessionWireEvent[], { stream: AssistantStream | null; running: boolean; text: TraceMessages; locale: Locale; turns: TraceTurn[] }>()
/** Share only the latest projection per immutable journal window between list and sheet. */
export function selectTrace(records: readonly SessionWireEvent[], stream: AssistantStream | null = null, running = false,
  text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): TraceTurn[] {
  const cached = traceSelections.get(records)
  if (cached?.stream === stream && cached.running === running && cached.text === text && cached.locale === locale) return cached.turns
  const turns = buildTrace(records, stream, running, text, locale)
  traceSelections.set(records, { stream, running, text, locale, turns })
  return turns
}
export function findTraceRow(turns: readonly TraceTurn[], id: string): TraceRow | undefined {
  for (const turn of turns) {
    const row = turn.rows.find(item => item.id === id)
    if (row) return row
  }
  return undefined
}

/** Durable records are authoritative; live chunks only fill the current request. */
export function buildTrace(records: readonly SessionWireEvent[], stream: AssistantStream | null = null, running = false,
  text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): TraceTurn[] {
  const turns: TraceTurn[] = []
  const numbered = new Map<number, TraceTurn>()
  const assistants = new Map<string, TraceRow>()
  const assistantOwners = new Map<TraceRow, TraceTurn>()
  const turnAssistants = new Map<TraceTurn, TraceRow[]>()
  const pendingAssistants = new Map<TraceTurn, TraceRow>()
  const shownAssistants = new Set<TraceRow>()
  const committedAssistants = new Set<TraceRow>()
  const interruptedAssistants = new Set<TraceRow>()
  const tools = new Map<string, TraceRow>()
  const summaries = new Map<string, TraceRow>()
  let current: TraceTurn | undefined
  let inputEnd = 0
  const turnFor = (event: SessionWireEvent): TraceTurn => {
    const n = number(object(event.data).turn)
    const existing = n === undefined ? current : numbered.get(n)
    if (existing) return existing
    const turn: TraceTurn = { id: n === undefined ? `unassigned:${event.seq}` : `turn:${n}`, number: n ?? null, running: false, partial: true, rows: [] }
    turns.push(turn)
    if (n !== undefined) numbered.set(n, turn)
    current = turn
    return turn
  }
  const assistantFor = (event: SessionWireEvent, turn: TraceTurn): TraceRow => {
    const step = number(object(event.data).step) ?? 0
    const key = `${turn.id}:${step}`
    let row = assistants.get(key)
    if (!row) {
      row = { ...rowOf(event, 'assistant', turn, text.assistantRow), step, running: true }
      assistants.set(key, row)
      assistantOwners.set(row, turn)
      const siblings = turnAssistants.get(turn) ?? []
      siblings.push(row)
      turnAssistants.set(turn, siblings)
      pendingAssistants.set(turn, row)
    }
    return row
  }
  const showAssistant = (row: TraceRow, turn: TraceTurn) => {
    if (shownAssistants.has(row)) return
    captureInput(row, records, inputEnd)
    shownAssistants.add(row)
    if (pendingAssistants.get(turn) === row) pendingAssistants.delete(turn)
    turn.rows.push(row)
  }
  const closeAssistant = (row: TraceRow, turn: TraceTurn, time: number, termination?: TraceTermination) => {
    showAssistant(row, turn)
    if (!committedAssistants.has(row)) {
      const attempt = row.attempts?.at(-1)
      row.completedAt ??= attempt?.time ?? time
      setTermination(row, termination ?? attempt?.termination)
    } else if (interruptedAssistants.has(row) && termination) setTermination(row, termination)
    row.running = false
  }
  for (const [index, event] of records.entries()) {
    inputEnd = index
    const data = object(event.data)
    if (event.type === 'turn/start') {
      const n = number(data.turn)
      if (n !== undefined && current?.number === null && current.rows.every(row => row.kind === 'user')) {
        current.number = n
        current.id = `turn:${n}`
        for (const row of current.rows) row.turn = n
        numbered.set(n, current)
      }
      current = turnFor(event)
      current.startedAt = event.time
      current.partial = false
      continue
    }
    if (event.type === 'turn/end') {
      const turn = turnFor(event)
      turn.completedAt = event.time
      turn.termination = turnTermination(data.reason, text)
      for (const row of turnAssistants.get(turn) ?? []) closeAssistant(row, turn, event.time, turn.termination)
      for (const row of turn.rows) row.running = false
      current = undefined
      continue
    }
    if (!['user/message', 'step/start', 'step/end', 'assistant/attempt', 'assistant/message', 'tool/call', 'tool/result',
      'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'compaction/start', 'compaction/summary', 'compaction/end'].includes(event.type)) continue
    const turn = turnFor(event)
    if (event.type === 'user/message') {
      const content = blocks(data.content)
      const source = object(data.source)
      if (source.kind === 'compact-checkpoint' && string(source.compactionId)) {
        // The checkpoint is the input replacement, not a second user row.
        continue
      }
      turn.rows.push({ ...rowOf(event, 'user', turn, text.userRow), content, completedAt: event.time })
    } else if (event.type === 'step/start') {
      const previous = pendingAssistants.get(turn)
      if (previous && previous.step !== number(data.step)) showAssistant(previous, turn)
      const row = assistantFor(event, turn)
      row.startedAt = event.time
    } else if (event.type === 'step/end') {
      const row = assistants.get(`${turn.id}:${number(data.step) ?? 0}`)
      if (row) closeAssistant(row, turn, event.time)
    } else if (event.type === 'assistant/attempt') {
      const row = assistantFor(event, turn)
      showAssistant(row, turn)
      captureInput(row, records, inputEnd)
      row.retries++
      row.attempts ??= []
      row.attempts.push({ seq: event.seq, time: event.time, termination: streamTermination(data.stream, text) })
    } else if (event.type === 'assistant/message') {
      const row = assistantFor(event, turn)
      showAssistant(row, turn)
      captureInput(row, records, inputEnd)
      row.content = blocks(object(data.message).content)
      row.completedAt = event.time
      row.running = false
      row.usage = usageOf(data.usage)
      committedAssistants.add(row)
      const first = firstOutputTime(data.stream)
      row.firstOutputMs = row.startedAt !== undefined && first !== undefined && first >= row.startedAt && first <= event.time ? first - row.startedAt : undefined
      if (data.interrupted === true) interruptedAssistants.add(row)
      setTermination(row, streamTermination(data.stream, text) ?? (data.interrupted === true ? { kind: 'interrupted', message: text.interruptedPartial } : undefined))
    } else if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const sub = event.type === 'tool/ptc-dispatch-start'
      const callId = string(sub ? data.subCallId : data.callId)
      if (!callId) continue
      const args = typeof data.arguments === 'string' ? { text: data.arguments, partial: false } : formatJson(data.arguments, text, locale)
      const name = string(data.name) ?? text.toolNameUnknown
      const row: TraceRow = { ...rowOf(event, sub ? 'subtool' : 'tool', turn, sub ? text.subtoolTitle(name) : text.toolTitle(name)),
        toolName: string(data.name), callId, parentCallId: string(data.parentCallId), rootCallId: string(data.rootCallId),
        startedAt: event.time, running: true, arguments: args.text, ...(args.partial ? { partialText: true } : {}), depth: sub ? 1 : 0 }
      tools.set(`${turn.id}:${sub ? 'sub:' : ''}${callId}`, row)
      turn.rows.push(row)
    } else if (event.type === 'tool/result') {
      const message = object(data.message)
      const callId = string(message.toolCallId)
      if (message.role !== 'tool' || !callId) continue
      let row = tools.get(`${turn.id}:${callId}`)
      if (!row) {
        row = { ...rowOf(event, 'tool', turn, text.toolTitle(string(data.name) ?? text.toolNameUnknown)), id: `tool:${event.seq}:${callId}`, callId }
        tools.set(`${turn.id}:${callId}`, row)
        turn.rows.push(row)
      }
      fillToolName(row, string(data.name), text)
      row.content = blocks(message.content)
      row.completedAt = event.time
      row.running = false
      row.error = failure(data.error, text)
      row.failed = message.isError === true || row.error !== undefined
    } else if (event.type === 'tool/ptc-dispatch') {
      const callId = string(data.subCallId)
      if (!callId) continue
      let row = tools.get(`${turn.id}:sub:${callId}`)
      if (!row) {
        row = { ...rowOf(event, 'subtool', turn, text.subtoolTitle(string(data.name) ?? text.toolNameUnknown)), callId,
          parentCallId: string(data.parentCallId), rootCallId: string(data.rootCallId), depth: 1 }
        tools.set(`${turn.id}:sub:${callId}`, row)
        turn.rows.push(row)
      }
      fillToolName(row, string(data.name), text)
      row.completedAt = event.time
      row.running = false
      row.content = blocks(data.content)
      if (row.arguments === undefined) {
        const args = formatJson(data.arguments, text, locale)
        row.arguments = args.text
        if (args.partial) row.partialText = true
      }
      row.error = failure(data.error, text)
      row.failed = data.isError === true || row.error !== undefined
    } else {
      const id = string(data.compactionId)
      if (!id) continue
      let row = summaries.get(id)
      if (!row) {
        row = rowOf(event, 'compaction', turn, text.compactionRow)
        summaries.set(id, row)
        turn.rows.push(row)
      }
      if (event.type === 'compaction/start') { row.startedAt = event.time; row.running = true; captureInput(row, records, inputEnd) }
      if (event.type === 'compaction/summary') {
        const summary = Array.isArray(data.summary) ? undefined
          : typeof data.summary === 'string' ? { text: data.summary, partial: false } : formatJson(data.summary, text, locale)
        row.content = summary ? [{ type: 'text', text: summary.text }] : blocks(data.summary)
        if (summary?.partial) row.partialText = true
        row.usage = usageOf(data.usage)
      }
      if (event.type === 'compaction/end') { row.completedAt = event.time; row.running = false; row.error = failure(data.error, text); row.failed = row.error !== undefined }
    }
  }
  inputEnd = records.length
  if (stream && running) {
    const synthetic: SessionWireEvent = { type: 'step/start', seq: (records.at(-1)?.seq ?? -1) + 1, time: 0, data: { turn: stream.turn, step: stream.step } }
    const turn = turnFor(synthetic)
    const row = assistantFor(synthetic, turn)
    if (row.completedAt === undefined && turn.completedAt === undefined) {
      showAssistant(row, turn)
      captureInput(row, records, inputEnd)
      row.content = [...stream.content]
      row.running = true
      row.usage = stream.usage
    }
  }
  for (const [row, turn] of assistantOwners) {
    showAssistant(row, turn)
    if (!committedAssistants.has(row) && (!running || turn.completedAt !== undefined) && row.completedAt === undefined) {
      const attempt = row.attempts?.at(-1)
      if (attempt) closeAssistant(row, turn, attempt.time, turn.termination)
    }
  }
  for (const turn of turns) {
    turn.running = running && turn === turns.at(-1) && turn.completedAt === undefined
    turn.durationMs = elapsed(turn.startedAt, turn.completedAt)
    turn.usage = sumUsage(turn.rows)
    for (const row of turn.rows) {
      row.running = row.running && turn.running
      row.durationMs = elapsed(row.startedAt, row.completedAt)
      if (row.kind === 'subtool') {
        const seen = new Set([row.callId])
        let parentId = row.parentCallId
        while (parentId && parentId !== row.rootCallId && !seen.has(parentId)) {
          seen.add(parentId)
          const parent = tools.get(`${turn.id}:sub:${parentId}`)
          if (!parent) break
          row.depth++
          parentId = parent.parentCallId
        }
      }
    }
  }
  return turns
}

export interface TraceSearch {
  turns: TraceTurn[]
  /** Unmatched rows whose text was only partly searched because of the bounds above. */
  partialRows: number
}
export function searchTrace(turns: readonly TraceTurn[], query: string, text: TraceMessages = traceText): TraceSearch {
  // Case folding independent of the page language: ja-JP folds like the default
  // for the text the trace search sees, and only Turkish/Azeri dotted-i differs
  // (docs/design/11-i18n.md).
  const term = query.trim().normalize('NFKC').toLowerCase()
  if (!term) return { turns: turns.map(turn => ({ ...turn })), partialRows: 0 }
  let partialRows = 0
  const filtered = turns.map(turn => ({ ...turn, rows: turn.rows.filter(row => {
    const content = contentSearchText(row.content, text)
    const found = `${row.title}\n${content.text}\n${row.arguments ?? ''}`.normalize('NFKC').toLowerCase().includes(term)
    if (!found && (content.partial || row.partialText)) partialRows++
    return found
  }) }))
  return { turns: filtered, partialRows }
}
export function filterTrace(turns: readonly TraceTurn[], query: string, text: TraceMessages = traceText): TraceTurn[] {
  return searchTrace(turns, query, text).turns
}
export function rowDescription(row: TraceRow, text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): string {
  const parts = row.kind === 'user' ? [contentText(row.content, text).trim() || text.attachmentOnly]
    : row.running ? [text.rowRunning] : [formatDuration(row.durationMs, text, locale)]
  if (row.kind === 'assistant' && row.usage && !row.running) parts.push(text.outputTokens(formatCount(row.usage.outputTokens, locale)))
  if (row.retries) parts.push(text.uncommittedAttempts(row.retries))
  if (row.termination) parts.push(terminationLabel(row.termination, text))
  else if (row.failed) parts.push(text.terminationError)
  return parts.join(text.detailsSeparator)
}
/**
 * The Japanese default. It takes only the turn, so it stays safe to pass
 * straight to `Array#map` (tests/s6b-fixtures.test.ts), which supplies extra
 * arguments; callers that have a language use `formatTurnHeading`.
 */
export function turnHeading(turn: TraceTurn): string {
  return formatTurnHeading(turn, traceText, SOURCE_LOCALE)
}
export function formatTurnHeading(turn: TraceTurn, text: TraceMessages, locale: Locale): string {
  const label = turn.number === null ? text.turnNumberUnknown : text.turnLabel(turn.number)
  if (turn.running) return `${label}${text.detailsSeparator}${text.turnRunning}`
  const duration = turn.durationMs === undefined ? text.durationUnmeasured : text.durationTotal(formatDuration(turn.durationMs, text, locale))
  const tokens = turn.usage ? text.tokenCount(formatCount(turn.usage.totalTokens ?? 0, locale)) : text.tokensUnrecorded
  return `${label}${text.detailsSeparator}${duration}${text.detailsSeparator}${tokens}${turn.termination ? `${text.detailsSeparator}${terminationLabel(turn.termination, text)}` : ''}`
}
