import assert from 'node:assert/strict'
import test from 'node:test'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { observable } from '../web/src/dsh/mock/observable.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { SessionListState } from '../web/src/dsh/services.ts'

test('標準画面と同じく baseline 前の完了通知を残し、表示・再開・削除で未読を消す', () => {
  const base = createMockContext()
  const list = observable<SessionListState>({ phase: 'pending', ids: [], byId: {}, projectionsBySession: {} })
  let status!: (id: string, running: boolean) => void
  let unsubscribed = false
  const ctx = { ...base, sessions: { ...base.sessions, list }, remote: { $on(event: string, listener: typeof status) {
    assert.equal(event, 'api-session/status'); status = listener; return () => { unsubscribed = true }
  } } }
  const store = completionStatus(ctx)
  const row = { id: 'a', displayTitle: '完了', running: false, blank: false, updatedAt: 0, retainedBy: {} }
  try {
    status('a', false)
    list.set({ ...list.getSnapshot(), phase: 'ready', ids: ['a'], byId: { a: row } })
    assert.equal(store.getSnapshot().byId.a?.completionUnread, true)
    list.set({ ...list.getSnapshot(), byId: { a: { ...row, retainedBy: { 'm3e.mainView': 1 } } } })
    assert.equal(store.getSnapshot().byId.a?.completionUnread, false)
    list.set({ ...list.getSnapshot(), byId: { a: row } })
    status('a', true); status('a', false)
    assert.equal(store.getSnapshot().byId.a?.completionUnread, true)
    status('a', true)
    assert.equal(store.getSnapshot().byId.a?.completionUnread, false)
    status('a', false)
    list.set({ ...list.getSnapshot(), ids: [], byId: {} })
    list.set({ ...list.getSnapshot(), ids: ['a'], byId: { a: row } })
    assert.equal(store.getSnapshot().byId.a?.completionUnread, false)
  } finally { store.dispose(); base.dispose() }
  assert.equal(unsubscribed, true)
})

test('ready の一覧に初めて現れた停止中の会話は未読にしない', () => {
  const ctx = createMockContext()
  try {
    assert.ok(Object.values(completionStatus(ctx).getSnapshot().byId).every(row => !row.completionUnread))
  } finally { ctx.dispose() }
})
