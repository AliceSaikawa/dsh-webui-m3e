import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantStream } from '../web/src/dsh/session-journal.ts'
import type { SessionWireEvent } from '../web/src/dsh/services.ts'
import { buildTrace, elapsed, filterTrace, findTraceRow, firstOutputTime, formatCount, formatDuration, rowDescription, selectTrace, traceRowIcon, turnHeading } from '../web/src/features/trace/model.ts'
import { recordDurationText, recordInputSupporting, recordOutputText, recordResultText, recordUsageText } from '../web/src/features/trace/record-summary.ts'
import { formatDuration as chatFormatDuration } from '../web/src/features/chat/model.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'
import { extendMock } from '../web/src/features/trace/mock.ts'
import { TRACE_EXAMPLE_SESSION_ID, TRACE_FAILURE_SESSION_ID, traceExampleRecords, traceFailureRecords } from '../web/src/features/trace/trace-fixtures.ts'

function record(seq: number, type: string, time: number, data: SessionWireEvent['data'] = {}): SessionWireEvent {
  return mockRecord(seq, type, time, data)
}
function text(value: string) { return { type: 'text', text: value } }
function message(seq: number, time: number, turn: number, step: number, value: string) {
  return record(seq, 'assistant/message', time, { turn, step, message: { content: [text(value)] } })
}

test('a name-bearing tool delta counts as output before any argument text', () => {
  assert.equal(firstOutputTime([{ type: 'chunk', time: 120, chunk: { type: 'tool-call-delta', index: 0, name: 'read_file', argumentsDelta: '' } }]), 120)
  assert.equal(firstOutputTime([{ type: 'tool-call-chunks', time0: 140, dt: [], name: '', args: [''] }]), 140)
  assert.equal(firstOutputTime([{ type: 'tool-call-chunks', time0: 140, dt: [], args: [''] }]), undefined)
})

test('turn boundaries preserve row order and separate reused tool identifiers', () => {
  const records = [
    record(1, 'turn/start', 1000, { turn: 1 }),
    record(2, 'user/message', 1010, { turn: 1, content: [text('最初の質問')] }),
    record(3, 'step/start', 1020, { turn: 1, step: 1 }),
    message(4, 1200, 1, 1, '確認します'),
    record(5, 'tool/call', 1220, { turn: 1, callId: 'same-id', name: 'read_file', arguments: '{"path":"README.md"}' }),
    record(6, 'tool/result', 1500, { turn: 1, message: { role: 'tool', toolCallId: 'same-id', content: [text('最初の結果')] } }),
    record(7, 'turn/end', 1600, { turn: 1 }),
    record(8, 'turn/start', 2000, { turn: 2 }),
    record(9, 'tool/call', 2100, { turn: 2, callId: 'same-id', name: 'read_file', arguments: '{}' }),
    record(10, 'tool/result', 2300, { turn: 2, message: { role: 'tool', toolCallId: 'same-id', content: [text('次の結果')] } }),
    record(11, 'turn/end', 2400, { turn: 2 }),
  ]
  const turns = buildTrace(records)
  assert.ok(turns[0])
  assert.ok(turns[1])
  assert.ok(turns[0].rows[1])
  assert.ok(turns[0].rows[2])
  assert.ok(turns[1].rows[0])
  assert.deepEqual(turns.map(turn => turn.number), [1, 2])
  assert.deepEqual(turns[0].rows.map(row => row.kind), ['user', 'assistant', 'tool'])
  assert.equal(turns[0].durationMs, 600)
  assert.equal(turns[1].durationMs, 400)
  assert.equal(turns[0].rows[1].durationMs, 180)
  assert.deepEqual(turns[0].rows[1].input, [text('最初の質問')])
  assert.equal(turns[0].rows[2].durationMs, 280)
  assert.equal(turns[1].rows[0].durationMs, 200)
  assert.deepEqual(turns[0].rows[2].content, [text('最初の結果')])
  assert.deepEqual(turns[1].rows[0].content, [text('次の結果')])
})

test('parallel tools pair by call ID when results arrive in the opposite order', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 110, { turn: 1, callId: 'a', name: 'read_file', arguments: '{}' }),
    record(3, 'tool/call', 120, { turn: 1, callId: 'b', name: 'search', arguments: '{}' }),
    record(4, 'tool/result', 140, { turn: 1, message: { role: 'tool', toolCallId: 'b', content: [text('見つかりました')] } }),
    record(5, 'tool/result', 190, { turn: 1, error: { message: 'ファイルがありません' }, message: { role: 'tool', toolCallId: 'a', content: [], isError: true } }),
    record(6, 'turn/end', 200, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.ok(turn.rows[1])
  assert.equal(turn.rows.length, 2)
  assert.equal(turn.rows[0].callId, 'a')
  assert.equal(turn.rows[0].durationMs, 80)
  assert.equal(turn.rows[0].failed, true)
  assert.match(rowDescription(turn.rows[0]), /失敗/)
  assert.equal(turn.rows[1].durationMs, 20)
  assert.equal(turn.rows[1].failed, false)
  assert.deepEqual(turn.rows[1].content, [text('見つかりました')])
})

