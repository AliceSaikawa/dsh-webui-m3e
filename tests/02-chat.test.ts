import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendLiveRows, buildChatRows, buildSettledChat, commandPresentation, formatDuration, formatToolArguments, getStreamBlocks,
  isNearBottom, preservePrependScroll, summarizeToolArguments, toolIcon,
} from '../web/src/features/chat/model.ts'
import type { AssistantStream, StreamBlock } from '../web/src/dsh/session-journal.ts'
import type { JsonValue, PendingSubmission, SessionWireEvent, StreamChunk } from '../web/src/dsh/services.ts'
import { readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'

function event(seq: number, type: string, data: JsonValue, time = seq * 100): SessionWireEvent {
  return mockRecord(seq, type, time, data)
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
    event(6, 'system/message', { message: { content: [{ type: 'text', text: '処理を再開しました' }] } }),
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

test('replacement summaries never enter chat rows, tool result matching, or call metadata', () => {
  const replace = (value: SessionWireEvent): SessionWireEvent => ({ ...value, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } })
  const records = [
    { ...event(1, 'user/message', { content: [{ type: 'text', text: '元の質問' }] }), surfaceOp: 'append' },
    event(2, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'complete', name: 'read_file', arguments: '{}' }, { type: 'tool-call', id: 'running', name: 'bash', arguments: '{}' }] } }),
    replace(event(3, 'user/message', { content: [{ type: 'text', text: 'モデル用の要約' }] })),
    replace(event(4, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '置換された検討' }, { type: 'tool-call', id: 'orphan', name: '表示しない名前', arguments: '{}' }] } })),
    event(5, 'tool/result', { message: { role: 'tool', toolCallId: 'complete', content: [{ type: 'text', text: '元の結果' }] } }),
    replace(event(6, 'tool/result', { message: { role: 'tool', toolCallId: 'complete', content: [{ type: 'text', text: '結果の要約' }], isError: true } })),
    replace(event(7, 'tool/result', { message: { role: 'tool', toolCallId: 'running', content: [{ type: 'text', text: '完了させない' }] } })),
    replace(event(8, 'tool/result', { message: { role: 'tool', toolCallId: 'invisible', content: [{ type: 'text', text: '追加しない結果' }] } })),
    replace(event(9, 'tool/call', { callId: 'orphan', name: '使わない呼出情報' })),
    event(10, 'tool/result', { message: { role: 'tool', toolCallId: 'orphan', content: [{ type: 'text', text: '残す孤立結果' }] } }),
  ]
  const rows = buildChatRows(records)
  assert.deepEqual(rows.map(row => row.kind), ['user', 'tool', 'tool', 'tool'])
  assert.ok(rows[0]?.kind === 'user')
  assert.equal(rows[0].text, '元の質問')
  const tools = rows.filter(row => row.kind === 'tool')
  assert.deepEqual(tools.map(row => [row.callId, row.status]), [['complete', 'success'], ['running', 'running'], ['orphan', 'success']])
  assert.deepEqual(tools[0]?.result, [{ type: 'text', text: '元の結果' }])
  assert.equal(tools[2]?.name, 'ツール')
  assert.equal(tools[2]?.durationMs, undefined)
})

test('string replacement operations are excluded just like object replacement operations', () => {
  const call = event(1, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'call', name: 'bash', arguments: '{}' }] } })
  const replaced = [
    event(2, 'user/message', { content: [{ type: 'text', text: 'モデル用の要約' }] }),
    event(3, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '置換された検討' }] } }),
    event(4, 'system/message', { message: { content: [{ type: 'text', text: '置換された通知' }] } }),
    event(5, 'tool/result', { message: { role: 'tool', toolCallId: 'call', content: [{ type: 'text', text: '置換された結果' }] } }),
  ]
  for (const surfaceOp of ['replace', { op: 'replace', startSeq: 1, endSeq: 2 }] as const) {
    const rows = buildChatRows([call, ...replaced.map(record => ({ ...record, surfaceOp }))])
    assert.equal(rows.length, 1)
    assert.ok(rows[0]?.kind === 'tool')
    assert.equal(rows[0].status, 'running')
    assert.deepEqual(rows[0].result, [])
  }
})

