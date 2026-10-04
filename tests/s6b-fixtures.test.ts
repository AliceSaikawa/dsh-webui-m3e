import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { SessionWireEvent } from '../web/src/dsh/services.ts'
import * as chat from '../web/src/features/chat/mock.ts'
import * as composer from '../web/src/features/composer/mock.ts'
import * as home from '../web/src/features/home/mock.ts'
import * as inbox from '../web/src/features/inbox/mock.ts'
import * as interactions from '../web/src/features/interactions/mock.ts'
import * as search from '../web/src/features/search/mock.ts'
import * as sessionTools from '../web/src/features/session-tools/mock.ts'
import * as trace from '../web/src/features/trace/mock.ts'
import { traceExampleRecords, traceRetryCancelledRecords } from '../web/src/features/trace/trace-fixtures.ts'
import { buildChatRows } from '../web/src/features/chat/model.ts'
import { selectTrace, turnHeading } from '../web/src/features/trace/model.ts'
import { approvalRecords } from '../web/src/dsh/mock/fixtures.ts'

// Inspect whole Host histories, not the 100-record Client window. The deliberately
// broken parser inputs in older unit tests are not normal fixture histories.
function histories() {
  const rows: { id: string; running: boolean; records: readonly SessionWireEvent[] }[] = []
  for (const scenario of [undefined, 'chat-injected-context', 'chat-error', 'open-error', 'chat-long-streaming', 'inbox', 'search-more', 'question-continued']) {
    const ctx = createMockContext({ scenario, extensions: [chat, composer, home, inbox, interactions, search, sessionTools, trace] })
    try {
      const baseIds = ['readme-review', 'approval-sheet', 'chat-long', 'chat-samples', 'chat-spec-check',
        'home-mobile-layout', 'home-workspace-question', 'home-review-child', 'home-list-menu', 'home-harness-tests',
        '05-db-choice', '05-auth-redesign', 'search-permissions', 'search-mobile', 'search-history', 'search-colors',
        'session-tools-review', 'session-tools-tests', 'trace-example', 'trace-failure-example']
      const extra = scenario === 'inbox' ? ['inbox-approval', 'inbox-question', 'inbox-plan', 'inbox-completed', 'inbox-other-completed']
        : scenario === 'search-more' ? Array.from({ length: 24 }, (_, i) => `search-example-${i + 1}`)
        : scenario === 'open-error' ? ['chat-open-error']
        : scenario?.startsWith('chat-') ? [scenario] : []
      assert.deepEqual(Object.keys(ctx.sessions.list.getSnapshot().byId).sort(), [...baseIds, ...extra].sort(), `${scenario ?? 'default'}: fixture initialization must not lose sessions`)
      for (const summary of Object.values(ctx.sessions.list.getSnapshot().byId)) rows.push({
        id: `${scenario ?? 'default'}/${summary.id}`, running: summary.running, records: ctx.mock.getRecords(summary.id),
      })
    } finally { ctx.dispose() }
  }
  rows.push({ id: 'cancelled-retry', running: false, records: traceRetryCancelledRecords })
  assert.equal(rows.length, 194)
  assert.deepEqual(rows.filter(row => row.records.length === 0).map(row => row.id), [
    'open-error/chat-open-error', 'inbox/inbox-approval', 'inbox/inbox-question', 'inbox/inbox-plan', 'inbox/inbox-completed', 'inbox/inbox-other-completed',
  ])
  return rows
}

type Data = Record<string, any>
const dataOf = (event: SessionWireEvent) => event.data as Data

test('S6B 全履歴fixtureのseqは0から密で単調、必須の時刻も整数', () => {
  for (const { id, records } of histories()) for (const [seq, event] of records.entries()) {
    assert.equal(event.seq, seq, `${id}: ${event.type}`)
    assert.ok(Number.isSafeInteger(event.time), id)
  }
})