test('truncated history retains orphan results without inventing a start time', () => {
  const [turn] = buildTrace([
    record(20, 'tool/result', 2000, { turn: 4, message: { role: 'tool', toolCallId: 'missing-start', content: [text('復元された結果')] } }),
    message(21, 2200, 4, 3, '完了しました'),
    record(22, 'turn/end', 2400, { turn: 4 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.ok(turn.rows[1])
  assert.equal(turn.partial, true)
  assert.equal(turn.number, 4)
  assert.equal(turn.rows[0].kind, 'tool')
  assert.equal(turn.rows[0].callId, 'missing-start')
  assert.deepEqual(turn.rows[0].content, [text('復元された結果')])
  assert.equal(turn.rows[0].startedAt, undefined)
  assert.equal(turn.durationMs, undefined)
  assert.equal(turn.rows[0].durationMs, undefined)
  assert.equal(turn.rows[1].durationMs, undefined)
  assert.equal(turn.rows[1].firstOutputMs, undefined)
  assert.match(turnHeading(turn), /時間未計測/)
  assert.match(rowDescription(turn.rows[0]), /未計測/)
})

test('live rows show a start marker without a ticking duration or settled token count', () => {
  const stream: AssistantStream = {
    attemptId: 'active', turn: 2, step: 1, chunks: [], content: [{ type: 'text', text: '途中の返答' }],
    usage: { inputTokens: 50, outputTokens: 7 },
  }
  const records = [
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'turn/end', 200, { turn: 1 }),
    record(3, 'turn/start', 300, { turn: 2 }),
    record(4, 'step/start', 320, { turn: 2, step: 1 }),
  ]
  const turns = buildTrace(records, stream, true)
  assert.ok(turns[0])
  assert.ok(turns[1])
  assert.ok(turns[1].rows[0])
  assert.equal(turns[0].running, false)
  assert.equal(turns[1].running, true)
  assert.equal(turnHeading(turns[1]), 'ターン 2 ・ 実行中')
  assert.equal(turns[1].rows[0].running, true)
  assert.equal(turns[1].rows[0].startedAt, 320)
  assert.equal(turns[1].rows[0].durationMs, undefined)
  assert.equal(rowDescription(turns[1].rows[0]), '開始済み・実行中')
  assert.equal(turns[1].usage, undefined)
  assert.deepEqual(turns[1].rows[0].content, [text('途中の返答')])
  const interrupted = buildTrace(records, stream, false)[1]
  assert.ok(interrupted)
  assert.ok(interrupted.rows[0])
  assert.equal(interrupted.rows[0].running, false)
})

test('durable assistant output wins over a stale stream for the same step', () => {
  const stream: AssistantStream = { attemptId: 'old', turn: 1, step: 1, chunks: [], content: [{ type: 'text', text: '未確定' }] }
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'step/start', 110, { turn: 1, step: 1 }),
    message(3, 200, 1, 1, '確定した回答'),
  ], stream, true)
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.rows.length, 1)
  assert.deepEqual(turn.rows[0].content, [text('確定した回答')])
  assert.equal(turn.rows[0].running, false)
  assert.equal(turn.rows[0].durationMs, 90)
})

test('uncommitted attempts are counted within their own step without being labelled as retries', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 3 }),
    record(2, 'step/start', 110, { turn: 3, step: 1 }),
    record(3, 'assistant/attempt', 140, { turn: 3, step: 1, usage: { inputTokens: 999, outputTokens: 999 } }),
    record(4, 'assistant/attempt', 170, { turn: 3, step: 1 }),
    record(5, 'assistant/message', 220, { turn: 3, step: 1, message: { content: [text('採用された回答')] }, usage: { inputTokens: 10, outputTokens: 2 } }),
    record(6, 'step/start', 240, { turn: 3, step: 2 }),
    message(7, 300, 3, 2, '次の回答'),
    record(8, 'turn/end', 330, { turn: 3 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.ok(turn.rows[1])
  assert.equal(turn.rows.length, 2)
  assert.equal(turn.rows[0].retries, 2)
  assert.equal(turn.rows[1].retries, 0)
  assert.match(rowDescription(turn.rows[0]), /未確定の試行 2 回/)
  assert.doesNotMatch(rowDescription(turn.rows[0]), /再試行/)
  assert.equal(turn.usage?.totalTokens, 12)
})

test('nested subtools follow parent links and retain independent durations', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 110, { turn: 1, callId: 'root', name: 'run_code', arguments: '{}' }),
    record(3, 'tool/ptc-dispatch-start', 120, { turn: 1, rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'lookup', arguments: { q: '資料' } }),
    record(4, 'tool/ptc-dispatch-start', 130, { turn: 1, rootCallId: 'root', parentCallId: 'child', subCallId: 'nested', name: 'read_file', arguments: {} }),
    record(5, 'tool/ptc-dispatch', 160, { turn: 1, rootCallId: 'root', parentCallId: 'child', subCallId: 'nested', content: [text('内側の結果')] }),
    record(6, 'tool/ptc-dispatch', 180, { turn: 1, rootCallId: 'root', parentCallId: 'root', subCallId: 'child', content: [], error: { message: '処理できませんでした' } }),
    record(7, 'tool/result', 200, { turn: 1, message: { role: 'tool', toolCallId: 'root', content: [] } }),
    record(8, 'turn/end', 210, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[1])
  assert.ok(turn.rows[2])
  assert.deepEqual(turn.rows.map(row => row.kind), ['tool', 'subtool', 'subtool'])
  assert.deepEqual(turn.rows.map(row => row.depth), [0, 1, 2])
  assert.deepEqual(turn.rows.map(row => row.durationMs), [90, 60, 30])
  assert.equal(turn.rows[1].failed, true)
  assert.deepEqual(turn.rows[2].content, [text('内側の結果')])
})

