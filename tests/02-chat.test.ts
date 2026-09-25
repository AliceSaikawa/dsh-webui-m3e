import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChatRows, formatDuration, formatToolArguments, getStreamBlocks,
  isNearBottom, preservePrependScroll, summarizeToolArguments,
} from '../web/src/features/chat/model.ts'
import type { AssistantStream } from '../web/src/dsh/session-journal.ts'
import type { JsonValue, PendingSubmission, SessionWireEvent, StreamChunk } from '../web/src/dsh/services.ts'
import { readmeRecords } from '../web/src/dsh/mock/fixtures.ts'

function event(seq: number, type: string, data: JsonValue, time = seq * 100): SessionWireEvent {
  return { seq, type, data, time }
}
function stream(chunks: StreamChunk[]): AssistantStream {
  return { attemptId: 'attempt-1', turn: 1, step: 1, chunks, content: [] }
}
function pending(requestId: string, placement: PendingSubmission['placement'] = 'transcript'): PendingSubmission {
  return {
    requestId, placement, time: 1000, text: '送信した内容',
    attachments: [{ type: 'image', value: { previewUrl: 'blob:mock-preview', name: '画像.png' } }],
  }
}

test('chat rows keep visible message kinds, omit ignored attempts, and append transcript submissions', () => {
  const records: SessionWireEvent[] = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', { content: [{ type: 'text', text: '質問' }] }),
    event(3, 'assistant/attempt', { message: { content: [{ type: 'text', text: '残さない試行' }] } }),
    { ...event(4, 'assistant/message', { message: { content: [{ type: 'text', text: '無視' }] } }), ignorable: true },
    event(5, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '検討' }, { type: 'text', text: '返事' }] } }),
    event(6, 'system/message', { message: '処理を再開しました' }),
    event(7, 'future/event', { text: '知らない種類' }),
  ]
  const frozen = JSON.stringify(records)
  const submission = pending('sent')
  const rows = buildChatRows(records, null, [submission, pending('queued', 'queued'), pending('steering', 'steering')])
  assert.deepEqual(rows.map(row => row.kind), ['user', 'reasoning', 'assistant', 'system', 'pending'])
  assert.deepEqual(rows.map(row => row.seq), [2, 5, 5, 6, undefined])
  const last = rows.at(-1)
  assert.equal(last?.kind, 'pending')
  if (last?.kind === 'pending') assert.equal(last.submission, submission)
  assert.equal(JSON.stringify(records), frozen)
})

test('tool calls are matched by callId across interleaved records and keep the assistant fork point', () => {
  const records = [
    event(8, 'tool/result', { message: { source: { callId: 'b' }, content: [{ type: 'tool-result', toolCallId: 'b', content: [{ type: 'text', text: 'B の結果' }], isError: true }] } }, 2500),
    event(1, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'a', name: 'read_file', arguments: '{"path":"a.txt"}' }, { type: 'tool-call', id: 'b', name: 'bash', arguments: '{"command":"pnpm test"}' }] } }),
    event(2, 'tool/call', { callId: 'a', name: 'read_file' }, 1000),
    event(3, 'tool/call', { callId: 'b', name: 'bash' }, 1100),
    event(9, 'tool/result', { message: { source: { callId: 'a' }, content: [{ type: 'tool-result', toolCallId: 'a', content: [{ type: 'text', text: 'A の結果' }] }] }, meta: { durationMs: 99999 } }, 3000),
  ]
  const rows = buildChatRows(records)
  assert.equal(rows.length, 2)
  const a = rows[0]
  const b = rows[1]
  assert.equal(a?.kind, 'tool')
  assert.equal(b?.kind, 'tool')
  if (a?.kind !== 'tool' || b?.kind !== 'tool') return
  assert.equal(a.callId, 'a')
  assert.equal(a.seq, 1)
  assert.equal(a.durationMs, 2000)
  assert.equal(a.status, 'success')
  assert.deepEqual(a.result, [{ type: 'text', text: 'A の結果' }])
  assert.equal(b.callId, 'b')
  assert.equal(b.durationMs, 1400)
  assert.equal(b.status, 'error')
})

test('orphan results remain visible and unknown duration is not inferred from assistant timestamps', () => {
  const rows = buildChatRows([
    event(1, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'pending', name: 'bash', arguments: '' }, { type: 'tool-call', id: 'without-start', name: 'read_file', arguments: '' }] } }),
    event(2, 'tool/result', { callId: 'orphan', message: { content: [{ type: 'text', text: '結果だけ' }] }, error: { code: 'FAILED' } }),
    event(3, 'tool/result', { message: { toolCallId: 'without-start', content: [{ type: 'text', text: '完了' }] } }),
  ])
  assert.equal(rows.length, 3)
  const [running, completed, orphan] = rows
  if (running?.kind !== 'tool' || completed?.kind !== 'tool' || orphan?.kind !== 'tool') throw new Error('ツール行がありません')
  assert.equal(running.status, 'running')
  assert.equal(running.durationMs, undefined)
  assert.equal(completed.status, 'success')
  assert.equal(completed.durationMs, undefined)
  assert.equal(orphan.seq, 2)
  assert.equal(orphan.name, 'ツール')
  assert.equal(orphan.status, 'error')
  assert.deepEqual(orphan.error, { code: 'FAILED' })
})

