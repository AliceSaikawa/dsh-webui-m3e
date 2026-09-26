import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatRows } from '../web/src/features/chat/model.ts'
import type { AssistantStream } from '../web/src/dsh/session-journal.ts'
import type { JsonValue, SessionWireEvent } from '../web/src/dsh/services.ts'

function start(index: number, time: number): JsonValue {
  return { type: 'chunk', time, chunk: { type: 'block-start', index, blockType: 'reasoning' } }
}
function end(index: number, time: number, text = '検討'): JsonValue {
  return { type: 'chunk', time, chunk: { type: 'block-end', index, block: { type: 'reasoning', text } } }
}
function message(stream?: JsonValue, content: JsonValue[] = [{ type: 'reasoning', text: '検討' }]): SessionWireEvent {
  return { seq: 10, time: 60_000, type: 'assistant/message', data: {
    turn: 1, step: 1, message: { content }, ...(stream === undefined ? {} : { stream }),
  } }
}

test('reasoning duration comes from its own recorded boundaries across simultaneous blocks', () => {
  const accepted = message([
    start(0, 1000),
    { type: 'chunk', time: 1500, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
    start(2, 2000),
    { type: 'reasoning-chunks', index: 0, time0: 1500, dt: [100], texts: ['考え', '中'] },
    end(2, 5000, '追加の検討'), end(0, 13_000),
    { type: 'chunk', time: 30_000, chunk: { type: 'block-end', index: 1, block: { type: 'text', text: '本文' } } },
  ], [
    { type: 'reasoning', text: '検討' }, { type: 'text', text: '本文' }, { type: 'reasoning', text: '追加の検討' },
  ])
  const before = JSON.stringify(accepted)
  const rows = buildChatRows([accepted])
  assert.deepEqual(rows.map(row => row.kind === 'reasoning' || row.kind === 'assistant' ? [row.kind, row.durationMs] : []), [
    ['reasoning', 12_000], ['assistant', undefined], ['reasoning', 3000],
  ])
  assert.equal(JSON.stringify(accepted), before)
})

test('reasoning timing follows accepted first-seen order and max-token removal of tool calls', () => {
  const stream: JsonValue[] = [
    { type: 'chunk', time: 500, chunk: { type: 'block-start', index: 7, blockType: 'tool-call' } },
    start(4, 1000), start(2, 2000), end(2, 6000, '追加の検討'), end(4, 13_000),
  ]
  const reasoning = [{ type: 'reasoning', text: '検討' }, { type: 'reasoning', text: '追加の検討' }]
  const complete = buildChatRows([message(stream, [{ type: 'tool-call', id: 'call', name: 'bash', arguments: '{}' }, ...reasoning])])
  assert.deepEqual(complete.flatMap(row => row.kind === 'reasoning' ? [row.durationMs] : []), [12_000, 4000])
  const truncated = buildChatRows([message([...stream,
    { type: 'chunk', time: 13_000, chunk: { type: 'finish', reason: { kind: 'max-tokens' } } },
  ], reasoning)])
  assert.deepEqual(truncated.flatMap(row => row.kind === 'reasoning' ? [row.durationMs] : []), [12_000, 4000])
  const mismatched = buildChatRows([message(stream, reasoning)])
  assert.deepEqual(mismatched.flatMap(row => row.kind === 'reasoning' ? [row.durationMs] : []), [undefined, undefined])
})

test('missing reasoning boundaries remain unknown instead of using message or first-output times', () => {
  for (const recorded of [
    undefined, null, [], [start(0, 1000)], [end(0, 13_000)],
    [{ type: 'reasoning-chunks', index: 0, time0: 1000, dt: [12_000], texts: ['考え', 'ました'] }],
    [{ type: 'chunk', time: 1000, chunk: { type: 'reasoning-delta', index: 0, text: '検討' } }, end(0, 13_000)],
  ]) {
    const rows = buildChatRows([
      { seq: 1, time: 0, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 2, time: 13_000, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [start(0, 1000), end(0, 13_000)] } },
      message(recorded),
    ])
    assert.ok(rows[0]?.kind === 'reasoning')
    assert.equal(rows[0].durationMs, undefined)
  }
})

test('invalid or ambiguous reasoning boundaries do not invent elapsed values', () => {
  for (const recorded of [
    [start(0, 2000), end(0, 1000)],
    [start(0, Number.NaN), end(0, 13_000)],
    [start(0, 1000), end(0, Number.POSITIVE_INFINITY)],
    [start(0, -1000), end(0, 1000)],
    [start(0, 1000), start(0, 2000), end(0, 13_000)],
    [start(0, 1000), end(0, 13_000), end(0, 14_000)],
    [end(0, 13_000), start(0, 1000)],
    [start(0, 1000), { type: 'chunk', time: 5000, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '本文' } } }],
  ]) {
    const row = buildChatRows([message(recorded)])[0]
    assert.ok(row?.kind === 'reasoning')
    assert.equal(row.durationMs, undefined)
  }
  const zero = buildChatRows([message([start(0, 1000), end(0, 1000)])])[0]
  assert.ok(zero?.kind === 'reasoning')
  assert.equal(zero.durationMs, 0)
})

test('live reasoning without recorded times gains its duration only at durable settlement', () => {
  const stream: AssistantStream = { attemptId: 'attempt', turn: 1, step: 1, content: [], chunks: [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '検討' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '検討' } },
  ] }
  const before = buildChatRows([], stream)[0]
  assert.ok(before?.kind === 'reasoning')
  assert.equal(before.durationMs, undefined)
  const after = buildChatRows([message([start(0, 1000), end(0, 13_000)])], stream)[0]
  assert.ok(after?.kind === 'reasoning')
  assert.equal(after.key, before.key)
  assert.equal(after.durationMs, 12_000)
})
