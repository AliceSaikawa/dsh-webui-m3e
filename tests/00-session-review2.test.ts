import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { buildInboxRows, countInbox } from '../web/src/features/inbox/model.ts'
import { conversationChoices, conversationChoiceAvailable } from '../web/src/features/conversation/conversation-choices.ts'
import { filterVisibleSearchItems, selectVisibleRecentSessions } from '../web/src/features/search/search-visibility.ts'
import { visibleSessions } from '../web/src/features/home/data.ts'
import type { SessionBinding } from '../web/src/dsh/services.ts'

const id = MOCK_IDS.sessions.readme
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

test('A1 Aのready後着とBの投影待ちが重なっても所有中のAを解放せず戻れる', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(id, 'subagentCatalog', [{ id: 'child', mode: 'continuable', label: '子', createdAt: 0 }])
  ctx.mock.updateList(list => { list.projectionsBySession = {} })
  const aReady = deferred<SessionBinding>(), bCatalog = deferred<void>()
  const retain = ctx.sessions.retain.bind(ctx.sessions), refresh = ctx.sessions.refreshProjections.bind(ctx.sessions)
  ctx.sessions.retain = (target, options) => {
    const ref = retain(target, options)
    return ref.sessionId === id ? { ...ref, get binding() { return ref.binding }, ready: aReady.promise } : ref
  }
  ctx.sessions.refreshProjections = async parent => { await bCatalog.promise; await refresh(parent) }
  const owner = conversationSelection(ctx.sessions)
  const first = owner.select(id)
  await flush()
  const binding = ctx.sessions.binding(id)!
  // Opening A now seeds its page projections. Make B's catalog cold after
  // that baseline so this test still exercises the intended overlapping reads.
  ctx.mock.updateList(list => { list.projectionsBySession = {} })
  const second = owner.select('child')
  await flush()
  aReady.resolve(binding)
  assert.equal(await first, false)
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 1)
  let returning!: Promise<boolean>
  assert.doesNotThrow(() => { returning = owner.select(id) })
  assert.equal(await returning, true)
  bCatalog.resolve(); assert.equal(await second, false)
  assert.equal(ctx.sessions.binding(id), binding)
  assert.equal(ctx.sessions.binding('child'), undefined)
  owner.clear()
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 0)
})

test('A1 selectは同期の読み取り例外もPromiseの拒否として返す', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(id)
  const face = ctx.sessions.binding(id)!.session
  t.mock.method(face, 'getSnapshot', () => { throw new Error('同期の取得失敗') })
  await owner.select(MOCK_IDS.sessions.approval)
  // The next selection takes the fast path for the currently owned reference.
  const current = ctx.sessions.binding(MOCK_IDS.sessions.approval)!.session
  t.mock.method(current, 'getSnapshot', () => { throw new Error('同期の取得失敗') })
  const catalog = deferred<void>()
  ctx.sessions.refreshProjections = () => catalog.promise
  ctx.mock.addSession({ id: 'pending-child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  const pending = owner.select('pending-child')
  let result!: Promise<boolean>
  assert.doesNotThrow(() => { result = owner.select(MOCK_IDS.sessions.approval) })
  await assert.rejects(result, /同期の取得失敗/)
  catalog.resolve(); await pending
})

test('A2 idsにない子の完了を対応待ちの行とバッジに数えアーカイブで除外する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子の完了', running: true, blank: false, updatedAt: 1 }, [])
  ctx.mock.updateList(list => { list.ids = list.ids.filter(value => value !== 'child') })
  let notify!: (id: string, running: boolean) => void
  const status = completionStatus({ ...ctx, remote: { $on(_event: string, handler: typeof notify) { notify = handler; return () => {} } } })
  t.after(() => status.dispose())
  notify('child', true); notify('child', false)
  const list = status.getSnapshot(), workspaces = ctx.workspaces.list.getSnapshot()
  assert.equal(list.byId.child?.completionUnread, true)
  assert.deepEqual(buildInboxRows([], list, workspaces, 2).completed.map(row => row.sessionId), ['child'])
  assert.equal(countInbox([], list, []), 1)
  assert.deepEqual(buildInboxRows([], list, { ...workspaces, archivedSessionIds: ['child'] }, 2).completed, [])
  assert.equal(countInbox([], list, ['child']), 0)
})

test('A2 byIdだけの子も切替候補と子を含む検索に残りホームは登録順を使う', t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const child = { id: 'child', parentId: id, origin: 'subagent' as const, displayTitle: '子', running: false, blank: false, updatedAt: 1, retainedBy: {} }
  const list = { ids: [id], byId: { [id]: ctx.sessions.list.getSnapshot().byId[id]!, child }, phase: 'ready' as const }
  const workspaces = ctx.workspaces.list.getSnapshot()
  assert.deepEqual(conversationChoices(list, workspaces, id, '子').items.map(value => value.row.id), ['child'])
  assert.equal(conversationChoiceAvailable(child, list, []), true)
  assert.deepEqual(filterVisibleSearchItems([{ sessionId: 'child' }], list, workspaces, true), [{ sessionId: 'child' }])
  assert.deepEqual(filterVisibleSearchItems([{ sessionId: 'child' }], list, workspaces, false), [])
  assert.ok(selectVisibleRecentSessions(list, workspaces, 5, true).some(row => row.id === 'child'))
  const workspace = { ...workspaces.items[0]!, sessionIds: [id, 'child'] }
  assert.deepEqual(visibleSessions(workspace, list.byId, [], true).map(row => row.id), [id, 'child'])
  assert.deepEqual(visibleSessions({ ...workspace, sessionIds: [id] }, list.byId, [], true).map(row => row.id), [id])
})

for (const operation of ['loadOlder', 'loadThrough'] as const) {
  test(`B4 ${operation}の途中で最後の参照を解放し再取得しても旧処理は終了し新世代を更新しない`, async t => {
    const ctx = createMockContext({ pageSize: 2 }); t.after(() => ctx.dispose())
    const old = ctx.sessions.retain(id, { source: 'm3e.test' })
    const binding = await old.ready
    const before = binding.eventSource.getSnapshot()
    const pending = operation === 'loadOlder' ? binding.session.loadOlder() : binding.session.loadThrough(0)
    assert.equal(binding.session.getSnapshot().loadingOlder, true)
    old.release()
    const next = ctx.sessions.retain(id, { source: 'm3e.test' })
    const current = await next.ready
    const nextBefore = current.eventSource.getSnapshot()
    await pending
    assert.equal(binding.session.getSnapshot().loadingOlder, false)
    assert.equal(binding.eventSource.getSnapshot(), before)
    assert.equal(current.eventSource.getSnapshot(), nextBefore)
    await current.session.loadThrough(0)
    assert.equal(current.session.getSnapshot().hasMore, false)
    assert.equal(binding.eventSource.getSnapshot(), before)
  })
}
