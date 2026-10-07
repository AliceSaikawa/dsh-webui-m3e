import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatRows, type ToolRow } from '../web/src/features/chat/model.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'
import type { AssistantStream } from '../web/src/dsh/session-journal.ts'

function call(seq: number, turn: number, step: number, path: string, result: string, isError = false) {
  return [
    mockRecord(seq, 'assistant/message', seq * 100, { turn, step, message: { content: [
      { type: 'tool-call', id: 'same-id', name: 'read_file', arguments: JSON.stringify({ path }) },
    ] } }),
    mockRecord(seq + 1, 'tool/call', seq * 100 + 10, { turn, step, callId: 'same-id', name: 'read_file', arguments: JSON.stringify({ path }) }),
    mockRecord(seq + 2, 'tool/result', seq * 100 + step * 50, { turn, step,
      ...(isError ? { error: { code: 'READ_FAILED' } } : {}),
      message: { role: 'tool', toolCallId: 'same-id', content: [{ type: 'text', text: result }], isError },
    }),
  ]
}
const tools = (rows: ReturnType<typeof buildChatRows>) => rows.filter((row): row is ToolRow => row.kind === 'tool')

test('別ターンと同一ターン内の別ステップで再利用されたIDの引数・結果・失敗・時間を分ける', () => {
  const records = [...call(1, 1, 1, 'first.txt', 'FIRST'), ...call(4, 2, 1, 'second.txt', 'SECOND'), ...call(7, 2, 2, 'third.txt', 'THIRD', true)]
  const rows = tools(buildChatRows([...records].reverse()))
  assert.equal(rows.length, 3)
  assert.equal(new Set(rows.map(row => row.callKey)).size, 3)
  assert.deepEqual(rows.map(row => [JSON.parse(row.arguments).path, row.result, row.status, row.durationMs]), [
    ['first.txt', [{ type: 'text', text: 'FIRST' }], 'success', 40],
    ['second.txt', [{ type: 'text', text: 'SECOND' }], 'success', 40],
    ['third.txt', [{ type: 'text', text: 'THIRD' }], 'error', 90],
  ])
  assert.equal(rows[0]?.error, undefined)
  assert.deepEqual(rows[2]?.error, { code: 'READ_FAILED' })
})

test('古い同じIDの結果があっても新しい生成中の呼び出しを表示し、確定後だけ統合する', () => {
  const records = call(1, 1, 1, 'first.txt', 'FIRST')
  const stream: AssistantStream = { attemptId: 'new', turn: 2, step: 1, content: [
    { type: 'tool-call', id: 'same-id', name: 'read_file', arguments: '{"path":"second.txt"}' },
  ] }
  const before = tools(buildChatRows(records, stream))
  assert.equal(before.length, 2)
  assert.equal(before[1]?.status, 'running')
  assert.deepEqual(before[1]?.result, [])
  assert.equal(before[1]?.durationMs, undefined)
  const completed = tools(buildChatRows([...records, ...call(4, 2, 1, 'second.txt', 'SECOND')], stream))
  assert.equal(completed.length, 2)
  const current = completed.find(row => row.callKey === before[1]?.callKey)
  assert.deepEqual(current?.result, [{ type: 'text', text: 'SECOND' }])
})

test('読み込み窓に結果だけがある別ターンを隠さず、開始情報も混ぜない', () => {
  const rows = tools(buildChatRows([...call(1, 1, 1, 'first.txt', 'FIRST'), call(4, 2, 1, 'second.txt', 'SECOND')[2]!]))
  assert.equal(rows.length, 2)
  assert.equal(rows[1]?.name, 'ツール')
  assert.equal(rows[1]?.arguments, '')
  assert.equal(rows[1]?.durationMs, undefined)
  assert.deepEqual(rows[1]?.result, [{ type: 'text', text: 'SECOND' }])
})