test('compaction events form one row and the compact checkpoint replaces context', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'user/message', 110, { turn: 1, content: [text('要約する前の長い本文')] }),
    record(3, 'compaction/start', 120, { turn: 1, compactionId: 'compact-1' }),
    record(4, 'compaction/summary', 160, { turn: 1, compactionId: 'compact-1', summary: [text('短い要約')] }),
    record(5, 'compaction/end', 180, { turn: 1, compactionId: 'compact-1' }),
    { ...record(6, 'user/message', 190, { turn: 1, source: { kind: 'compact-checkpoint', compactionId: 'compact-1' }, content: [text('短い要約')] }), surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } },
    record(7, 'step/start', 200, { turn: 1, step: 1 }),
    message(8, 240, 1, 1, '要約の後の回答'),
    record(9, 'turn/end', 260, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[1])
  assert.ok(turn.rows[2])
  assert.deepEqual(turn.rows.map(row => row.kind), ['user', 'compaction', 'assistant'])
  assert.equal(turn.rows[1].durationMs, 60)
  assert.deepEqual(turn.rows[1].content, [text('短い要約')])
  assert.deepEqual(turn.rows[1].input, [text('要約する前の長い本文')])
  assert.deepEqual(turn.rows[2].input, [text('短い要約')])
})

test('TTFT skips metadata and empty raw chunks before the first actual output', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 900, { turn: 1 }),
    record(2, 'step/start', 1000, { turn: 1, step: 1 }),
    record(3, 'assistant/message', 1500, {
      turn: 1, step: 1, message: { content: [text('回答')] },
      stream: [
        { type: 'chunk', time: 1010, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'chunk', time: 1020, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 0 } } },
        { type: 'chunk', time: 1050, chunk: { type: 'text-delta', index: 0, text: '' } },
        { type: 'chunk', time: 1250, chunk: { type: 'text-delta', index: 0, text: '回答' } },
      ],
    }),
    record(4, 'turn/end', 1600, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.rows[0].durationMs, 500)
  assert.equal(turn.rows[0].firstOutputMs, 250)
})

test('TTFT decodes compressed text, reasoning and tool-argument output timestamps', () => {
  for (const type of ['text-chunks', 'reasoning-chunks', 'tool-call-chunks']) {
    const output: Record<string, string[]> = type === 'tool-call-chunks' ? { args: ['', '{'] } : { texts: ['', '出力'] }
    const [turn] = buildTrace([
      record(1, 'turn/start', 900, { turn: 1 }),
      record(2, 'step/start', 1000, { turn: 1, step: 1 }),
      record(3, 'assistant/message', 1700, {
        turn: 1, step: 1, message: { content: [text('完了')] },
        stream: [{ type, time0: 1050, dt: [200], index: 0, ...output }],
      }),
      record(4, 'turn/end', 1800, { turn: 1 }),
    ])
    assert.ok(turn)
    assert.ok(turn.rows[0])
    assert.equal(turn.rows[0].firstOutputMs, 250, type)
  }
})

test('a stream containing only metadata does not invent a first output time', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'assistant/message', 200, { turn: 1, step: 1, message: { content: [] }, stream: [
      { type: 'chunk', time: 120, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      { type: 'chunk', time: 130, chunk: { type: 'finish', reason: { kind: 'stop' } } },
    ] }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.rows[0].firstOutputMs, undefined)
  assert.equal(elapsed(undefined, 50), undefined)
  assert.equal(elapsed(50, undefined), undefined)
  assert.equal(elapsed(50, 50), 0)
  assert.equal(elapsed(100, 50), 0)
})

test('turn usage sums disjoint input, cache reads, cache writes and output, without retries', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'assistant/attempt', 150, { turn: 1, step: 1, usage: { inputTokens: 999, outputTokens: 999 } }),
    record(4, 'assistant/message', 200, { turn: 1, step: 1, message: { content: [] }, usage: { inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 4, reasoningTokens: 2 } }),
    record(5, 'step/start', 220, { turn: 1, step: 2 }),
    record(6, 'assistant/message', 300, { turn: 1, step: 2, message: { content: [] }, usage: { inputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 7, outputTokens: 8 } }),
    record(7, 'compaction/start', 310, { turn: 1, compactionId: 'c' }),
    record(8, 'compaction/summary', 350, { turn: 1, compactionId: 'c', summary: '要約', usage: { inputTokens: 1000, outputTokens: 1000 } }),
    record(9, 'compaction/end', 360, { turn: 1, compactionId: 'c' }),
    record(10, 'turn/end', 400, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.usage?.inputTokens, 15)
  assert.equal(turn.usage?.cacheReadTokens, 26)
  assert.equal(turn.usage?.cacheWriteTokens, 37)
  assert.equal(turn.usage?.outputTokens, 12)
  assert.equal(turn.usage?.totalTokens, 90)
  assert.match(turnHeading(turn), /90 トークン/)
  assert.match(rowDescription(turn.rows[0]), /出力 4 トークン/)
})

