import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionJournal, foldSessionWindow, journalOf } from '../web/src/dsh/session-journal.ts'
import { servicesOf, type SessionBinding, type SessionEventLikeEntry, type SessionEventWindow, type SessionWireEvent, type StreamChunk } from '../web/src/dsh/services.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'

function durable(seq: number, type = 'user/message'): SessionEventLikeEntry {
  return { type: 'event', event: { type, seq, time: 1000 + seq, data: { content: [] }, surfaceOp: 'append' } }
}
function transient(chunk: StreamChunk, seq = 1.5, attemptId = 'attempt-1'): SessionEventLikeEntry {
  return { type: 'transient', event: { type: 'assistant/live-chunk', seq, time: 1000 + seq, data: { attemptId, turn: 1, step: 1, chunk } } }
}
function window(entries: SessionEventLikeEntry[], revision = 1): SessionEventWindow {
  return { entries, revision, hasMore: false, change: { kind: 'replace', entries } }
}
function source(initial: SessionEventWindow) {
  let value = initial
  let subscriptions = 0
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { subscriptions++; listeners.add(listener); return () => { subscriptions--; listeners.delete(listener) } },
    replace(next: SessionEventWindow) { value = next; for (const listener of [...listeners]) listener() },
    get subscriptions() { return subscriptions },
  }
}

test('durable journal preserves unknown wire fields and sorts paginated history', () => {
  const extension: SessionWireEvent = { type: 'future/event', seq: 0, time: 10, data: ['opaque'], ignorable: true, sourceEventSeqs: [0], surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 } }
  const result = foldSessionWindow(window([durable(2), { type: 'event', event: extension }, durable(1)]))
  assert.deepEqual(result.records.map(event => event.seq), [0, 1, 2])
  assert.equal(result.records[0], extension)
  assert.equal(result.stream, null)
})

test('interleaved indexed stream blocks fold independently and block-end is authoritative', () => {
  const result = foldSessionWindow(window([
    durable(1),
    transient({ type: 'block-start', index: 0, blockType: 'reasoning' }),
    transient({ type: 'reasoning-delta', index: 0, text: '考え' }),
    transient({ type: 'text-delta', index: 2, text: '返' }),
    transient({ type: 'tool-call-delta', index: 1, id: 'call-1', name: 'read_file', argumentsDelta: '{"path":' }),
    transient({ type: 'text-delta', index: 2, text: '事' }),
    transient({ type: 'reasoning-delta', index: 0, text: 'ました' }),
    transient({ type: 'tool-call-delta', index: 1, id: 'call-1', argumentsDelta: '"README.md"}' }),
    transient({ type: 'block-end', index: 2, block: { type: 'text', text: '確定した返事' } }),
    transient({ type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }),
    transient({ type: 'finish', reason: { kind: 'tool-calls' } }),
  ]))
  assert.equal(result.records.length, 1)
  assert.deepEqual(result.stream?.content, [
    { type: 'reasoning', text: '考えました' },
    { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"README.md"}' },
    { type: 'text', text: '確定した返事' },
  ])
  assert.deepEqual(result.stream?.usage, { inputTokens: 12, outputTokens: 3 })
  assert.deepEqual(result.stream?.finishReason, { kind: 'tool-calls' })
})

test('reconnect replacement restores baseline once; subsequent chunks do not repeat old text', () => {
  const feed = source(window([durable(1), transient({ type: 'text-delta', index: 0, text: '古い途中' })]))
  const journal = createSessionJournal(feed)
  const unsubscribe = journal.subscribe(() => {})
  const first = journal.getSnapshot()
  assert.equal(first, journal.getSnapshot())
  const restored = [durable(1), transient({ type: 'text-delta', index: 0, text: '復元された' })]
  feed.replace(window(restored, 2))
  assert.deepEqual(journal.getSnapshot().stream?.content, [{ type: 'text', text: '復元された' }])
  feed.replace(window([...restored, transient({ type: 'text-delta', index: 0, text: '返事' })], 3))
  assert.deepEqual(journal.getSnapshot().stream?.content, [{ type: 'text', text: '復元された返事' }])
  assert.deepEqual(first.stream?.content, [{ type: 'text', text: '古い途中' }])
  unsubscribe()
})

