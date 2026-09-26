import type { ContentBlock, SessionWireEvent, TokenUsage } from '../../dsh/services.ts'
import type { AssistantStream } from '../../dsh/session-journal.ts'

type Data = Record<string, unknown>
export type TraceKind = 'user' | 'assistant' | 'tool' | 'subtool' | 'compaction'
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
  readonly input: ContentBlock[]
  arguments?: string
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
export function blocks(value: unknown): ContentBlock[] {
  return Array.isArray(value) ? value.filter(item => typeof object(item).type === 'string') as ContentBlock[] : []
}
export function elapsed(start: number | undefined, end: number | undefined): number | undefined {
  return start === undefined || end === undefined ? undefined : Math.max(0, end - start)
}
const countFormatter = new Intl.NumberFormat('ja-JP')
/** Match chat's units and rounding; absent timestamps remain unmeasured. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '未計測'
  if (!Number.isFinite(ms) || ms < 0) return '不明'
  if (ms < 1000) return `${Math.round(ms)} ミリ秒`
  if (ms < 60000) return `${Number((ms / 1000).toFixed(1))} 秒`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}
export function formatCount(value: number): string { return countFormatter.format(value) }
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
function fillToolName(row: TraceRow, name: string | undefined): void {
  if (row.toolName !== undefined || name === undefined) return
  row.toolName = name
  row.title = `${row.kind === 'subtool' ? 'サブツール' : 'ツール'}：${name}`
}
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  return JSON.stringify(value, null, 2) ?? ''
}
export function contentText(content: readonly ContentBlock[]): string {
  return content.map(block => {
    switch (block.type) {
      case 'text': case 'reasoning': return block.text
      case 'tool-call': return `${block.name} ${block.arguments}`
      case 'tool-result': return contentText(block.content)
      case 'image': case 'file': return block.attachment.name ?? '添付'
      default: return ''
    }
  }).join('\n')
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
function failure(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) return undefined
  return string(value) ?? string(object(value).message) ?? '処理に失敗しました。'
}
export function terminationLabel(termination: TraceTermination): string {
  switch (termination.kind) {
    case 'error': return '失敗'
    case 'aborted': case 'interrupted': return '中断'
    case 'blocked': return '実行見送り'
    case 'max-tokens': return '上限到達'
  }
}
/** Only raw chunk records carry the durable model finish reason. */
function streamTermination(value: unknown): TraceTermination | undefined {
  if (!Array.isArray(value)) return undefined
  for (let i = value.length - 1; i >= 0; i--) {
    const record = object(value[i]), chunk = object(record.chunk)
    if (record.type !== 'chunk' || chunk.type !== 'finish') continue
    const reason = object(chunk.reason)
    if (reason.kind === 'error' || reason.kind === 'aborted') return {
      kind: reason.kind, message: failure(reason.failure) ?? (reason.kind === 'error' ? 'モデルの実行に失敗しました。' : 'モデルの出力が中断されました。'),
    }
    if (reason.kind === 'max-tokens') return { kind: 'max-tokens', message: '出力トークンの上限に達しました。' }
    return undefined
  }
  return undefined
}
function turnTermination(value: unknown): TraceTermination | undefined {
  const reason = object(value)
  if (reason.kind === 'error') return { kind: 'error', message: failure(reason.error) ?? 'ターンの実行に失敗しました。' }
  if (reason.kind === 'interrupted') return { kind: 'interrupted', message: '終了が記録されないまま、実行が中断されました。' }
  if (reason.kind === 'blocked') return { kind: 'blocked', message: '実行前の確認で処理が見送られました。' }
  if (reason.kind === 'max-tokens') return { kind: 'max-tokens', message: '出力トークンの上限に達しました。' }
  if (reason.kind !== 'aborted') return undefined
  const cause = object(reason.reason)
  const messages: Record<string, string> = {
    user: 'ユーザーの操作で停止しました。', parent: '親セッションの操作で停止しました。',
    disposed: 'セッションが閉じられたため停止しました。', legacy: '中断の理由は記録されていません。',
  }
  return { kind: 'aborted', message: cause.kind === 'hook'
    ? `フックにより停止しました。${string(cause.reason) ? ` ${cause.reason}` : ''}`
    : messages[String(cause.kind)] ?? '実行が中断されました。' }
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
const detailInputs = new WeakMap<readonly SessionWireEvent[], { end: number; content: ContentBlock[] }>()
function readInput(records: readonly SessionWireEvent[], endExclusive: number): ContentBlock[] {
  const cached = detailInputs.get(records)
  if (cached?.end === endExclusive) return cached.content
  const context: { seq: number; content: ContentBlock[] }[] = []
  for (let index = 0; index < endExclusive; index++) {
    const event = records[index]!
    if (!['user/message', 'assistant/message', 'tool/result'].includes(event.type)) continue
    const data = object(event.data)
    const content = blocks(event.type === 'user/message' ? data.content : object(data.message).content)
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

const traceSelections = new WeakMap<readonly SessionWireEvent[], { stream: AssistantStream | null; running: boolean; turns: TraceTurn[] }>()
/** Share only the latest projection per immutable journal window between list and sheet. */
export function selectTrace(records: readonly SessionWireEvent[], stream: AssistantStream | null = null, running = false): TraceTurn[] {
  const cached = traceSelections.get(records)
  if (cached?.stream === stream && cached.running === running) return cached.turns
  const turns = buildTrace(records, stream, running)
  traceSelections.set(records, { stream, running, turns })
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
export function buildTrace(records: readonly SessionWireEvent[], stream: AssistantStream | null = null, running = false): TraceTurn[] {
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
      row = { ...rowOf(event, 'assistant', turn, 'アシスタント'), step, running: true }
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
      turn.termination = turnTermination(data.reason)
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
      if (source.kind === 'plugin' && source.plugin === 'compact' && string(source.compactionId)) {
        // The checkpoint is the input replacement, not a second user row.
        continue
      }
      turn.rows.push({ ...rowOf(event, 'user', turn, 'ユーザー'), content, completedAt: event.time })
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
      row.attempts.push({ seq: event.seq, time: event.time, termination: streamTermination(data.stream) })
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
      setTermination(row, streamTermination(data.stream) ?? (data.interrupted === true ? { kind: 'interrupted', message: '途中までの出力を残して中断しました。' } : undefined))
    } else if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const sub = event.type === 'tool/ptc-dispatch-start'
      const callId = string(sub ? data.subCallId : data.callId)
      if (!callId) continue
      const row: TraceRow = { ...rowOf(event, sub ? 'subtool' : 'tool', turn, `${sub ? 'サブツール' : 'ツール'}：${string(data.name) ?? '名前不明'}`),
        toolName: string(data.name), callId, parentCallId: string(data.parentCallId), rootCallId: string(data.rootCallId),
        startedAt: event.time, running: true, arguments: typeof data.arguments === 'string' ? data.arguments : prettyJson(data.arguments), depth: sub ? 1 : 0 }
      tools.set(`${turn.id}:${sub ? 'sub:' : ''}${callId}`, row)
      turn.rows.push(row)
    } else if (event.type === 'tool/result') {
      const message = object(data.message)
      const results = blocks(message.content).filter(block => block.type === 'tool-result')
      for (const result of results) {
        const callId = string(object(message.source).callId) ?? result.toolCallId
        let row = tools.get(`${turn.id}:${callId}`)
        if (!row) {
          row = { ...rowOf(event, 'tool', turn, `ツール：${string(data.name) ?? '名前不明'}`), id: `tool:${event.seq}:${result.toolCallId}`, callId: result.toolCallId }
          turn.rows.push(row)
        }
        fillToolName(row, string(data.name))
        row.content = result.content
        row.completedAt = event.time
        row.running = false
        row.error = failure(data.error)
        row.failed = result.isError === true || row.error !== undefined
      }
    } else if (event.type === 'tool/ptc-dispatch') {
      const callId = string(data.subCallId)
      if (!callId) continue
      let row = tools.get(`${turn.id}:sub:${callId}`)
      if (!row) {
        row = { ...rowOf(event, 'subtool', turn, `サブツール：${string(data.name) ?? '名前不明'}`), callId,
          parentCallId: string(data.parentCallId), rootCallId: string(data.rootCallId), depth: 1 }
        tools.set(`${turn.id}:sub:${callId}`, row)
        turn.rows.push(row)
      }
      fillToolName(row, string(data.name))
      row.completedAt = event.time
      row.running = false
      row.content = blocks(data.content)
      row.arguments ??= prettyJson(data.arguments)
      row.error = failure(data.error)
      row.failed = data.isError === true || row.error !== undefined
    } else {
      const id = string(data.compactionId)
      if (!id) continue
      let row = summaries.get(id)
      if (!row) {
        row = rowOf(event, 'compaction', turn, '要約')
        summaries.set(id, row)
        turn.rows.push(row)
      }
      if (event.type === 'compaction/start') { row.startedAt = event.time; row.running = true; captureInput(row, records, inputEnd) }
      if (event.type === 'compaction/summary') {
        row.content = Array.isArray(data.summary) ? blocks(data.summary) : [{ type: 'text', text: string(data.summary) ?? prettyJson(data.summary) }]
        row.usage = usageOf(data.usage)
      }
      if (event.type === 'compaction/end') { row.completedAt = event.time; row.running = false; row.error = failure(data.error); row.failed = row.error !== undefined }
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

export function filterTrace(turns: readonly TraceTurn[], query: string): TraceTurn[] {
  const term = query.trim().normalize('NFKC').toLocaleLowerCase('ja-JP')
  return turns.map(turn => ({ ...turn, rows: !term ? turn.rows : turn.rows.filter(row =>
    `${row.title}\n${contentText(row.content)}\n${row.arguments ?? ''}`.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(term)) }))
}
export function rowDescription(row: TraceRow): string {
  const parts = row.kind === 'user' ? [contentText(row.content).trim() || '添付のみ']
    : row.running ? ['開始済み・実行中'] : [formatDuration(row.durationMs)]
  if (row.kind === 'assistant' && row.usage && !row.running) parts.push(`出力 ${formatCount(row.usage.outputTokens)} トークン`)
  if (row.retries) parts.push(`未確定の試行 ${row.retries} 回`)
  if (row.termination) parts.push(terminationLabel(row.termination))
  else if (row.failed) parts.push('失敗')
  return parts.join(' ・ ')
}
export function turnHeading(turn: TraceTurn): string {
  const label = turn.number === null ? 'ターン番号不明' : `ターン ${turn.number}`
  if (turn.running) return `${label} ・ 実行中`
  const duration = turn.durationMs === undefined ? '時間未計測' : `合計 ${formatDuration(turn.durationMs)}`
  const tokens = turn.usage ? `${formatCount(turn.usage.totalTokens ?? 0)} トークン` : 'トークン未記録'
  return `${label} ・ ${duration} ・ ${tokens}${turn.termination ? ` ・ ${terminationLabel(turn.termination)}` : ''}`
}