test('ignored tool results do not complete a call and negative elapsed values clamp to zero', () => {
  const rows = buildChatRows([
    event(1, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'a', name: 'a', arguments: '' }, { type: 'tool-call', id: 'b', name: 'b', arguments: '' }] } }),
    { ...event(2, 'tool/result', { callId: 'a', content: [] }), ignorable: true },
    event(3, 'tool/call', { callId: 'b' }, 1000),
    event(4, 'tool/result', { callId: 'b', content: [] }, 900),
  ])
  const [a, b] = rows
  if (a?.kind !== 'tool' || b?.kind !== 'tool') throw new Error('ツール行がありません')
  assert.equal(a.status, 'running')
  assert.equal(b.durationMs, 0)
})

test('command completion uses command/run only to find its name', () => {
  const rows = buildChatRows([
    event(1, 'command/run', { name: 'permission', commandId: 'command-1' }),
    event(2, 'command/done', { commandId: 'command-1', text: '変更しました' }),
    event(3, 'command/done', { sourceEventSeq: 1 }),
    event(4, 'command/done', { commandId: 'older-command' }),
  ])
  assert.deepEqual(rows.map(row => row.kind), ['command', 'command', 'command'])
  assert.deepEqual(rows.map(row => row.kind === 'command' ? [row.name, row.text] : []), [['permission', '変更しました'], ['permission', ''], ['', '']])
})

test('system messages read the installed message payload and preserve structured text content', () => {
  const rows = buildChatRows([
    event(1, 'system/message', { message: '処理を再開しました' }),
    event(2, 'system/message', { message: { content: [{ type: 'text', text: '最初の行' }, { type: 'text', text: '次の行' }] } }),
    event(3, 'system/message', { text: '以前の偽データ' }),
  ])
  assert.deepEqual(rows.map(row => row.kind === 'system' ? row.text : ''), ['処理を再開しました', '最初の行\n\n次の行', '以前の偽データ'])
})

test('the shared README mock produces reasoning, merged tools, an attachment, and command output', () => {
  const rows = buildChatRows(readmeRecords)
  assert.deepEqual(rows.map(row => row.kind), ['user', 'reasoning', 'tool', 'tool', 'assistant', 'command'])
  const user = rows[0]
  assert.ok(user?.kind === 'user' && user.content.some(block => block.type === 'image'))
  const tools = rows.filter(row => row.kind === 'tool')
  assert.deepEqual(tools.map(row => [row.name, row.status, row.durationMs]), [['read_file', 'success', 100], ['bash', 'error', 1200]])
  const command = rows.at(-1)
  assert.ok(command?.kind === 'command')
  assert.equal(command.name, 'permission')
  assert.equal(command.text, '/permission を実行しました')
})

test('argument summary respects priority, invalid JSON, scalar values, Unicode, and length limit', () => {
  assert.equal(summarizeToolArguments('{"path":"README.md","command":"pnpm test"}'), 'pnpm test')
  assert.equal(summarizeToolArguments('{"file_path":"src/main.ts"}'), 'src/main.ts')
  assert.equal(summarizeToolArguments('{"pattern":"x","query":"y","url":"https://example.test"}'), 'x')
  assert.equal(summarizeToolArguments('{"command":"  \n" ,"path":"README.md"}'), undefined)
  assert.equal(summarizeToolArguments(JSON.stringify({ command: ' \n ', path: 'README.md' })), 'README.md')
  assert.equal(summarizeToolArguments('{'), undefined)
  assert.equal(summarizeToolArguments('null'), undefined)
  assert.equal(summarizeToolArguments('["path"]'), undefined)
  assert.equal(summarizeToolArguments('{"command":42}'), undefined)
  assert.equal(summarizeToolArguments('{"other":"x"}'), undefined)
  assert.equal(summarizeToolArguments(JSON.stringify({ query: 'あ😀いうえお' }), 5), 'あ😀いう…')
  assert.equal(summarizeToolArguments(JSON.stringify({ query: 'a\nb\tc' })), 'a b c')
  assert.equal(formatToolArguments('{"path":"a"}'), '{\n  "path": "a"\n}')
  assert.equal(formatToolArguments('{broken'), '{broken')
})

