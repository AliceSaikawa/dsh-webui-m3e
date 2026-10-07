import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { buildChatRows } from '../web/src/features/chat/model.ts'
import { createSessionJournal, foldSessionWindow, streamBlocksOf, type AssistantStream } from '../web/src/dsh/session-journal.ts'
import { observable } from '../web/src/dsh/mock/observable.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'
import type { ContentBlock, JsonValue, SessionEventLikeEntry, SessionEventWindow, SessionWireEvent, StreamChunk } from '../web/src/dsh/services.ts'

const stream = (chunks: StreamChunk[]): AssistantStream => ({ attemptId: 'attempt', turn: 1, step: 1, content: [], chunks })
const recordedStream = (chunks: StreamChunk[]): JsonValue => chunks.map((chunk, index) => ({ type: 'chunk', time: 100 + index * 10, chunk })) as unknown as JsonValue
function accepted(content: ContentBlock[], history: JsonValue = [], extra: Record<string, JsonValue> = {}): SessionWireEvent {
  return mockRecord(2, 'assistant/message', 200, { turn: 1, step: 1, stream: history, message: { role: 'assistant', content }, ...extra } as JsonValue)
}
function liveEntries(chunks: StreamChunk[]): SessionEventLikeEntry[] {
  return chunks.map((chunk, index) => ({ type: 'transient', event: {
    type: 'assistant/live-chunk', seq: 1 + (index + 1) / (index + 2), time: 100 + index * 10,
    data: { attemptId: 'attempt', turn: 1, step: 1, chunk },
  } }))
}
const windowOf = (entries: SessionEventLikeEntry[], revision = 1): SessionEventWindow => ({ entries, revision, hasMore: false, change: { kind: 'replace', entries } })

test('疎な番号の返事は確定直後からstep/endまで一つだけになり、描画キーも変わらない', () => {
  const content: ContentBlock[] = [{ type: 'text', text: '確定した返事' }]
  const chunks: StreamChunk[] = [{ type: 'text-delta', index: 3, text: '確定した返事' }]
  const before = buildChatRows([], stream(chunks))
  const event = accepted(content, recordedStream(chunks))
  const during = foldSessionWindow(windowOf([...liveEntries(chunks), { type: 'event', event }]))
  assert.notEqual(during.stream, null, 'controllerがstep/endまで残した生成中の断片を再現')
  const rows = buildChatRows(during.records, during.stream)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.key, before[0]?.key)
  assert.deepEqual(rows, buildChatRows([event, mockRecord(3, 'step/end', 210, { turn: 1, step: 1 })]))
})

test('4→2の順で受けた同種ブロックは確定の前後で順番・元番号・所要時間を維持する', () => {
  const content: ContentBlock[] = [{ type: 'reasoning', text: '最初の検討' }, { type: 'reasoning', text: '次の検討' }]
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 4, blockType: 'reasoning' },
    { type: 'block-end', index: 4, block: content[0]! },
    { type: 'block-start', index: 2, blockType: 'reasoning' },
    { type: 'block-end', index: 2, block: content[1]! },
  ]
  const before = buildChatRows([], stream(chunks))
  const after = buildChatRows([accepted(content, recordedStream(chunks))], stream(chunks))
  assert.deepEqual(before.map(row => row.key), ['assistant:1:1:4', 'assistant:1:1:2'])
  assert.deepEqual(after.map(row => row.key), before.map(row => row.key))
  assert.deepEqual(after.map(row => row.kind === 'reasoning' ? [row.text, row.durationMs] : null), [
    ['最初の検討', 10], ['次の検討', 10],
  ])
})

test('圧縮された記録の元番号も保持し、別ステップの生成は隠さない', () => {
  const event = accepted([{ type: 'reasoning', text: '検討' }, { type: 'text', text: '本文' }], [
    { type: 'reasoning-chunks', index: 4, time0: 100, dt: [], texts: ['検討'] },
    { type: 'text-chunks', index: 2, time0: 110, dt: [], texts: ['本文'] },
  ])
  const live = { ...stream([{ type: 'text-delta', index: 8, text: '続き' }]), step: 2 }
  assert.deepEqual(buildChatRows([event], live).map(row => row.key), ['assistant:1:1:4', 'assistant:1:1:2', 'assistant:1:2:8'])
})

test('空の確定や最大トークンで除いたツールを生成中の断片から復活させない', () => {
  const chunks: StreamChunk[] = [
    { type: 'tool-call-delta', index: 3, id: 'truncated', name: 'read_file', argumentsDelta: '{}' },
    { type: 'text-delta', index: 7, text: '途中の本文' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
  assert.deepEqual(buildChatRows([accepted([])], stream(chunks)), [])
  const rows = buildChatRows([accepted([{ type: 'text', text: '途中の本文' }], recordedStream(chunks))], stream(chunks))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.key, 'assistant:1:1:7')
})

test('採用されない試行や置換用の記録は現在の生成を隠さない', () => {
  const live = stream([{ type: 'text-delta', index: 3, text: '現在の返事' }])
  const event = accepted([{ type: 'text', text: '残さない内容' }])
  for (const excluded of [{ ...event, type: 'assistant/attempt' }, { ...event, ignorable: true as const }, { ...event, surfaceOp: 'replace' as const }]) {
    assert.deepEqual(buildChatRows([excluded], live), buildChatRows([], live))
  }
})

test('増分更新と再接続の両方で、開始済みツールの後着デルタを元の位置に置く', () => {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 5, blockType: 'tool-call' },
    { type: 'text-delta', index: 2, text: '本文' },
    { type: 'tool-call-delta', index: 5, id: 'call', name: 'read_file', argumentsDelta: '{}' },
  ]
  const entries = liveEntries(chunks)
  const source = observable(windowOf(entries.slice(0, 2)))
  const journal = createSessionJournal(source)
  journal.getSnapshot()
  source.set({ ...windowOf(entries, 2), change: { kind: 'append', entries: [entries[2]!] } })
  const incremental = journal.getSnapshot().stream
  assert.deepEqual(incremental?.blocks?.map(value => value.index), [5, 2])
  source.set(windowOf(entries, 3))
  assert.deepEqual(journal.getSnapshot().stream, incremental)
})

const nativeRoot = ['../tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/',
  '../../dsh-webui-m3e/tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/']
  .map(path => new URL(path, import.meta.url))
  .find(root => existsSync(new URL('dsh-llm/lib/types/assembler.js', root)))

test('DSH rc.2 の BlockAssembler と生成中・確定後の順序が一致する', {
  skip: nativeRoot ? false : 'DSH 0.2.0-rc.2 の公開配布コードが未配置',
}, async () => {
  const { BlockAssembler } = await import(new URL('dsh-llm/lib/types/assembler.js', nativeRoot).href)
  const assembler = new BlockAssembler()
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 4, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 4, text: '最初の検討' },
    { type: 'reasoning-delta', index: 2, text: '次の検討' },
    { type: 'text-delta', index: 9, text: '本文' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  for (const chunk of chunks) assembler.push(chunk)
  assert.deepEqual(streamBlocksOf(stream(chunks)).map(value => value.block), assembler.blocks())
  const before = buildChatRows([], stream(chunks))
  const after = buildChatRows([accepted(assembler.blocks(), recordedStream(chunks))], stream(chunks))
  assert.deepEqual(after.map(row => row.key), before.map(row => row.key))
  assert.equal(after.length, 3)
})