test('S6B 全履歴fixtureのV4必須フィールドとproducerの語彙を保つ', () => {
  for (const { id, records } of histories()) {
    const ids = new Set<string>()
    for (const event of records) {
      const data = dataOf(event)
      if (['system/message', 'developer/message', 'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result'].includes(event.type)) {
        assert.ok(Number.isSafeInteger(data.turn) && data.turn > 0, `${id}: ${event.type} turn`)
        assert.ok(Number.isSafeInteger(data.step) && data.step > 0, `${id}: ${event.type} step`)
      }
      if (event.type === 'assistant/message' || event.type === 'assistant/attempt') assert.ok(Array.isArray(data.stream), `${id}: stream`)
      if (event.type === 'tool/call') assert.equal(typeof data.arguments, 'string', `${id}: arguments`)
      const role = ({ 'user/message': 'user', 'system/message': 'system', 'assistant/message': 'assistant', 'tool/result': 'tool', 'developer/message': 'developer' } as Record<string, string>)[event.type]
      if (!role) continue
      const message = role === 'user' ? data : data.message
      assert.equal(message.role, role, id)
      assert.equal(typeof message.id, 'string', id)
      assert.ok(message.id.length > 0 && !ids.has(message.id), `${id}: ${message.id}`)
      ids.add(message.id)
      assert.ok(Array.isArray(message.content), id)
      assert.equal(typeof message.source?.kind, 'string', id)
      assert.ok(message.source.kind.length > 0, id)
      // User/developer producers are extensible; the other roles are closed.
      if (role === 'system') assert.equal(message.source.kind, 'system-prompt', id)
      if (role === 'assistant') assert.equal(message.source.kind, 'model', id)
      if (role === 'tool') assert.equal(message.source.kind, 'tool', id)
      for (const block of message.content) assert.notEqual(block.type, 'tool-result', `${id}: obsolete tool-result block`)
      assert.ok(event.surfaceOp, id)
      if (role === 'assistant') for (const field of ['provider', 'model']) { assert.equal(typeof message.source[field], 'string', id); assert.ok(message.source[field].length > 0, id) }
      if (role === 'tool') { assert.equal(message.source.callId, message.toolCallId, id); assert.ok(message.source.callId.length > 0, id) }
      if (message.source.kind === 'agent-instructions') assert.deepEqual(message.source.changes, [{ action: 'set', scope: 'user-global\u0000AGENTS.md', path: '~/.dsh/AGENTS.md' }])
      if (message.source.kind === 'session-reference') assert.deepEqual(message.source, {
        kind: 'session-reference', form: 'recall', version: 1,
        references: [{ sessionId: 'readme-review', label: '検証用の参照会話', capturedFormatVersion: 4, capturedThroughSeq: 17, compacted: false, originalMessages: 6, retainedMessages: 6, omittedMessages: 0, omittedBytes: 0, truncated: false, inputIndex: 0 }],
      })
    }
  }
})

test('S6B 全履歴fixtureのturnとstepの境界、宣言・開始・結果が対応する', () => {
  for (const { id, running, records } of histories()) {
    let turn = 0, step = 0, lastTurn = 0, lastStep = 0
    const calls = new Map<string, { name: string; arguments: string; started: boolean }>()
    const seenCalls = new Set<string>()
    for (const event of records) {
      const data = dataOf(event)
      if (event.type === 'turn/start') {
        assert.equal(turn, 0, id); assert.equal(data.turn, lastTurn + 1, id)
        turn = lastTurn = data.turn; lastStep = 0
      } else if (event.type === 'step/start') {
        assert.equal(step, 0, id); assert.equal(data.turn, turn, id); assert.equal(data.step, lastStep + 1, id)
        step = lastStep = data.step
      } else if (event.type === 'step/end') {
        assert.ok(step > 0, id); assert.equal(data.turn, turn, id); assert.equal(data.step, step, id)
        assert.equal(calls.size, 0, id); step = 0
      } else if (event.type === 'turn/end') {
        assert.ok(turn > 0, id); assert.equal(data.turn, turn, id); assert.equal(step, 0, id); assert.equal(calls.size, 0, id); turn = 0
      } else if (['assistant/message', 'assistant/attempt', 'system/message', 'developer/message', 'tool/call', 'tool/result'].includes(event.type)) {
        assert.ok(turn > 0 && step > 0, `${id}: ${event.type}`)
        assert.equal(data.turn, turn, id); assert.equal(data.step, step, id)
        if (event.type === 'assistant/message') for (const block of data.message.content) if (block.type === 'tool-call') {
          assert.ok(!seenCalls.has(block.id), id); seenCalls.add(block.id)
          calls.set(block.id, { name: block.name, arguments: block.arguments, started: false })
        }
        if (event.type === 'tool/call') {
          const call = calls.get(data.callId)
          assert.ok(call && !call.started, `${id}: undeclared ${data.callId}`)
          assert.equal(call.name, data.name, id); assert.equal(call.arguments, data.arguments, id); call.started = true
        }
        if (event.type === 'tool/result') {
          assert.equal(calls.get(data.message.toolCallId)?.started, true, id)
          calls.delete(data.message.toolCallId)
        }
      }
    }
    if (!running) { assert.equal(turn, 0, id); assert.equal(step, 0, id); assert.equal(calls.size, 0, id) }
  }
})

