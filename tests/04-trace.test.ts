import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantStream } from '../web/src/dsh/session-journal.ts'
import type { SessionWireEvent } from '../web/src/dsh/services.ts'
import { buildTrace, elapsed, filterTrace, firstOutputTime, rowDescription, turnHeading } from '../web/src/features/trace/model.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { extendMock } from '../web/src/features/trace/mock.ts'
import { TRACE_EXAMPLE_SESSION_ID, traceExampleRecords } from '../web/src/features/trace/trace-fixtures.ts'

function record(seq: number, type: string, time: number, data: SessionWireEvent['data'] = {}): SessionWireEvent {
  return { seq, type, time, data }
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
    record(6, 'tool/result', 1500, { turn: 1, message: { content: [{ type: 'tool-result', toolCallId: 'same-id', content: [text('最初の結果')] }] } }),
    record(7, 'turn/end', 1600, { turn: 1 }),
    record(8, 'turn/start', 2000, { turn: 2 }),
    record(9, 'tool/call', 2100, { turn: 2, callId: 'same-id', name: 'read_file', arguments: '{}' }),
    record(10, 'tool/result', 2300, { turn: 2, message: { content: [{ type: 'tool-result', toolCallId: 'same-id', content: [text('次の結果')] }] } }),
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
    record(4, 'tool/result', 140, { turn: 1, message: { content: [{ type: 'tool-result', toolCallId: 'b', content: [text('見つかりました')] }] } }),
    record(5, 'tool/result', 190, { turn: 1, error: { message: 'ファイルがありません' }, message: { content: [{ type: 'tool-result', toolCallId: 'a', content: [], isError: true }] } }),
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
    record(20, 'tool/result', 2000, { turn: 4, message: { content: [{ type: 'tool-result', toolCallId: 'missing-start', content: [text('復元された結果')] }] } }),
    message(21, 2200, 4, 3, '完了しました'),
    record(22, 'turn/end', 2400, { turn: 4 }),
  ])
  assert.ok(turn)
  assert.ok(turn.rows[0])
  assert.ok(turn.rows[1])
  assert.equal(turn.partial, true)
  assert.equal(turn.number, 4)
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

test('discarded attempts count as retries within their own step only', () => {
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
  assert.match(rowDescription(turn.rows[0]), /再試行 2 回/)
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
    record(7, 'tool/result', 200, { turn: 1, message: { content: [{ type: 'tool-result', toolCallId: 'root', content: [] }] } }),
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
    { ...record(6, 'user/message', 190, { turn: 1, source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact-1' }, content: [text('短い要約')] }), surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } },
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
    { ...record(5, 'user/message', 150, { turn: 1, source: { kind: 'plugin', plugin: 'compact', compactionId: 'c' }, content: [text('古い部分の要約')] }), surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 } },
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
    const binding = ctx.sessions.binding(TRACE_EXAMPLE_SESSION_ID)!
    const shared = foldSessionWindow(ctx.sessions.binding('approval-sheet')!.eventSource.getSnapshot())
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
    assert.deepEqual(foldSessionWindow(ctx.sessions.binding('approval-sheet')!.eventSource.getSnapshot()), shared)
  } finally { ctx.dispose() }
})

test('tool result source IDs and errors are honored independently of the displayed block', () => {
  const [turn] = buildTrace([
    record(1, 'turn/start', 100, { turn: 1 }),
    record(2, 'tool/call', 120, { turn: 1, callId: 'source-id', name: 'bash', arguments: '{invalid' }),
    record(3, 'tool/result', 150, { turn: 1, error: { code: 'FAILED' }, message: { source: { kind: 'tool', callId: 'source-id' }, content: [{ type: 'tool-result', toolCallId: 'different-id', content: [text('結果')] }] } }),
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