test('tool calls are matched by callId across interleaved records and keep the assistant fork point', () => {
  const records = [
    event(8, 'tool/result', { message: { role: 'tool', source: { kind: 'tool', callId: 'b' }, toolCallId: 'b', content: [{ type: 'text', text: 'B の結果' }], isError: true } }, 2500),
    event(1, 'assistant/message', { message: { content: [{ type: 'tool-call', id: 'a', name: 'read_file', arguments: '{"path":"a.txt"}' }, { type: 'tool-call', id: 'b', name: 'bash', arguments: '{"command":"pnpm test"}' }] } }),
    event(2, 'tool/call', { callId: 'a', name: 'read_file' }, 1000),
    event(3, 'tool/call', { callId: 'b', name: 'bash' }, 1100),
    event(9, 'tool/result', { message: { role: 'tool', source: { kind: 'tool', callId: 'a' }, toolCallId: 'a', content: [{ type: 'text', text: 'A の結果' }] }, meta: { durationMs: 99999 } }, 3000),
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
    event(2, 'tool/result', { message: { role: 'tool', toolCallId: 'orphan', content: [{ type: 'text', text: '結果だけ' }], isError: true }, error: { code: 'FAILED' } }),
    event(3, 'tool/result', { message: { role: 'tool', toolCallId: 'without-start', content: [{ type: 'text', text: '完了' }] } }),
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
    { ...event(2, 'tool/result', { message: { role: 'tool', toolCallId: 'a', content: [] } }), ignorable: true },
    event(3, 'tool/call', { callId: 'b' }, 1000),
    event(4, 'tool/result', { message: { role: 'tool', toolCallId: 'b', content: [] } }, 900),
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

test('command outcomes retain success, failure, and unknown states with Japanese presentation', () => {
  const rows = buildChatRows([
    event(1, 'command/run', { name: 'permission', commandId: 'known-command' }),
    event(2, 'command/done', { commandId: 'known-command', kind: 'success', text: '変更しました' }),
    event(3, 'command/done', { commandId: 'known-command', kind: 'error', text: '設定を変更できませんでした。' }),
    event(4, 'command/done', { kind: 'error', text: '   ' }),
    event(5, 'command/done', { kind: 'future-outcome', text: '結果' }),
    event(6, 'command/done', {}),
  ])
  const commands = rows.filter(row => row.kind === 'command')
  assert.deepEqual(commands.map(row => row.status), ['success', 'error', 'error', 'unknown', 'unknown'])
  assert.deepEqual(commands.map(commandPresentation), [
    { label: '/permission を実行しました', icon: 'terminal' },
    { label: '/permission の実行に失敗しました', icon: 'error', failureReason: '設定を変更できませんでした。' },
    { label: 'コマンドの実行に失敗しました', icon: 'error', failureReason: '詳しい理由は記録されていません。' },
    { label: 'コマンドの結果を受け取りました', icon: 'info' },
    { label: 'コマンドの結果を受け取りました', icon: 'info' },
  ])
})

test('tool identity uses the file icon only for read_file and keeps a terminal fallback', () => {
  assert.equal(toolIcon('read_file'), 'description')
  assert.equal(toolIcon('bash'), 'terminal')
  assert.equal(toolIcon('new_tool'), 'terminal')
  assert.equal(toolIcon(''), 'terminal')
})

test('system messages read the installed message payload and preserve structured text content', () => {
  const rows = buildChatRows([
    event(1, 'system/message', { message: { content: [{ type: 'text', text: '処理を再開しました' }] } }),
    event(2, 'system/message', { message: { content: [{ type: 'text', text: '最初の行' }, { type: 'text', text: '次の行' }] } }),
    event(3, 'system/message', { message: { content: [{ type: 'text', text: '以前の偽データ' }] } }),
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
  assert.equal(command.status, 'success')
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
  assert.deepEqual(before.map(row => [row.key, row.kind]), [['assistant:1:1:2', 'assistant'], ['assistant:1:1:0', 'reasoning'], ['assistant:1:1:1', 'tool']])
  const complete = stream([
    ...first,
    { type: 'reasoning-delta', index: 0, text: '中' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', argumentsDelta: '"README.md"}' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '確定した検討' } },
    { type: 'reasoning-delta', index: 0, text: '追加しない' },
    { type: 'block-end', index: 2, block: { type: 'text', text: '確定した返事' } },
  ])
  const blocks = getStreamBlocks(complete)
  assert.deepEqual(blocks.map(value => [value.index, value.complete]), [[2, true], [0, true], [1, false]])
  const rows = buildChatRows([], complete)
  assert.deepEqual(rows.map(row => row.kind === 'tool' ? [row.arguments, row.status] : row.kind === 'reasoning' || row.kind === 'assistant' ? [row.text, row.streaming] : []), [['確定した返事', false], ['確定した検討', false], ['{"path":"README.md"}', 'running']])
  assert.deepEqual(rows.map(row => row.key), before.map(row => row.key))
  assert.equal((before[1] as { text: string }).text, '検討')
})

test('folded stream content is not added again and reconnect replaces previous transient text', () => {
  const value = stream([{ type: 'text-delta', index: 3, text: '現在の返事' }])
  const baseline: AssistantStream = { ...value, content: [{ type: 'text', text: '現在の返事' }] }
  const first = buildChatRows([], baseline)
  assert.ok(first[0]?.kind === 'assistant')
  assert.equal(first[0].text, '現在の返事')
  assert.equal(first[0].key, 'assistant:1:1:3')
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

test('settlement preserves keys for the same reasoning, tool, and text blocks without duplicate live rows', () => {
  const live = stream([
    { type: 'reasoning-delta', index: 0, text: '検討中' },
    { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'read_file', argumentsDelta: '{}' },
    { type: 'text-delta', index: 2, text: '本文' },
  ])
  const before = buildChatRows([], live)
  const accepted = event(9, 'assistant/message', {
    turn: 1, step: 1, message: { content: [
      { type: 'reasoning', text: '確定した検討' },
      { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{}' },
      { type: 'text', text: '確定した本文' },
    ] },
  })
  const attempt = event(8, 'assistant/attempt', { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: '採用されない試行' }] } })
  const settled = buildChatRows([attempt, accepted])
  assert.deepEqual(settled.map(row => row.key), before.map(row => row.key))
  assert.deepEqual(settled.map(row => row.kind), ['reasoning', 'tool', 'assistant'])
  assert.ok(before[0]?.kind === 'reasoning' && settled[0]?.kind === 'reasoning')
  assert.equal(before[0].streaming, true)
  assert.equal(settled[0].streaming, false)
  assert.equal(settled[0].seq, 9)
  assert.equal(settled[0].text, '確定した検討')
  assert.deepEqual(buildChatRows([attempt, accepted], live), settled)
})

test('assistant identities distinguish turns, steps, original block indices, and seq fallbacks', () => {
  const rows = buildChatRows([
    event(1, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: '一番目' }, { type: 'text', text: '本文' }] } }),
    event(2, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'reasoning', text: '次の段階' }] } }),
    event(3, 'assistant/message', { turn: 2, step: 1, message: { content: [{ type: 'reasoning', text: '次のターン' }] } }),
    event(4, 'assistant/message', { turn: 2, step: 2, message: { content: [null, { type: 'reasoning', text: '元の番号を保つ' }] } }),
    event(5, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '番号情報なし' }] } }),
    event(6, 'assistant/message', { turn: 2, step: -1, message: { content: [{ type: 'reasoning', text: '無効な番号情報' }] } }),
  ])
  assert.deepEqual(rows.map(row => row.key), ['assistant:1:1:0', 'assistant:1:1:1', 'assistant:1:2:0', 'assistant:2:1:0', 'assistant:2:2:1', 'event:5:0', 'event:6:0'])
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length)
})

