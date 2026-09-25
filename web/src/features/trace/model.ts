import type { ContentBlock, SessionWireEvent, TokenUsage } from '../../dsh/services.ts'
import type { AssistantStream } from '../../dsh/session-journal.ts'

type Data = Record<string, unknown>
export type TraceKind = 'user' | 'assistant' | 'tool' | 'subtool' | 'compaction'
export interface TraceRow {
  id: string
  kind: TraceKind
  turn: number | null
  step?: number
  seq: number
  title: string
  content: ContentBlock[]
  input: ContentBlock[]
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
  retries: number
  running: boolean
  failed: boolean
  error?: string
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
export function formatDuration(ms: number | undefined): string {
  return ms === undefined ? '未計測' : `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(ms / 1000)} 秒`
}
export function formatCount(value: number): string { return new Intl.NumberFormat('ja-JP').format(value) }
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

/** Durable records are authoritative; live chunks only fill the current request. */
export function buildTrace(records: readonly SessionWireEvent[], stream: AssistantStream | null = null, running = false): TraceTurn[] {
  const turns: TraceTurn[] = []
  const numbered = new Map<number, TraceTurn>()
  const assistants = new Map<string, TraceRow>()
  const tools = new Map<string, TraceRow>()
  const summaries = new Map<string, TraceRow>()
  let current: TraceTurn | undefined
  let context: { seq: number; content: ContentBlock[] }[] = []
  const input = () => context.flatMap(message => message.content)
  const recordInput = (event: SessionWireEvent, content: ContentBlock[]) => {
    const op = object(event.surfaceOp)
    if (op.op === 'replace' && number(op.startSeq) !== undefined && number(op.endSeq) !== undefined) {
      // Surface replacements occupy the replaced position, not the log tail.
      const start = context.findIndex(message => message.seq === op.startSeq)
      const end = context.findIndex(message => message.seq === op.endSeq)
      if (end >= 0) context.splice(Math.max(0, start), end - Math.max(0, start) + 1, { seq: event.seq, content })
      else context.splice(Math.max(0, start), start < 0 ? 0 : context.length - start, { seq: event.seq, content })
      return
    }
    context.push({ seq: event.seq, content })
  }
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
      row = { ...rowOf(event, 'assistant', turn, 'アシスタント'), step, running: true, input: input() }
      assistants.set(key, row)
      turn.rows.push(row)
    }
    return row
  }
  for (const event of records) {
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
        recordInput(event, content)
        // The checkpoint is the input replacement, not a second user row.
        continue
      }
      turn.rows.push({ ...rowOf(event, 'user', turn, 'ユーザー'), content, completedAt: event.time })
      recordInput(event, content)
    } else if (event.type === 'step/start') {
      const row = assistantFor(event, turn)
      row.startedAt = event.time
      row.input = input()
    } else if (event.type === 'step/end') {
      const row = assistants.get(`${turn.id}:${number(data.step) ?? 0}`)
      if (row) row.running = false
    } else if (event.type === 'assistant/attempt') {
      assistantFor(event, turn).retries++
    } else if (event.type === 'assistant/message') {
      const row = assistantFor(event, turn)
      row.content = blocks(object(data.message).content)
      row.completedAt = event.time
      row.running = false
      row.usage = usageOf(data.usage)
      const first = firstOutputTime(data.stream)
      row.firstOutputMs = row.startedAt !== undefined && first !== undefined && first >= row.startedAt && first <= event.time ? first - row.startedAt : undefined
      const reason = object(data.finishReason)
      row.error = failure(reason.failure)
      row.failed = reason.kind === 'error' || reason.kind === 'aborted'
      recordInput(event, row.content)
    } else if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const sub = event.type === 'tool/ptc-dispatch-start'
      const callId = string(sub ? data.subCallId : data.callId)
      if (!callId) continue
      const row: TraceRow = { ...rowOf(event, sub ? 'subtool' : 'tool', turn, `${sub ? 'サブツール' : 'ツール'}：${string(data.name) ?? '名前不明'}`),
        callId, parentCallId: string(data.parentCallId), rootCallId: string(data.rootCallId),
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
        row.content = result.content
        row.completedAt = event.time
        row.running = false
        row.error = failure(data.error)
        row.failed = result.isError === true || row.error !== undefined
      }
      recordInput(event, blocks(message.content))
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
      if (event.type === 'compaction/start') { row.startedAt = event.time; row.running = true; row.input = input() }
      if (event.type === 'compaction/summary') {
        row.content = Array.isArray(data.summary) ? blocks(data.summary) : [{ type: 'text', text: string(data.summary) ?? prettyJson(data.summary) }]
        row.usage = usageOf(data.usage)
      }
      if (event.type === 'compaction/end') { row.completedAt = event.time; row.running = false; row.error = failure(data.error); row.failed = row.error !== undefined }
    }
  }
  if (stream && running) {
    const synthetic: SessionWireEvent = { type: 'step/start', seq: (records.at(-1)?.seq ?? -1) + 1, time: 0, data: { turn: stream.turn, step: stream.step } }
    const turn = turnFor(synthetic)
    const row = assistantFor(synthetic, turn)
    if (row.completedAt === undefined && turn.completedAt === undefined) {
      row.content = [...stream.content]
      row.running = true
      row.usage = stream.usage
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
  if (row.retries) parts.push(`再試行 ${row.retries} 回`)
  if (row.failed) parts.push('失敗')
  return parts.join(' ・ ')
}
export function turnHeading(turn: TraceTurn): string {
  const label = turn.number === null ? 'ターン番号不明' : `ターン ${turn.number}`
  if (turn.running) return `${label} ・ 実行中`
  const duration = turn.durationMs === undefined ? '時間未計測' : `合計 ${formatDuration(turn.durationMs)}`
  const tokens = turn.usage ? `${formatCount(turn.usage.totalTokens ?? 0)} トークン` : 'トークン未記録'
  return `${label} ・ ${duration} ・ ${tokens}`
}