test('parallel streaming blocks retain independent text, stable index keys, and authoritative block-end', () => {
  const first: StreamChunk[] = [
    { type: 'block-start', index: 2, blockType: 'text' },
    { type: 'text-delta', index: 2, text: '返' },
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '検討' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'read_file', argumentsDelta: '{"path":' },
    { type: 'text-delta', index: 2, text: '事' },
  ]
  const before = buildChatRows([], stream(first))
  assert.deepEqual(before.map(row => [row.key, row.kind]), [['stream:attempt-1:0', 'reasoning'], ['stream:attempt-1:1', 'tool'], ['stream:attempt-1:2', 'assistant']])
  const complete = stream([
    ...first,
    { type: 'reasoning-delta', index: 0, text: '中' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', argumentsDelta: '"README.md"}' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '確定した検討' } },
    { type: 'reasoning-delta', index: 0, text: '追加しない' },
    { type: 'block-end', index: 2, block: { type: 'text', text: '確定した返事' } },
  ])
  const blocks = getStreamBlocks(complete)
  assert.deepEqual(blocks.map(value => [value.index, value.complete]), [[0, true], [1, false], [2, true]])
  const rows = buildChatRows([], complete)
  assert.deepEqual(rows.map(row => row.kind === 'tool' ? [row.arguments, row.status] : row.kind === 'reasoning' || row.kind === 'assistant' ? [row.text, row.streaming] : []), [['確定した検討', false], ['{"path":"README.md"}', 'running'], ['確定した返事', false]])
  assert.deepEqual(rows.map(row => row.key), before.map(row => row.key))
  assert.equal((before[0] as { text: string }).text, '検討')
})

test('folded stream content is not added again and reconnect replaces previous transient text', () => {
  const value = stream([{ type: 'text-delta', index: 3, text: '現在の返事' }])
  const baseline: AssistantStream = { ...value, content: [{ type: 'text', text: '現在の返事' }] }
  const first = buildChatRows([], baseline)
  assert.ok(first[0]?.kind === 'assistant')
  assert.equal(first[0].text, '現在の返事')
  assert.equal(first[0].key, 'stream:attempt-1:3')
  const restored = buildChatRows([], stream([{ type: 'text-delta', index: 3, text: '復元した返事' }]))
  assert.ok(restored[0]?.kind === 'assistant')
  assert.equal(restored[0].text, '復元した返事')
  const contentOnly = buildChatRows([], { ...value, chunks: [], content: [{ type: 'text', text: '本文' }], finishReason: { kind: 'stop' } })
  assert.ok(contentOnly[0]?.kind === 'assistant')
  assert.equal(contentOnly[0].streaming, false)
})

test('stream finish stops generation indicators without marking unanswered tools successful', () => {
  const rows = buildChatRows([], stream([
    { type: 'reasoning-delta', index: 0, text: '考え' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'bash', argumentsDelta: '{}' },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]))
  assert.ok(rows[0]?.kind === 'reasoning')
  assert.equal(rows[0].streaming, false)
  assert.ok(rows[1]?.kind === 'tool')
  assert.equal(rows[1].status, 'running')
})

test('malformed message JSON is skipped while unsupported result blocks keep their type labels', () => {
  const rows = buildChatRows([
    event(1, 'assistant/message', null),
    event(2, 'system/message', []),
    event(3, 'assistant/message', { message: { content: [null, { type: 'text', text: 42 }, { type: 'tool-call' }] } }),
    event(4, 'tool/result', { callId: 'opaque', content: [{ type: 'audio', data: 'opaque' }] }),
  ])
  assert.equal(rows.length, 1)
  assert.ok(rows[0]?.kind === 'tool')
  assert.deepEqual(rows[0].result, [{ type: 'unsupported', originalType: 'audio' }])
})

test('scroll decisions follow the bottom threshold and preserve the visible anchor after prepend', () => {
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 536 }), true)
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 535 }), false)
  assert.equal(isNearBottom({ scrollHeight: 300, clientHeight: 400, scrollTop: -20 }), true)
  assert.equal(preservePrependScroll({ scrollHeight: 1000, clientHeight: 400, scrollTop: 18 }, 1800), 818)
  assert.equal(preservePrependScroll({ scrollHeight: 1000, clientHeight: 400, scrollTop: -30 }, 1000), 0)
})

test('duration labels use known elapsed time without a live clock', () => {
  assert.equal(formatDuration(0), '0 ミリ秒')
  assert.equal(formatDuration(100), '100 ミリ秒')
  assert.equal(formatDuration(1250), '1.3 秒')
  assert.equal(formatDuration(62000), '1 分 2 秒')
  assert.equal(formatDuration(Number.NaN), '不明')
})
