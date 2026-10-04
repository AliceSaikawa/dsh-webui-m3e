import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContentBlock, JsonValue, SessionWireEvent, StreamChunk } from '../web/src/dsh/services.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'
import { buildChatRows, getStreamBlocks } from '../web/src/features/chat/model.ts'
import { buildTrace, contentText, turnHeading } from '../web/src/features/trace/model.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock as chatMock } from '../web/src/features/chat/mock.ts'
import { extendMock as traceMock } from '../web/src/features/trace/mock.ts'

const text = (text: string) => ({ type: 'text', text })
const record = (seq: number, type: string, data: SessionWireEvent['data']) => mockRecord(seq, type, seq * 100, data)

test('V4の出どころは従来の名前と日本語の文脈表示を保つ', () => {
  const sources: Record<string, JsonValue>[] = [
    { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'approval:policy', text: '文脈' }] }, { kind: 'system-prompt' }, { kind: 'compact-checkpoint' },
    { kind: 'compact-basic' }, { kind: 'plugin:検証用プラグイン' },
    { kind: 'skill-invocation', name: '確認スキル' }, { kind: 'ptc-mode' },
    { kind: 'future-producer' }, { kind: '__proto__' },
  ]
  const rows = buildChatRows(sources.map((source, index) => record(index, 'user/message', { source, content: [text('文脈')] })))
  assert.deepEqual(rows.map(row => row.kind === 'context' ? [row.role, row.label] : row.kind), [
    ['inject', '@deepseek-ai/dsh-system-prompt'], ['inject', '@deepseek-ai/dsh-system-prompt'],
    ['inject', 'compact'], ['inject', 'dsh-compaction-basic'], ['inject', '検証用プラグイン'],
    ['inject', '確認スキル'], ['inject', 'ptc-mode'], ['inject', 'future-producer'], ['inject', '__proto__'],
  ])
  const missing = buildChatRows([{ seq: 99, time: 99, type: 'user/message', data: { content: [text('出どころなし')] } }])
  assert.equal(missing[0]?.kind, 'context')
})

test('V4 developer/messageとforkedは表示を増やさずターンを閉じる', () => {
  const events = [
    record(0, 'turn/start', { turn: 1 }),
    record(1, 'step/start', { turn: 1, step: 1 }),
    record(2, 'user/message', { content: [text('自分の質問')] }),
    record(3, 'developer/message', { turn: 1, step: 1, headerSeq: 1, message: {
      source: { kind: 'tool-cordis' }, content: [{ type: 'tool-addition', toolName: 'read_file' }, { type: 'tool-removal', toolName: 'bash' }],
    } }),
    record(4, 'assistant/message', { turn: 1, step: 1, message: { content: [text('返事')] } }),
    record(5, 'turn/end', { turn: 1, reason: { kind: 'forked' } }),
  ]
  assert.deepEqual(buildChatRows(events).map(row => row.kind), ['user', 'assistant'])
  const turns = buildTrace(events, null, true)
  assert.deepEqual(turns[0]!.rows.map(row => row.kind), ['user', 'assistant'])
  assert.equal(turns[0]!.running, false)
  assert.equal(turns[0]!.completedAt, 500)
  assert.equal(turns[0]!.termination, undefined)
  assert.equal(turns[0]!.rows[1]!.failed, false)
  assert.equal(turnHeading(turns[0]!), 'ターン 1 ・ 合計 500 ミリ秒 ・ トークン未記録')
})

test('plugin接頭辞の未知イベントは本文を持ってもユーザー行にならない', () => {
  const unknown = record(0, 'plugin:acme/event', { role: 'user', source: { kind: 'user' }, content: [text('表示しない')] })
  for (const event of [unknown, { ...unknown, ignorable: true as const }]) {
    assert.deepEqual(buildChatRows([event]), [])
    assert.deepEqual(buildTrace([event]), [])
  }
})

