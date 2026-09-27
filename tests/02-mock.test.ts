import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { extendMock } from '../web/src/features/chat/mock.ts'
import { buildChatRows } from '../web/src/features/chat/model.ts'
import { clipToolResult } from '../web/src/features/chat/tool-result.ts'

test('長い会話を2回読み込み、元の共有履歴と表示済みの末尾を保つ', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const binding = ctx.sessions.binding('chat-long')!
    const journal = () => foldSessionWindow(binding.eventSource.getSnapshot())
    const initial = journal().records
    assert.equal(initial.length, 100)
    assert.equal(binding.session.getSnapshot().hasMore, true)
    await binding.session.loadOlder()
    assert.equal(journal().records.length, 200)
    assert.equal(binding.session.getSnapshot().hasMore, true)
    await binding.session.loadOlder()
    assert.equal(journal().records.length, 300)
    assert.equal(binding.session.getSnapshot().hasMore, false)
    assert.deepEqual(journal().records.slice(-100), initial)
    assert.equal(buildChatRows(journal().records).length, 150)
    assert.deepEqual(foldSessionWindow(ctx.sessions.binding('readme-review')!.eventSource.getSnapshot()).records, readmeRecords)
  } finally { ctx.dispose() }
})

test('追加の偽履歴はシステム、注入された指示、ファイル、入れ子と長いツール結果を含む', () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const rows = buildChatRows(foldSessionWindow(ctx.sessions.binding('chat-samples')!.eventSource.getSnapshot()).records)
    assert.deepEqual(rows.map(row => row.kind), ['system', 'context', 'user', 'tool'])
    const result = rows.find(row => row.kind === 'tool')!
    assert.equal(result.status, 'success')
    assert.equal(result.durationMs, 1000)
    assert.equal(clipToolResult(result.result).truncated, true)
  } finally { ctx.dispose() }
})

test('仕様確認の偽履歴に12秒の思考、read_file、失敗bash、成否のコマンドを含む', () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const rows = buildChatRows(foldSessionWindow(ctx.sessions.binding('chat-spec-check')!.eventSource.getSnapshot()).records)
    const reasoning = rows.find(row => row.kind === 'reasoning')
    assert.ok(reasoning?.kind === 'reasoning')
    assert.equal(reasoning.durationMs, 12_000)
    assert.deepEqual(rows.flatMap(row => row.kind === 'tool' ? [[row.name, row.status]] : []), [['read_file', 'success'], ['bash', 'error']])
    assert.deepEqual(rows.flatMap(row => row.kind === 'command' ? [[row.name, row.status, !!row.text]] : []), [['check', 'error', true], ['status', 'success', false]])
  } finally { ctx.dispose() }
})

test('処理エラーと読込エラーのシナリオを既存の公開入口で用意する', () => {
  for (const scenario of ['chat-error', 'open-error']) {
    const ctx = createMockContext({ scenario, extensions: [{ extendMock }] })
    try {
      const id = scenario === 'chat-error' ? 'chat-error' : 'chat-open-error'
      const state = ctx.sessions.binding(id)!.session.getSnapshot()
      if (scenario === 'chat-error') assert.ok(state.lastAgentError)
      else assert.equal(state.openState, 'error')
      assert.ok(ctx.workspaces.list.getSnapshot().items.some(workspace => workspace.sessionIds.includes(id)))
    } finally { ctx.dispose() }
  }
})

test('偽の生成が始まり、途中の本文を表示できる', { timeout: 1000 }, async () => {
  const ctx = createMockContext({ scenario: 'streaming', extensions: [{ extendMock }] })
  try {
    const binding = ctx.sessions.binding('approval-sheet')!
    assert.ok(foldSessionWindow(binding.eventSource.getSnapshot()).stream)
    await new Promise<void>(resolve => {
      const unsubscribe = binding.eventSource.subscribe(() => {
        const stream = foldSessionWindow(binding.eventSource.getSnapshot()).stream
        if (stream?.content.some(block => block.type === 'text' && block.text.length > 0)) { unsubscribe(); resolve() }
      })
    })
    const journal = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.ok(buildChatRows(journal.records, journal.stream).some(row => row.kind === 'assistant' && row.streaming && row.text.length > 0))
  } finally { ctx.dispose() }
})

test('長い会話の偽生成は履歴を2回追加しても過去の返事と重ならず表示できる', { timeout: 1000 }, async () => {
  const ctx = createMockContext({ scenario: 'chat-long-streaming', extensions: [{ extendMock }] })
  try {
    const binding = ctx.sessions.binding('chat-long-streaming')!
    const journal = () => foldSessionWindow(binding.eventSource.getSnapshot())
    assert.equal(journal().records.length, 100)
    await binding.session.loadOlder()
    await binding.session.loadOlder()
    assert.equal(journal().records.length, 300)
    await new Promise<void>(resolve => {
      const stop = binding.eventSource.subscribe(() => {
        if (journal().stream?.content.some(block => block.type === 'text' && block.text)) { stop(); resolve() }
      })
    })
    const { records, stream } = journal()
    assert.equal(stream?.turn, 76)
    const rows = buildChatRows(records, stream)
    assert.ok(rows.some(row => row.kind === 'assistant' && row.streaming && row.text))
    assert.equal(new Set(rows.map(row => row.key)).size, rows.length)
    assert.ok(rows.filter(row => row.kind === 'assistant' && !row.streaming).length >= 74)
    assert.ok(ctx.workspaces.list.getSnapshot().items.find(workspace => workspace.workspaceId === 'ws-chat-check')?.sessionIds.includes('chat-long-streaming'))
  } finally { ctx.dispose() }
})