test('search matches kind, tool name, body and arguments while preserving all turn headings', () => {
  const turns = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'user/message', 110, { turn: 1, content: [text('検索したい本文')] }),
    record(3, 'tool/call', 120, { turn: 1, callId: 'a', name: 'Read_File', arguments: '{"path":"docs/guide.md"}' }),
    record(4, 'turn/end', 200, { turn: 1 }),
    record(5, 'turn/start', 300, { turn: 2 }),
    message(6, 350, 2, 1, '次の回答'),
    record(7, 'turn/end', 400, { turn: 2 }),
  ])
  assert.ok(turns[1])
  for (const query of ['ツール', ' ｒｅａｄ＿ｆｉｌｅ ', 'guide.md']) {
    const found = filterTrace(turns, query)
    assert.ok(found[0])
    assert.ok(found[1])
    assert.ok(found[0].rows[0])
    assert.deepEqual(found.map(turn => turn.number), [1, 2])
    assert.deepEqual(found.map(turn => turn.rows.length), [1, 0])
    assert.equal(found[0].rows[0].kind, 'tool')
    assert.equal(turnHeading(found[1]), turnHeading(turns[1]))
  }
  const userMatch = filterTrace(turns, 'したい')[0]
  const assistantMatch = filterTrace(turns, 'アシスタント')[1]
  assert.ok(userMatch)
  assert.ok(userMatch.rows[0])
  assert.ok(assistantMatch)
  assert.ok(assistantMatch.rows[0])
  assert.equal(userMatch.rows[0].kind, 'user')
  assert.equal(assistantMatch.rows[0].kind, 'assistant')
  assert.deepEqual(filterTrace(turns, '該当しない').map(turn => turn.rows.length), [0, 0])
  assert.deepEqual(filterTrace(turns, '  ').map(turn => turn.rows.length), [2, 1])
  assert.deepEqual(turns.map(turn => turn.rows.length), [2, 1])
})

test('unknown extension events do not create an empty turn or a bogus row', () => {
  assert.deepEqual(buildTrace([record(1, 'future/extension', 10, { turn: 99 })]), [])
  assert.deepEqual(buildTrace([]), [])
})

test('user messages arriving before turn/start are absorbed into the following turn', () => {
  const turns = buildTrace([
    record(1, 'user/message', 100, { content: [text('先に届く質問')] }),
    record(2, 'turn/start', 110, { turn: 5 }),
    record(3, 'step/start', 120, { turn: 5, step: 1 }),
    message(4, 200, 5, 1, '回答'),
    record(5, 'turn/end', 210, { turn: 5 }),
  ])
  assert.ok(turns[0])
  assert.ok(turns[0].rows[1])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].number, 5)
  assert.equal(turns[0].partial, false)
  assert.equal(turns[0].durationMs, 100)
  assert.deepEqual(turns[0].rows.map(row => row.turn), [5, 5])
  assert.deepEqual(turns[0].rows[1].input, [text('先に届く質問')])
})

test('a checkpoint replaces only its declared history range in subsequent input', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'user/message', 110, { turn: 1, content: [text('古い質問')] }),
    message(3, 130, 1, 1, '古い返答'),
    record(4, 'user/message', 140, { turn: 1, content: [text('残す新しい質問')] }),
    { ...record(5, 'user/message', 150, { turn: 1, source: { kind: 'compact-checkpoint', compactionId: 'c' }, content: [text('古い部分の要約')] }), surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 } },
    record(6, 'step/start', 160, { turn: 1, step: 2 }),
    message(7, 200, 1, 2, '次の返答'),
  ])
  assert.ok(turn)
  const assistant = turn.rows.find(row => row.kind === 'assistant' && row.step === 2)
  assert.ok(assistant)
  assert.deepEqual(assistant.input, [text('古い部分の要約'), text('残す新しい質問')])
})

test('TTFT outside the request lifetime remains unmeasured', () => {
  for (const time of [99, 201]) {
    const [turn] = buildTrace([
      record(1, 'turn/start', 90, { turn: 1 }),
      record(2, 'step/start', 100, { turn: 1, step: 1 }),
      record(3, 'assistant/message', 200, { turn: 1, step: 1, message: { content: [text('返答')] }, stream: [
        { type: 'chunk', time, chunk: { type: 'text-delta', index: 0, text: '返答' } },
      ] }),
    ])
    assert.ok(turn)
    assert.ok(turn.rows[0])
    assert.equal(turn.rows[0].firstOutputMs, undefined)
  }
})

test('the feature mock loads one older page and retains retries, nesting and shared history', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const binding = ctx.sessions.retain(TRACE_EXAMPLE_SESSION_ID, { source: 'm3e.test' }).binding
    const shared = foldSessionWindow(ctx.sessions.retain('approval-sheet', { source: 'm3e.test' }).binding.eventSource.getSnapshot())
    assert.equal(binding.session.getSnapshot().hasMore, true)
    const before = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.equal(before.records.length, 100)
    const pending = binding.session.loadOlder()
    assert.equal(binding.session.getSnapshot().loadingOlder, true)
    await pending
    assert.equal(binding.session.getSnapshot().loadingOlder, false)
    assert.equal(binding.session.getSnapshot().hasMore, false)
    const { records, stream } = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.deepEqual(records, traceExampleRecords)
    const turns = buildTrace(records, stream, binding.session.getSnapshot().running)
    assert.ok(turns[0])
    assert.ok(turns[1])
    assert.ok(turns[2])
    assert.deepEqual(turns.map(turn => turn.number), [1, 2, 3])
    assert.equal(turns[0].rows.filter(row => row.kind === 'assistant').length, 18)
    assert.equal(turns[1].rows.find(row => row.kind === 'assistant')!.retries, 2)
    assert.deepEqual(turns[1].rows.filter(row => row.kind === 'subtool').map(row => row.depth), [1, 2])
    assert.equal(turns[1].rows.filter(row => row.kind === 'compaction').length, 1)
    assert.equal(turns[1].rows.filter(row => row.kind === 'tool' && row.failed).length, 1)
    assert.equal(turns[2].rows.find(row => row.kind === 'assistant')!.running, true)
    assert.deepEqual(foldSessionWindow(ctx.sessions.retain('approval-sheet', { source: 'm3e.test' }).binding.eventSource.getSnapshot()), shared)
  } finally { ctx.dispose() }
})