test('controller assistant settlement replaces transient data with one durable record', () => {
  const feed = source(window([durable(1), transient({ type: 'text-delta', index: 0, text: '途中' })]))
  const journal = createSessionJournal(feed)
  assert.notEqual(journal.getSnapshot().stream, null)
  feed.replace(window([durable(1), durable(2, 'assistant/message')], 2))
  assert.equal(journal.getSnapshot().stream, null)
  assert.equal(journal.getSnapshot().records.length, 2)
})

test('multiple consumers share one journal and one source subscription; remount reads latest', () => {
  const feed = source(window([durable(1)]))
  const binding = { eventSource: feed } as unknown as SessionBinding
  const journal = journalOf(binding)
  assert.equal(journalOf(binding), journal)
  let notifications = 0
  const unsubscribeA = journal.subscribe(() => { notifications++ })
  const unsubscribeB = journal.subscribe(() => { notifications++ })
  assert.equal(feed.subscriptions, 1)
  feed.replace(window([durable(1), durable(2)], 2))
  assert.equal(notifications, 2)
  unsubscribeA()
  unsubscribeA()
  assert.equal(feed.subscriptions, 1)
  unsubscribeB()
  assert.equal(feed.subscriptions, 0)
  feed.replace(window([durable(0), durable(1), durable(2)], 3))
  const unsubscribeC = journal.subscribe(() => {})
  assert.deepEqual(journal.getSnapshot().records.map(event => event.seq), [0, 1, 2])
  unsubscribeC()
})

test('transient appends preserve records identity; durable append and replacement create new arrays', () => {
  const firstEvent = durable(1)
  const feed = source(window([firstEvent]))
  const journal = createSessionJournal(feed)
  const unsubscribe = journal.subscribe(() => {})
  const before = journal.getSnapshot()
  const firstChunk = transient({ type: 'text-delta', index: 0, text: '返' })
  feed.replace({ ...window([firstEvent, firstChunk], 2), change: { kind: 'append', entries: [firstChunk] } })
  const first = journal.getSnapshot()
  assert.equal(first.records, before.records)
  assert.notEqual(first.stream, before.stream)
  const secondChunk = transient({ type: 'text-delta', index: 0, text: '事' }, 1.75)
  feed.replace({ ...window([firstEvent, firstChunk, secondChunk], 3), change: { kind: 'append', entries: [secondChunk] } })
  assert.equal(journal.getSnapshot().records, before.records)
  assert.deepEqual(journal.getSnapshot().stream?.content, [{ type: 'text', text: '返事' }])
  const secondEvent = durable(2)
  const entries = [firstEvent, firstChunk, secondChunk, secondEvent]
  feed.replace({ ...window(entries, 4), change: { kind: 'append', entries: [secondEvent] } })
  const appended = journal.getSnapshot()
  assert.notEqual(appended.records, before.records)
  assert.deepEqual(appended.records.map(event => event.seq), [1, 2])
  feed.replace(window(entries, 5))
  assert.notEqual(journal.getSnapshot().records, appended.records)
  assert.deepEqual(journal.getSnapshot().records, appended.records)
  unsubscribe()
})

test('the first snapshot after a transient append still contains the whole durable window', () => {
  const chunk = transient({ type: 'text-delta', index: 0, text: '途中' })
  const feed = source({ ...window([durable(1), durable(2), chunk], 8), change: { kind: 'append', entries: [chunk] } })
  const journal = createSessionJournal(feed)
  assert.deepEqual(journal.getSnapshot().records.map(event => event.seq), [1, 2])
  assert.deepEqual(journal.getSnapshot().stream?.content, [{ type: 'text', text: '途中' }])
})

