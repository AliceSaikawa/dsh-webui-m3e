import assert from 'node:assert/strict'
import test from 'node:test'
import { JobRowsStore, type JobRowsRemote } from '../web/src/dsh/job-rows.ts'
import { observable } from '../web/src/dsh/mock/observable.ts'
import type { ConnectionState, SessionJob } from '../web/src/dsh/services.ts'

const row: SessionJob = { id: 'job', kind: 'bash', label: '合成ジョブ', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const state = observable<ConnectionState>('connected')
  const streams: { signal?: AbortSignal; push(rows: readonly SessionJob[]): void; fail(): void; end(): void; disposed: boolean }[] = []
  const remote: JobRowsRemote = { list(_request, signal) {
    let resolve: (value: IteratorResult<{ type: 'rows'; jobs: readonly SessionJob[] }>) => void
    let reject: (error: Error) => void
    const entry = { signal, disposed: false, push(rows: readonly SessionJob[]) { resolve({ done: false, value: { type: 'rows', jobs: rows } }) }, fail() { reject(new Error('fixture failure')) }, end() { resolve({ done: true, value: undefined }) } }
    streams.push(entry)
    // Deliberately allow delivery after cancellation: the store must fence old streams.
    return { [Symbol.asyncIterator]() { return { next: () => new Promise((yes, no) => { resolve = yes; reject = no }) } }, dispose() { entry.disposed = true } }
  } }
  return { state, streams, store: new JobRowsStore(remote, 'session', { state, reconnect() {} }) }
}

test('未到着・空・失敗を区別し、失敗時に最後の一覧を保持して再試行する', async () => {
  const { store, streams } = fixture()
  const release = store.subscribe(() => {})
  assert.deepEqual(store.getSnapshot(), { rows: [], status: 'loading' })
  streams[0]!.push([]); await flush()
  assert.deepEqual(store.getSnapshot(), { rows: [], status: 'ready' })
  streams[0]!.push([row]); await flush()
  streams[0]!.fail(); await flush()
  assert.deepEqual(store.getSnapshot(), { rows: [row], status: 'error' })
  store.retry()
  assert.equal(store.getSnapshot().status, 'loading')
  streams[1]!.push([{ ...row, status: 'killed' }]); await flush()
  assert.equal(store.getSnapshot().rows[0]!.status, 'killed')
  assert.equal(store.getSnapshot().status, 'ready')
  release()
})

test('初回失敗と予期しない正常終了も空一覧ではなく失敗にする', async () => {
  const { store, streams } = fixture()
  const release = store.subscribe(() => {})
  streams[0]!.fail(); await flush()
  assert.equal(store.getSnapshot().status, 'error')
  store.retry(); streams[1]!.end(); await flush()
  assert.equal(store.getSnapshot().status, 'error')
  release()
})

test('共有購読は最後の解除で止まり、解除後の古い応答は新しい購読を上書きしない', async () => {
  const { store, streams } = fixture()
  const first = store.subscribe(() => {}), second = store.subscribe(() => {})
  assert.equal(streams.length, 1)
  first(); assert.equal(streams[0]!.signal!.aborted, false)
  second(); assert.equal(streams[0]!.signal!.aborted, true)
  const third = store.subscribe(() => {})
  streams[1]!.push([{ ...row, label: '新しい購読' }]); await flush()
  streams[0]!.push([{ ...row, label: '古い購読' }]); await flush()
  assert.equal(store.getSnapshot().rows[0]!.label, '新しい購読')
  third()
  assert.equal(streams[1]!.disposed, true)
})

test('再接続時に再購読し、再試行・再接続前の失敗と通知を無視する', async () => {
  const { store, state, streams } = fixture()
  const release = store.subscribe(() => {})
  streams[0]!.push([row]); await flush()
  state.set('disconnected')
  assert.equal(store.getSnapshot().status, 'loading')
  assert.equal(streams[0]!.signal!.aborted, true)
  state.set('connected')
  streams[1]!.push([{ ...row, label: '再接続後' }]); await flush()
  streams[0]!.fail(); await flush()
  assert.equal(store.getSnapshot().status, 'ready')
  assert.equal(store.getSnapshot().rows[0]!.label, '再接続後')
  store.retry(); store.retry()
  streams[3]!.push([]); await flush()
  streams[2]!.push([row]); await flush()
  assert.deepEqual(store.getSnapshot(), { rows: [], status: 'ready' })
  release()
})