test('tool result source IDs and errors are honored independently of the displayed block', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 120, { turn: 1, callId: 'source-id', name: 'bash', arguments: '{invalid' }),
    record(3, 'tool/result', 150, { turn: 1, error: { code: 'FAILED' }, message: { role: 'tool', source: { kind: 'tool', callId: 'source-id' }, toolCallId: 'source-id', content: [text('結果')], isError: true } }),
    record(4, 'turn/end', 160, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.rows.length, 1)
  assert.equal(turn.rows[0].durationMs, 30)
  assert.equal(turn.rows[0].failed, true)
})

test('provider totalTokens does not override the four disjoint trajectory token counters', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'assistant/message', 150, { turn: 1, step: 1, message: { content: [text('回答')] }, usage: {
      inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 4, totalTokens: 9999,
    } }),
    record(4, 'turn/end', 160, { turn: 1 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.equal(turn.rows[0].usage?.totalTokens, 64)
  assert.equal(turn.usage?.totalTokens, 64)
  assert.match(turnHeading(turn), /64 トークン/)
})

test('step start keeps a stable live row while later user messages precede the response and enter its input', () => {
  const beginning = [record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 })]
  const waiting = buildTrace(beginning, null, true)[0]?.rows[0]
  assert.ok(waiting)
  assert.equal(waiting.running, true)
  assert.equal(waiting.startedAt, 110)
  assert.deepEqual(waiting.input, [])
  const entered = [...beginning,
    record(3, 'user/message', 120, { content: [text('今回の質問')] }),
    record(4, 'user/message', 130, { source: { kind: 'plugin:context' }, content: [text('追加の資料')] }),
  ]
  const pending = buildTrace(entered, null, true)[0]
  assert.ok(pending)
  assert.deepEqual(pending.rows.map(row => row.kind), ['user', 'user', 'assistant'])
  assert.equal(pending.rows[2]?.id, waiting.id)
  assert.equal(pending.rows[2]?.running, true)
  assert.deepEqual(pending.rows[2]?.input, [text('今回の質問'), text('追加の資料')])
  const settled = buildTrace([...entered, message(5, 200, 1, 1, '回答'), record(6, 'step/end', 210, { turn: 1, step: 1 })])[0]
  assert.ok(settled)
  assert.deepEqual(settled.rows.map(row => row.kind), ['user', 'user', 'assistant'])
  assert.equal(settled.rows[2]?.id, waiting.id)
  assert.equal(settled.rows[2]?.durationMs, 90)
  assert.deepEqual(settled.rows[2]?.input, [text('今回の質問'), text('追加の資料')])
})

test('a later step captures entered input after prior tool results without changing the earlier response input', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('元の質問')] }), message(4, 140, 1, 1, '調べます'),
    record(5, 'tool/result', 160, { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'read' }, toolCallId: 'read', content: [text('資料の内容')] } }),
    record(6, 'step/end', 170, { turn: 1, step: 1 }), record(7, 'step/start', 180, { turn: 1, step: 2 }),
    record(8, 'user/message', 190, { content: [text('この資料も確認して')] }), message(9, 220, 1, 2, '確認しました'),
  ])
  assert.ok(turn)
  const responses = turn.rows.filter(row => row.kind === 'assistant')
  assert.deepEqual(responses[0]?.input, [text('元の質問')])
  assert.deepEqual(responses[1]?.input, [text('元の質問'), text('調べます'), { type: 'tool-output', toolCallId: 'read', content: [text('資料の内容')] }, text('この資料も確認して')])
  assert.deepEqual(turn.rows.map(row => row.kind), ['user', 'assistant', 'tool', 'user', 'assistant'])
})

test('an unsuccessful model attempt retains its finish failure after the turn closes', () => {
  const failure = { code: 'NETWORK', message: '接続できませんでした。' }
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('質問')] }),
    record(4, 'assistant/attempt', 210, { turn: 1, step: 1, stream: [{ type: 'chunk', time: 210, chunk: { type: 'finish', reason: { kind: 'error', failure } } }] }),
    record(5, 'step/end', 220, { turn: 1, step: 1 }), record(6, 'turn/end', 230, { turn: 1, reason: { kind: 'error', error: failure } }),
  ])
  assert.ok(turn)
  const row = turn.rows.find(item => item.kind === 'assistant')
  assert.ok(row)
  assert.equal(row.failed, true)
  assert.equal(row.error, failure.message)
  assert.equal(row.durationMs, 100)
  assert.equal(row.attempts?.[0]?.termination?.message, failure.message)
  assert.deepEqual(row.input, [text('質問')])
  assert.match(rowDescription(row), /失敗/)
  assert.equal(turn.termination?.message, failure.message)
  assert.match(turnHeading(turn), /失敗/)
})