test('resubscribing after missed revisions rebuilds durable history before transient reuse', () => {
  const firstEvent = durable(1)
  const feed = source(window([firstEvent]))
  const journal = createSessionJournal(feed)
  const unsubscribe = journal.subscribe(() => {})
  const before = journal.getSnapshot()
  unsubscribe()
  const secondEvent = durable(2)
  feed.replace({ ...window([firstEvent, secondEvent], 2), change: { kind: 'append', entries: [secondEvent] } })
  const firstChunk = transient({ type: 'text-delta', index: 0, text: '返' }, 2.5)
  const entries = [firstEvent, secondEvent, firstChunk]
  feed.replace({ ...window(entries, 3), change: { kind: 'append', entries: [firstChunk] } })
  const unsubscribeAgain = journal.subscribe(() => {})
  const restored = journal.getSnapshot()
  assert.notEqual(restored.records, before.records)
  assert.deepEqual(restored.records.map(event => event.seq), [1, 2])
  const secondChunk = transient({ type: 'text-delta', index: 0, text: '事' }, 2.75)
  feed.replace({ ...window([...entries, secondChunk], 4), change: { kind: 'append', entries: [secondChunk] } })
  assert.equal(journal.getSnapshot().records, restored.records)
  unsubscribeAgain()
})

test('a durable update between the initial read and subscription is not lost', () => {
  const firstEvent = durable(1)
  const feed = source(window([firstEvent]))
  const journal = createSessionJournal(feed)
  journal.getSnapshot()
  const secondEvent = durable(2)
  feed.replace({ ...window([firstEvent, secondEvent], 2), change: { kind: 'append', entries: [secondEvent] } })
  const unsubscribe = journal.subscribe(() => {})
  const chunk = transient({ type: 'text-delta', index: 0, text: '途中' }, 2.5)
  feed.replace({ ...window([firstEvent, secondEvent, chunk], 3), change: { kind: 'append', entries: [chunk] } })
  assert.deepEqual(journal.getSnapshot().records.map(event => event.seq), [1, 2])
  unsubscribe()
})

test('skipped transient revisions reuse records only when all durable references are unchanged', () => {
  const firstEvent = durable(1)
  const feed = source(window([firstEvent]))
  const journal = createSessionJournal(feed)
  const before = journal.getSnapshot()
  const firstChunk = transient({ type: 'text-delta', index: 0, text: '返' })
  feed.replace({ ...window([firstEvent, firstChunk], 2), change: { kind: 'append', entries: [firstChunk] } })
  const secondChunk = transient({ type: 'text-delta', index: 0, text: '事' }, 1.75)
  feed.replace({ ...window([firstEvent, firstChunk, secondChunk], 3), change: { kind: 'append', entries: [secondChunk] } })
  const resumed = journal.getSnapshot()
  assert.equal(resumed.records, before.records)
  assert.deepEqual(resumed.stream?.content, [{ type: 'text', text: '返事' }])

  const replacement = durable(1, 'assistant/message')
  feed.replace(window([replacement], 4))
  feed.replace({ ...window([replacement, firstChunk], 5), change: { kind: 'append', entries: [firstChunk] } })
  assert.notEqual(journal.getSnapshot().records, resumed.records)
  assert.deepEqual(journal.getSnapshot().records.map(event => event.type), ['assistant/message'])
})

test('service facade uses the Workspace controller and keeps raw namespaces intact', () => {
  const workspaces = { list: { getSnapshot: () => ({ items: [] }) } }
  const remote = { workspace: { list: async () => ({ ok: true }) } }
  const services = servicesOf({ workspaces, remote })
  assert.equal(services.workspaces, workspaces)
  assert.equal(services.remote, remote)
})

test('RemoteResult helpers preserve failure data and present Japanese errors', () => {
  assert.equal(unwrapRemoteResult({ ok: true, value: 42 }), 42)
  const failure = { code: 'session/model-unavailable', message: 'English diagnostic', details: { model: 'test' } }
  assert.equal(remoteErrorMessage({ rpcError: failure }), '選んだモデルを利用できません。モデルを選び直してください。')
  assert.throws(() => unwrapRemoteResult({ ok: false, error: failure }), (error: unknown) => {
    assert.equal((error as { rpcError: unknown }).rpcError, failure)
    return true
  })
  assert.equal(remoteErrorMessage({ code: 'new/code', message: 'English diagnostic', details: {} }), '処理に失敗しました。もう一度お試しください。')
})