test('V4の未知ブロックはopaqueなまま既存の非対応表示へ渡す', () => {
  const block = { type: 'plugin:acme/widget', content: [text('実行も展開もしない')], payload: { value: 1 } }
  const events = [
    record(0, 'tool/call', { turn: 1, callId: 'opaque', name: 'read_file', arguments: '{}' }),
    record(1, 'tool/result', { turn: 1, message: { role: 'tool', toolCallId: 'opaque', content: [block] } }),
  ]
  const before = structuredClone(events)
  const chat = buildChatRows(events)
  assert.equal(chat.length, 1)
  assert.ok(chat[0]?.kind === 'tool')
  assert.deepEqual(chat[0].result, [{ type: 'unsupported', originalType: block.type }])
  const trace = buildTrace(events)[0]!.rows
  assert.equal(trace.length, 1)
  assert.deepEqual(trace[0]!.content, [block])
  assert.equal(contentText(trace[0]!.content), '')
  assert.deepEqual(events, before)
})

test('V4のblockTypeとblock-endはツール増減とplugin拡張を安全に保持する', () => {
  const content: ContentBlock[] = [{ type: 'tool-addition', toolName: 'read_file' }, { type: 'tool-removal', toolName: 'bash' }, { type: 'plugin:acme/widget', payload: 'opaque' }]
  const chunks: StreamChunk[] = content.flatMap((block, index): StreamChunk[] => [
    { type: 'block-start', index, blockType: block.type }, { type: 'block-end', index, block },
  ])
  const stream = { attemptId: 'v4', turn: 1, step: 1, content: [], chunks }
  assert.deepEqual(getStreamBlocks(stream).map(entry => entry.block), content)
  assert.deepEqual(buildChatRows([], stream), [])
  assert.equal(buildTrace([], stream, true)[0]!.rows[0]!.kind, 'assistant')
})

test('V4ツール結果の失敗と拡張フィールドを入力の見出しごと保持する', () => {
  // isError alone must mark failure, even when the adapter supplies no data.error.
  for (const error of [undefined, { name: 'Error', code: 'EXIT_1', reason: 'adapter-detail' }]) {
    const events = [
      record(0, 'turn/start', { turn: 1 }),
      record(1, 'tool/call', { turn: 1, step: 1, callId: 'failed', name: 'bash', arguments: '{}' }),
      record(2, 'tool/result', { turn: 1, step: 1, ...(error ? { error } : {}), message: {
        role: 'tool', toolCallId: 'failed', content: [text('結果本文')], isError: true,
        'plugin:result:content': '本文を置き換えない', 'plugin:message:isError': false,
      } }),
      record(3, 'assistant/message', { turn: 1, step: 2, message: { content: [text('返事')] } }),
    ]
    const chat = buildChatRows(events)[0]!
    assert.ok(chat.kind === 'tool')
    assert.equal(chat.status, 'error', error ? 'data.error もある失敗' : 'isError だけの失敗')
    assert.deepEqual(chat.result, [text('結果本文')])
    const rows = buildTrace(events)[0]!.rows
    assert.equal(rows[0]!.failed, true, error ? 'data.error もある失敗' : 'isError だけの失敗')
    assert.deepEqual(rows[1]!.input, [{ type: 'tool-output', toolCallId: 'failed', content: [text('結果本文')], isError: true }])
  }
})

test('共有・チャット・トレースの偽記録はV4であり旧tool-resultを含まない', () => {
  const ctx = createMockContext({ extensions: [{ extendMock: chatMock }, { extendMock: traceMock }] })
  try {
    let count = 0
    for (const id of ctx.sessions.list.getSnapshot().ids) {
      const reference = ctx.sessions.retain(id, { source: 'm3e.test' })
      for (const event of foldSessionWindow(reference.binding.eventSource.getSnapshot()).records) {
        if (event.type !== 'tool/result') continue
        count++
        const message = (event.data as { message: { id: string; role: string; source: { kind: string; callId: string }; toolCallId: string; content: { type: string }[] } }).message
        assert.ok(message.id)
        assert.equal(message.role, 'tool')
        assert.deepEqual(message.source, { kind: 'tool', callId: message.toolCallId })
        assert.ok(message.toolCallId)
        assert.ok(message.content.every(block => block.type !== 'tool-result'), 'V4には結果の包みはない')
      }
      reference.release()
    }
    assert.ok(count > 10)
  } finally { ctx.dispose() }
})