test('S6B コマンドはsourceオブジェクトと対応するrunを持ち、参照先は非コマンド', () => {
  for (const { id, records } of histories()) {
    const commands = new Set<string>()
    const runIds = new Set<string>()
    for (const event of records) {
      const data = dataOf(event)
      if (event.type === 'command/run') {
        assert.deepEqual(data.source, { kind: 'user' }, id)
        assert.ok(!runIds.has(data.commandId), id); runIds.add(data.commandId); commands.add(data.commandId)
      }
      if (event.type === 'command/done') {
        assert.ok(commands.delete(data.commandId), id)
        if (data.sourceEventSeq !== undefined) {
          assert.equal(data.kind, 'success', id)
          assert.ok(Number.isSafeInteger(data.sourceEventSeq) && data.sourceEventSeq >= 0, id)
          assert.ok(data.sourceEventSeq < event.seq, id)
          const source = records.find(row => row.seq === data.sourceEventSeq)
          assert.ok(source, `${id}: missing source event`)
          assert.ok(source.type !== 'command/run' && source.type !== 'command/done', id)
        }
      }
    }
    assert.equal(commands.size, 0, id)
  }
})

test('S6B 再試行のprovider・policy・同一chainとstarted、待機中の取消を区別する', () => {
  const header = traceExampleRecords.find(event => event.type === 'request/header')!
  const retries = traceExampleRecords.filter(event => event.type === 'llm/retry').map(dataOf)
  assert.deepEqual(retries.map(row => [row.retryId, row.provider, row.policyKey, row.retry, row.turn, row.step]), [
    ['trace-retry', dataOf(header).header.config.provider, 'network', 1, 2, 1],
    ['trace-retry', dataOf(header).header.config.provider, 'network', 2, 2, 1],
  ])
  const started = traceExampleRecords.filter(event => event.type === 'llm/retry-started')
  assert.deepEqual(started.map(dataOf), retries.map(({ retryId, turn, step, retry }) => ({ retryId, turn, step, retry })))
  for (const event of started) assert.ok(traceExampleRecords.some(prior => prior.seq < event.seq && prior.type === 'llm/retry' && dataOf(prior).retry === dataOf(event).retry))
  assert.equal(traceRetryCancelledRecords.filter(event => event.type === 'llm/retry').length, 1)
  assert.equal(traceRetryCancelledRecords.filter(event => event.type === 'llm/retry-started').length, 0)
  assert.equal(dataOf(traceRetryCancelledRecords.at(-1)!).reason.kind, 'aborted')
})

test('S6B 要約の置換範囲・全surfaceノード・非負の価格が直後のcheckpointと一致する', () => {
  const summary = traceExampleRecords.find(event => event.type === 'compaction/summary')!
  const data = dataOf(summary)
  const checkpoint = traceExampleRecords[summary.seq + 1]!
  assert.deepEqual(checkpoint.surfaceOp, { op: 'replace', startSeq: data.shadowedRange.start, endSeq: data.shadowedRange.end })
  const nodes = traceExampleRecords.filter(event => event.surfaceOp === 'append' && event.seq >= data.shadowedRange.start && event.seq <= data.shadowedRange.end).map(event => event.seq)
  assert.deepEqual(data.shadowedSeqs, nodes)
  assert.deepEqual(checkpoint.sourceEventSeqs, nodes)
  assert.equal(typeof data.shadowedTokenCount, 'number')
  assert.ok(Number.isSafeInteger(data.shadowedTokenCount) && data.shadowedTokenCount >= 0)
  assert.equal(dataOf(checkpoint).source.compactionId, data.compactionId)
})

test('S6B 全履歴fixtureのチャット表示行キーは一意', () => {
  for (const { id, records } of histories()) {
    const rows = buildChatRows(records)
    assert.equal(new Set(rows.map(row => row.key)).size, rows.length, id)
  }
})

test('S6B approvalの有効な先行空turnは表示を増やさず、従来の見出し2・3を保つ', () => {
  assert.equal(dataOf(approvalRecords[0]!).turn, 1)
  assert.deepEqual(selectTrace(approvalRecords, null, true).map(turnHeading), [
    'ターン 2 ・ 合計 18.4 秒 ・ 12,480 トークン', 'ターン 3 ・ 実行中',
  ])
  const failed = approvalRecords.slice(0, 2).map(row => row.type === 'turn/end'
    ? { ...row, data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } } : row)
  assert.equal(selectTrace(failed)[0]?.termination?.kind, 'aborted', 'an empty interrupted turn remains visible')
})