test('retry history remains inspectable without making a running retry or its successful result fail', () => {
  const records = [
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('質問')] }),
    record(4, 'assistant/attempt', 150, { turn: 1, step: 1, stream: [{ type: 'chunk', time: 150, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'NETWORK', message: '一時的に接続できませんでした。' } } } }] }),
    record(5, 'llm/retry', 155, { turn: 1, step: 1, retry: 1, mode: 'normal', delayMs: 10, maxRetries: 3 }),
  ]
  const pending = buildTrace(records, null, true)[0]?.rows.find(row => row.kind === 'assistant')
  assert.ok(pending)
  assert.equal(pending.running, true)
  assert.equal(pending.failed, false)
  assert.equal(pending.termination, undefined)
  const [turn] = buildTrace([...records, message(6, 200, 1, 1, '成功しました'), record(7, 'step/end', 210, { turn: 1, step: 1 }), record(8, 'turn/end', 220, { turn: 1, reason: { kind: 'completed' } })])
  assert.ok(turn)
  const row = turn.rows.find(item => item.kind === 'assistant')
  assert.ok(row)
  assert.equal(row.failed, false)
  assert.equal(row.error, undefined)
  assert.equal(row.termination, undefined)
  assert.equal(turn.termination, undefined)
  assert.equal(row.attempts?.[0]?.termination?.kind, 'error')
  assert.equal(row.retries, 1)
  assert.doesNotMatch(rowDescription(row), /失敗/)
})

test('an interrupted settled prefix preserves its content and displays the durable cancellation cause', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('途中で止める質問')] }),
    record(4, 'assistant/message', 150, { turn: 1, step: 1, interrupted: true, message: { content: [text('途中の回答')] }, stream: [{ type: 'text-chunks', time0: 140, dt: [], index: 0, texts: ['途中の回答'] }] }),
    record(5, 'step/end', 160, { turn: 1, step: 1 }),
    record(6, 'turn/end', 170, { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
  ])
  assert.ok(turn)
  const row = turn.rows.find(item => item.kind === 'assistant')
  assert.ok(row)
  assert.equal(row.failed, false)
  assert.equal(row.termination?.kind, 'aborted')
  assert.match(row.termination?.message ?? '', /ユーザー/)
  assert.deepEqual(row.content, [text('途中の回答')])
  assert.equal(row.firstOutputMs, 30)
  assert.match(rowDescription(row), /中断/)
  assert.match(turnHeading(turn), /中断/)
})

test('turn termination supplies model preparation errors while later tool errors do not relabel a successful response', () => {
  const preparationFailure = { code: 'UNAVAILABLE', message: 'モデルを準備できませんでした。' }
  const early = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'step/end', 150, { turn: 1, step: 1 }), record(4, 'turn/end', 160, { turn: 1, reason: { kind: 'error', error: preparationFailure } }),
  ])[0]?.rows[0]
  assert.equal(early?.failed, true)
  assert.equal(early?.error, preparationFailure.message)
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 2 }), record(2, 'step/start', 110, { turn: 2, step: 1 }),
    message(3, 150, 2, 1, 'ツールを実行します'), record(4, 'tool/call', 160, { turn: 2, step: 1, callId: 'tool', name: 'bash', arguments: '{}' }),
    record(5, 'step/end', 180, { turn: 2, step: 1 }), record(6, 'turn/end', 190, { turn: 2, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'ツールの実行中に失敗しました。' } } }),
  ])
  assert.ok(turn)
  assert.equal(turn.rows[0]?.failed, false)
  assert.equal(turn.rows[0]?.termination, undefined)
  assert.equal(turn.termination?.kind, 'error')
})

test('turn end distinguishes cancellation causes, recovered interruption, blocked work and output limits', () => {
  const cases: { reason: SessionWireEvent['data']; label: string; cause: string }[] = [
    { reason: { kind: 'aborted', reason: { kind: 'parent' } }, label: '中断', cause: '親セッション' },
    { reason: { kind: 'aborted', reason: { kind: 'hook', reason: '確認が必要です。' } }, label: '中断', cause: '確認が必要' },
    { reason: { kind: 'aborted', reason: { kind: 'disposed' } }, label: '中断', cause: '閉じられた' },
    { reason: { kind: 'aborted', reason: { kind: 'legacy' } }, label: '中断', cause: '記録されていません' },
    { reason: { kind: 'interrupted' }, label: '中断', cause: '終了が記録されない' },
    { reason: { kind: 'blocked' }, label: '実行見送り', cause: '見送られました' },
    { reason: { kind: 'max-tokens' }, label: '上限到達', cause: '上限に達しました' },
  ]
  for (const sample of cases) {
    const [turn] = buildTrace([record(1, 'turn/start', 100, { turn: 1 }), record(2, 'turn/end', 200, { turn: 1, reason: sample.reason })])
    assert.ok(turn)
    assert.ok(turn.termination?.message.includes(sample.cause))
    assert.ok(turnHeading(turn).includes(sample.label))
    assert.equal(turn.rows.length, 0)
  }
})

test('an orphaned terminal attempt keeps its recorded cause without a turn closer or a fabricated finishReason field', () => {
  const [failed] = buildTrace([record(1, 'assistant/attempt', 200, { turn: 2, step: 3, stream: [{ type: 'chunk', time: 200, chunk: { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '要求が中断されました。' } } } }] })])
  assert.ok(failed)
  assert.equal(failed.rows[0]?.termination?.kind, 'aborted')
  assert.equal(failed.rows[0]?.durationMs, undefined)
  const [successful] = buildTrace([record(1, 'assistant/message', 200, { turn: 1, step: 1, message: { content: [text('回答')] }, finishReason: { kind: 'error', failure: { message: '実際の形式にはない値' } } })])
  assert.equal(successful?.rows[0]?.failed, false)
})