test('malformed message JSON is skipped while unsupported result blocks keep their type labels', () => {
  const rows = buildChatRows([
    event(1, 'assistant/message', null),
    event(2, 'system/message', []),
    event(3, 'assistant/message', { message: { content: [null, { type: 'text', text: 42 }, { type: 'tool-call' }] } }),
    event(4, 'tool/result', { message: { role: 'tool', toolCallId: 'opaque', content: [{ type: 'plugin:audio', data: 'opaque' }] } }),
  ])
  assert.equal(rows.length, 1)
  assert.ok(rows[0]?.kind === 'tool')
  assert.deepEqual(rows[0].result, [{ type: 'unsupported', originalType: 'plugin:audio' }])
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

test('live rows reuse settled rows and unchanged stream blocks by identity', () => {
  const records = [event(1, 'user/message', { content: [{ type: 'text', text: '質問' }] })]
  const settled = buildSettledChat(records)
  const done: StreamBlock = { index: 0, block: { type: 'reasoning', text: '考えた' }, complete: true }
  const live = (text: string): AssistantStream => ({ attemptId: 'a', turn: 1, step: 1, content: [], blocks: [done, { index: 1, block: { type: 'text', text }, complete: false }] })
  const first = appendLiveRows(settled, live('返'))
  const second = appendLiveRows(settled, live('返事'))
  assert.equal(second[0], settled.rows[0])
  assert.equal(second[0], first[0])
  assert.equal(second[1], first[1], 'the completed reasoning row is not rebuilt')
  assert.notEqual(second[2], first[2])
  assert.deepEqual(second.map(row => row.kind === 'assistant' || row.kind === 'reasoning' ? [row.text, row.streaming] : row.kind), ['user', ['考えた', false], ['返事', true]])
  assert.deepEqual(second, buildChatRows(records, live('返事')))
})

test('context that DSH injects as a user message is not shown as the user speaking', () => {
  const records: SessionWireEvent[] = [
    event(1, 'system/message', { message: { role: 'system', content: [{ type: 'text', text: 'システムの指示' }] } }),
    event(2, 'user/message', { source: { kind: 'agent-instructions', changes: [{ path: '~/.dsh/AGENTS.md' }, { path: 'AGENTS.md' }] }, content: [{ type: 'text', text: '<system-reminder>指示</system-reminder>' }] }),
    event(3, 'user/message', { source: { kind: 'session-reference', references: [{ label: '前の会話' }] }, content: [{ type: 'text', text: '参照した内容' }] }),
    event(4, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '本人の質問' }] }),
    event(5, 'user/message', { source: { kind: 'plugin:capture' }, content: [{ type: 'file', attachment: { attachmentId: 'injected-file', name: '注入.txt', bytes: 10 } }] }),
  ]
  const rows = buildChatRows(records)
  assert.deepEqual(rows.map(row => row.kind), ['system', 'context', 'context', 'user', 'context'])
  const [, instructions, recall, user, attachmentOnly] = rows
  assert.ok(instructions?.kind === 'context' && recall?.kind === 'context')
  assert.deepEqual([instructions.role, instructions.label, instructions.text], ['inject', '~/.dsh/AGENTS.md, AGENTS.md', '<system-reminder>指示</system-reminder>'])
  assert.deepEqual([recall.role, recall.label], ['recall', '前の会話'])
  assert.equal(user?.kind === 'user' && user.text, '本人の質問')
  // Injected attachments stay reachable when the row is expanded.
  assert.ok(attachmentOnly?.kind === 'context')
  assert.deepEqual([attachmentOnly.label, attachmentOnly.content.map(block => block.type)], ['capture', ['file']])
})
