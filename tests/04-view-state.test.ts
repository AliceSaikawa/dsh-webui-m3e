import assert from 'node:assert/strict'
import test from 'node:test'
import { retainTraceSession, traceEmptyMessage, type TraceSessionData } from '../web/src/features/trace/view-state.ts'

function sessionData(revision: number, openState: TraceSessionData['snapshot']['openState'] = 'open'): TraceSessionData {
  return {
    face: undefined,
    snapshot: {
      sessionId: 'trace-example', queue: [], pendingSubmissions: [], running: true, subagent: null,
      removed: false, openState, openError: null, hasMore: revision < 3, loadingOlder: false,
      promptError: null, blank: false, lastAgentError: null, promptAttempted: true, awaitingFirstTurn: false,
    },
    records: [{ seq: revision, time: 1000 + revision, type: 'user/message', data: { content: [{ type: 'text', text: `質問 ${revision}` }] } }],
    stream: { attemptId: `attempt-${revision}`, turn: 1, step: 1, chunks: [], content: [{ type: 'text', text: `返答 ${revision}` }] },
  }
}

test('an initially hidden trace retains nothing even as its subscribed session advances', () => {
  const loading = sessionData(1, 'loading')
  const available = sessionData(2)
  const first = retainTraceSession(null, loading, false)
  assert.equal(first, null)
  assert.equal(retainTraceSession(first, available, false), null)
})

test('the first visible visit captures the current session data without copying it', () => {
  const latest = sessionData(2)
  const retained = retainTraceSession(null, latest, true)
  assert.equal(retained, latest)
  assert.ok(retained)
  assert.equal(retained.records, latest.records)
  assert.equal(retained.stream, latest.stream)
  assert.equal(retained.snapshot, latest.snapshot)
})

test('hidden feed updates preserve the rendered object and all its data references', () => {
  const visible = sessionData(1)
  const original = retainTraceSession(null, visible, true)
  assert.ok(original)
  const references = { records: original.records, stream: original.stream, snapshot: original.snapshot }

  let retained = original
  for (const revision of [2, 3, 4]) {
    const incoming = sessionData(revision)
    assert.notEqual(incoming.records, references.records)
    assert.notEqual(incoming.stream, references.stream)
    assert.notEqual(incoming.snapshot, references.snapshot)
    const next = retainTraceSession(retained, incoming, false)
    assert.equal(next, original)
    assert.ok(next)
    assert.equal(next.records, references.records)
    assert.equal(next.stream, references.stream)
    assert.equal(next.snapshot, references.snapshot)
    retained = next
  }
  assert.equal(retained.snapshot.hasMore, true)
  assert.equal(retained.stream?.attemptId, 'attempt-1')
})

test('reactivation catches up to the latest records, stream and snapshot in one update', () => {
  const original = sessionData(1)
  const intermediate = sessionData(2)
  const latest = sessionData(3)
  const hidden = retainTraceSession(original, intermediate, false)
  assert.equal(hidden, original)
  const resumed = retainTraceSession(hidden, latest, true)
  assert.equal(resumed, latest)
  assert.notEqual(resumed, intermediate)
  assert.ok(resumed)
  assert.equal(resumed.records, latest.records)
  assert.equal(resumed.stream, latest.stream)
  assert.equal(resumed.snapshot, latest.snapshot)
  assert.equal(resumed.snapshot.hasMore, false)
  assert.equal(resumed.stream?.attemptId, 'attempt-3')
})

test('a new hook return object with unchanged fields preserves the retained reference', () => {
  const original = sessionData(1)
  const wrapper = { ...original }
  assert.notEqual(wrapper, original)
  assert.equal(retainTraceSession(original, wrapper, true), original)
  assert.equal(retainTraceSession(original, wrapper, false), original)
})

test('each visible data source independently invalidates the retained panel props', () => {
  const original = sessionData(1)
  const updates: TraceSessionData[] = [
    { ...original, records: [...original.records] },
    { ...original, stream: null },
    { ...original, snapshot: { ...original.snapshot, running: false } },
  ]
  for (const next of updates) {
    assert.equal(retainTraceSession(original, next, true), next)
    assert.equal(retainTraceSession(original, next, false), original)
  }
})

test('an empty cold or loading session is distinguished from a loaded empty history', () => {
  const emptyHistory = traceEmptyMessage('open')
  assert.equal(emptyHistory, 'まだ記録がありません。')
  for (const openState of ['cold', 'loading'] as const) {
    const message = traceEmptyMessage(openState)
    assert.equal(message, '会話を読み込んでいます…')
    assert.notEqual(message, emptyHistory)
  }
})