test('the mocks use entered-step input order and retain historical failure causes after a successful later turn', () => {
  assert.deepEqual(traceExampleRecords.slice(0, 3).map(event => event.type), ['turn/start', 'step/start', 'user/message'])
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const binding = ctx.sessions.retain(TRACE_FAILURE_SESSION_ID, { source: 'm3e.test' }).binding
    assert.ok(binding)
    const { records } = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.deepEqual(records, traceFailureRecords)
    const turns = buildTrace(records)
    assert.deepEqual(turns.map(turn => turn.termination?.kind), ['error', 'aborted', 'blocked', 'interrupted', undefined])
    assert.equal(turns[0]?.rows.find(row => row.kind === 'assistant')?.failed, true)
    assert.equal(turns[4]?.rows.find(row => row.kind === 'assistant')?.failed, false)
    assert.ok(turns[1]?.rows.find(row => row.kind === 'assistant')?.termination?.message.includes('ユーザー'))
  } finally { ctx.dispose() }
})

test('rendering and searching a long trace does not expand any prior input until one row is inspected', () => {
  let surfaceReads = 0
  const records: SessionWireEvent[] = [record(0, 'turn/start', 0, { turn: 1 })]
  for (let step = 1; step <= 300; step++) {
    records.push(record(records.length, 'step/start', records.length, { turn: 1, step }))
    records.push({ ...record(records.length, 'user/message', records.length, { content: [text(`質問 ${step}`)] }),
      get surfaceOp() { surfaceReads++; return 'append' } })
    records.push({ ...message(records.length, records.length, 1, step, `回答 ${step}`),
      get surfaceOp() { surfaceReads++; return 'append' } })
    records.push(record(records.length, 'step/end', records.length, { turn: 1, step }))
  }
  records.push(record(records.length, 'turn/end', records.length, { turn: 1, reason: { kind: 'completed' } }))
  const turns = selectTrace(records)
  for (const turn of turns) {
    turnHeading(turn)
    for (const row of turn.rows) rowDescription(row)
  }
  filterTrace(turns, '回答')
  assert.equal(surfaceReads, 0, 'list-only work must not replay any input surface')
  const last = turns[0]?.rows.at(-1)
  assert.ok(last)
  assert.equal(findTraceRow(turns, last.id), last)
  assert.equal(surfaceReads, 0, 'finding the selected row must not expand input either')
  const input = last.input
  assert.equal(input.length, 599)
  assert.deepEqual(input.at(-1), text('質問 300'))
  assert.equal(surfaceReads, 599)
  assert.equal(last.input, input)
  assert.equal(surfaceReads, 599, 'reopening the same input reuses its resolved array')
})

test('list and sheet share the latest projection without retaining every streamed revision', () => {
  const records = [record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('質問')] })]
  const firstStream: AssistantStream = { attemptId: 'a', turn: 1, step: 1, chunks: [], content: [{ type: 'text', text: '途' }] }
  const nextStream: AssistantStream = { ...firstStream, content: [{ type: 'text', text: '途中' }] }
  const first = selectTrace(records, firstStream, true)
  assert.equal(selectTrace(records, firstStream, true), first)
  const firstRow = first[0]?.rows.at(-1)
  assert.ok(firstRow)
  const firstInput = firstRow.input
  const next = selectTrace(records, nextStream, true)
  assert.notEqual(next, first)
  assert.deepEqual(firstRow.content, [text('途')], 'a later stream must not mutate the earlier view')
  assert.deepEqual(next[0]?.rows.at(-1)?.content, [text('途中')])
  assert.equal(next[0]?.rows.at(-1)?.input, firstInput, 'input does not change on a text-only update')
  assert.equal(selectTrace(records, nextStream, true), next)
  assert.notEqual(selectTrace(records, firstStream, true), first, 'an older streamed revision is not retained in the shared cache')
  const stopped = selectTrace(records, nextStream, false)
  assert.equal(stopped[0]?.rows.at(-1)?.running, false)
  const settledRecords = [...records, message(4, 200, 1, 1, '確定した回答')]
  const settled = selectTrace(settledRecords, nextStream, true)
  assert.deepEqual(settled[0]?.rows.at(-1)?.content, [text('確定した回答')])
  assert.deepEqual(firstRow.input, [text('質問')])
  assert.equal(findTraceRow(settled, '存在しない記録'), undefined)
})

test('lazy input is resolved at each original request boundary even when inspected after compaction', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }), record(2, 'step/start', 110, { turn: 1, step: 1 }),
    record(3, 'user/message', 120, { content: [text('古い質問')] }), message(4, 140, 1, 1, '古い回答'),
    record(5, 'compaction/start', 150, { turn: 1, compactionId: 'c' }),
    record(6, 'compaction/summary', 160, { turn: 1, compactionId: 'c', summary: [text('置き換えた要約')] }),
    { ...record(7, 'user/message', 170, { source: { kind: 'compact-checkpoint', compactionId: 'c' }, content: [text('置き換えた要約')] }), surfaceOp: { op: 'replace', startSeq: 3, endSeq: 4 } },
    record(8, 'compaction/end', 180, { turn: 1, compactionId: 'c' }), record(9, 'step/start', 190, { turn: 1, step: 2 }),
    record(10, 'user/message', 200, { content: [text('新しい質問')] }), message(11, 220, 1, 2, '新しい回答'),
  ])
  assert.ok(turn)
  const earlier = turn.rows.find(row => row.kind === 'assistant' && row.step === 1)
  const later = turn.rows.find(row => row.kind === 'assistant' && row.step === 2)
  const compaction = turn.rows.find(row => row.kind === 'compaction')
  assert.ok(earlier)
  assert.ok(later)
  assert.ok(compaction)
  assert.deepEqual(later.input, [text('置き換えた要約'), text('新しい質問')])
  assert.deepEqual(compaction.input, [text('古い質問'), text('古い回答')])
  assert.deepEqual(earlier.input, [text('古い質問')])
  assert.deepEqual(later.input, [text('置き換えた要約'), text('新しい質問')])
})

test('a first and final failed attempt is labelled as uncommitted rather than as a retry', () => {
  const row = buildTrace(traceFailureRecords)[0]?.rows.find(item => item.kind === 'assistant')
  assert.ok(row)
  assert.equal(row.retries, 1)
  assert.match(rowDescription(row), /未確定の試行 1 回/)
  assert.match(rowDescription(row), /失敗/)
  assert.doesNotMatch(rowDescription(row), /再試行/)
})

test('durations use the chat units while unmeasured values stay distinct from invalid ones', () => {
  assert.equal(formatDuration(undefined), '未計測')
  assert.equal(formatDuration(Number.NaN), '不明')
  assert.equal(formatDuration(-1), '不明')
  assert.equal(formatDuration(0), '0 ミリ秒')
  assert.equal(formatDuration(850), '850 ミリ秒')
  assert.equal(formatDuration(4100), '4.1 秒')
  assert.equal(formatDuration(18430), '18.4 秒')
  assert.equal(formatDuration(90000), '1 分 30 秒')
  assert.equal(formatDuration(1234567), '20 分 34 秒')
  assert.equal(formatDuration(90000), chatFormatDuration(90000))
  assert.equal(formatDuration(4100), chatFormatDuration(4100))
  assert.equal(formatCount(1234567), '1,234,567')
})

test('tool rows choose icons by tool name and keep the kind icon otherwise', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 110, { turn: 1, callId: 'r', name: 'read_file', arguments: '{}' }),
    record(3, 'tool/call', 120, { turn: 1, callId: 'b', name: 'bash', arguments: '{}' }),
    record(4, 'tool/call', 130, { turn: 1, callId: 'u', name: 'inspect_files', arguments: '{}' }),
    record(5, 'tool/ptc-dispatch-start', 140, { turn: 1, rootCallId: 'u', parentCallId: 'u', subCallId: 's', name: 'read_file', arguments: '{}' }),
  ])
  assert.ok(turn)
  const icons = Object.fromEntries(turn.rows.map(row => [`${row.kind}:${row.toolName}`, traceRowIcon(row)]))
  assert.deepEqual(icons, {
    'tool:read_file': 'description', 'tool:bash': 'terminal', 'tool:inspect_files': 'terminal', 'subtool:read_file': 'description',
  })
  const [user] = buildTrace([record(1, 'turn/start', 100, { turn: 1 }), record(2, 'user/message', 110, { turn: 1, content: [text('質問')] })])[0]?.rows ?? []
  assert.ok(user)
  assert.equal(traceRowIcon(user), 'person')
})

test('a tool name that first arrives with the result names the row and its icon', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 110, { turn: 1, callId: 'late' }),
    record(3, 'tool/result', 150, { turn: 1, name: 'read_file', message: { role: 'tool', toolCallId: 'late', content: [text('本文')] } }),
  ])
  const row = turn?.rows[0]
  assert.ok(row)
  assert.equal(row.title, 'ツール：read_file')
  assert.equal(traceRowIcon(row), 'description')
  assert.equal(filterTrace([turn], 'read_file')[0]?.rows.length, 1)
})

test('record detail rows summarize time, tokens, input and output as in Canvas', () => {
  assert.equal(recordDurationText({ running: false, durationMs: 4100, firstOutputMs: 800 }), '4.1 秒（最初の出力まで 800 ミリ秒）')
  assert.equal(recordDurationText({ running: false, durationMs: undefined }), '未計測')
  assert.equal(recordDurationText({ running: true, durationMs: 4100 }), '開始済み・実行中')
  assert.equal(recordUsageText({ inputTokens: 11668, outputTokens: 812, cacheReadTokens: 9200 }),
    '入力 11,668（キャッシュを除く） ・ 出力 812 ・ キャッシュ読み込み 9,200 ・ キャッシュ書き込み 未記録')
  assert.equal(recordUsageText(undefined), 'トークン数は記録されていません')
  assert.equal(recordInputSupporting, '送ったメッセージとツールの結果')
  assert.equal(recordOutputText({ kind: 'assistant', running: false, content: [
    { type: 'reasoning', text: '考え' }, { type: 'text', text: '答え' }, { type: 'tool-call', id: 'a', name: 'bash', arguments: '{}' },
    { type: 'tool-call', id: 'b', name: 'read_file', arguments: '{}' },
  ] }), '思考 1 ・ テキスト 1 ・ ツール呼び出し 2')
  assert.equal(recordOutputText({ kind: 'compaction', running: false, content: [] }), 'まとめた要約')
  assert.equal(recordResultText({ running: true, failed: false }), '結果を待っています')
  assert.equal(recordResultText({ running: false, failed: true }), '失敗')
  assert.equal(recordResultText({ running: false, failed: false }), undefined)
})
