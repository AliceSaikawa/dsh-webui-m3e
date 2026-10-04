import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS, imageAttachment } from '../web/src/dsh/mock/fixtures.ts'
import { queueFromInbox } from '../web/src/dsh/inbox.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { observable } from '../web/src/dsh/mock/observable.ts'
import { remoteErrorMessage } from '../web/src/dsh/remote-result.ts'
import { openHomeSession } from '../web/src/features/home/session-navigation.ts'
import { deliverDraft } from '../web/src/features/composer/delivery.ts'
import { registerDeliveryDestination, handoffDeliveryDestination } from '../web/src/features/composer/delivery-destination.ts'
import { clearDraft, writeDraft, readDraft } from '../web/src/features/composer/drafts.ts'
import type { InboxState, QueueAction, RemoteResult, SessionJob, SessionListState, SessionReference, SessionRetainOptions, SessionTarget } from '../web/src/dsh/services.ts'

const id = MOCK_IDS.sessions.readme
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
async function reconnect(ctx: ReturnType<typeof createMockContext>) {
  const ready = new Promise<void>(resolve => { const off = ctx.connection.state.subscribe(() => { if (ctx.connection.state.getSnapshot() === 'connected') { off(); resolve() } }) })
  ctx.connection.reconnect(); await ready
}
const message = (id: string, text = id) => ({ id, role: 'user' as const, source: { kind: 'user', rpcId: 'rpc-' + id }, content: [{ type: 'text' as const, text }] })
const job: SessionJob = { id: 'job', kind: 'bash', label: '処理', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }

test('R6 pinnedSessionIdsは初期値とpin・unpinの更新を公開する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  assert.deepEqual(ctx.workspaces.list.getSnapshot().pinnedSessionIds, [])
  await ctx.workspaces.pinSession(id)
  await ctx.workspaces.pinSession(id)
  assert.deepEqual(ctx.workspaces.list.getSnapshot().pinnedSessionIds, [id])
  await ctx.workspaces.unpinSession(id)
  assert.deepEqual(ctx.workspaces.list.getSnapshot().pinnedSessionIds, [])
})

test('R7 一つのreadyをabortしても複数参照の所有権と他のreadyを保つ', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const abort = new AbortController()
  const a = ctx.sessions.retain(id, { source: 'm3e.a', signal: abort.signal })
  const b = ctx.sessions.retain(id, { source: 'm3e.b' })
  abort.abort()
  await assert.rejects(a.ready)
  assert.equal(await b.ready, a.binding)
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 2)
  a.release()
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 1)
  b.release()
  assert.equal(ctx.sessions.scope(id), undefined)
})

test('R3 準備のsignal中断を捕まえたら明示解放し元の会話を保つ', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(id)
  const old = ctx.sessions.binding(id)
  const other = MOCK_IDS.sessions.approval
  const controller = new AbortController()
  const pending = owner.prepare(other, () => true, () => assert.fail('取り消した移動'), controller.signal)
  await Promise.resolve()
  assert.equal(ctx.sessions.retainInfo(other).getSnapshot().referenceCount, 1)
  controller.abort()
  assert.equal(await pending, false)
  assert.equal(ctx.sessions.binding(id), old)
  assert.equal(ctx.sessions.binding(other), undefined)
})

test('R3 一覧へ戻るclearで準備中のreadyを中断し参照を解放する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const owner = conversationSelection(ctx.sessions)
  await owner.select(id)
  const other = MOCK_IDS.sessions.approval
  let signal: AbortSignal | undefined
  const retain = ctx.sessions.retain.bind(ctx.sessions)
  ctx.sessions.retain = (target, options) => { signal = options.signal; return retain(target, options) }
  const pending = owner.prepare(other, () => true, () => assert.fail('離脱した移動'))
  await Promise.resolve()
  assert.equal(ctx.sessions.retainInfo(other).getSnapshot().referenceCount, 1)
  owner.clear()
  assert.equal(signal?.aborted, true)
  assert.equal(await pending, false)
  assert.equal(ctx.sessions.scope(id), undefined)
  assert.equal(ctx.sessions.scope(other), undefined)
})

test('R8 不存在は空のreadyをキャッシュし二度目はHostへ読みに行かない', async t => {
  let reads = 0
  const ctx = createMockContext({ readProjections: async () => { reads++; return { ok: true, value: null } } }); t.after(() => ctx.dispose())
  const first = ctx.sessions.refreshProjections('later')
  assert.equal(ctx.sessions.refreshProjections('later'), first)
  await first
  assert.deepEqual(ctx.sessions.list.getSnapshot().projectionsBySession.later, { values: {}, state: 'ready', error: null })
  ctx.mock.addSession({ id: 'later', displayTitle: '後着', running: false, blank: false, updatedAt: 0 }, [])
  await ctx.sessions.refreshProjections('later')
  assert.equal(reads, 1)
})

test('R8 再接続で投影を消して既読を自動取得し旧接続の後着を無視する', async t => {
  const old = deferred<RemoteResult<Record<string, unknown> | null>>(), fresh = deferred<RemoteResult<Record<string, unknown> | null>>()
  let reads = 0
  const ctx = createMockContext({ readProjections: async () => ++reads === 1 ? old.promise : fresh.promise }); t.after(() => ctx.dispose())
  ctx.mock.setProjection(id, 'title', '古い値')
  const pending = ctx.sessions.refreshProjections(id)
  await flush()
  await reconnect(ctx)
  assert.equal(reads, 2)
  assert.deepEqual(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values, {})
  fresh.resolve({ ok: true, value: { title: '新しい値' } })
  await flush()
  const snapshot = ctx.sessions.list.getSnapshot().projectionsBySession[id]
  assert.deepEqual(snapshot, { values: { title: '新しい値' }, state: 'ready', error: null })
  let notifications = 0
  const off = ctx.sessions.list.subscribe(() => { notifications++ }); t.after(off)
  old.resolve({ ok: true, value: { title: '古い応答', staleOnly: true } })
  await pending
  assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values.title, '新しい値')
  assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id], snapshot)
  assert.equal(notifications, 0)
})

test('R8 空の成功の後でも作成された子の投影通知から同じカタログを開ける', async t => {
  let reads = 0
  const ctx = createMockContext({ readProjections: async () => { reads++; return { ok: true, value: {} } } }); t.after(() => ctx.dispose())
  await ctx.sessions.refreshProjections(id)
  ctx.mock.addSession({ id: 'late-child', parentId: id, origin: 'subagent', displayTitle: '後着の子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(id, 'subagentCatalog', [{ id: 'late-child', mode: 'continuable', label: '後着の子', createdAt: 0 }])
  let path = ''
  await openHomeSession(ctx.sessions, ctx.sessions.list.getSnapshot().byId['late-child']!, value => { path = value })
  assert.equal(path, '/s/late-child')
  assert.equal(reads, 1)
})

test('R8 読み込み中の新しい投影通知を遅いnull成功が消さない', async t => {
  const gate = deferred<RemoteResult<Record<string, unknown> | null>>()
  const ctx = createMockContext({ readProjections: () => gate.promise }); t.after(() => ctx.dispose())
  const pending = ctx.sessions.refreshProjections(id)
  ctx.mock.setProjection(id, 'title', '通知が先')
  gate.resolve({ ok: true, value: null }); await pending
  assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values.title, '通知が先')
})

for (const column of ['next-turn', 'next-step'] as const) test('R9 ' + column + 'をMessageIdで編集・削除する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const ref = ctx.sessions.retain(id, { source: 'm3e.test' })
  ctx.mock.setProjection(id, 'inbox', { 'next-turn': [], 'next-step': [], [column]: [message('message-id')] })
  const face = (await ref.ready).session
  assert.equal((await face.updateQueue('rpc-message-id', { kind: 'remove' })).ok, false)
  assert.equal((await face.updateQueue('message-id', { kind: 'edit', content: [{ type: 'text', text: '編集後' }] })).ok, true)
  assert.equal((ctx.mock.getProjection<InboxState>(id, 'inbox'))![column][0]?.content[0]?.type, 'text')
  assert.equal(queueFromInbox(ctx.mock.getProjection(id, 'inbox'))[0]?.text, '編集後')
  assert.equal((await face.updateQueue('message-id', { kind: 'remove' })).ok, true)
  assert.equal(queueFromInbox(ctx.mock.getProjection(id, 'inbox')).length, 0)
})

test('R9 不正な編集と実行後・next-stepへのsteerを拒否し日本語に案内する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const face = ctx.sessions.retain(id, { source: 'm3e.test' }).binding.session
  ctx.mock.setProjection(id, 'inbox', { 'next-turn': [message('q')], 'next-step': [message('s')] })
  for (const content of [[], [{ type: 'text', text: ' \n ' }]]) {
    const result = await face.updateQueue('q', { kind: 'edit', content } as QueueAction)
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'gateway/bad-request')
  }
  const invalid = await face.updateQueue('q', { kind: 'edit', content: [{ type: 'image', attachment: imageAttachment }] } as unknown as QueueAction)
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, 'session/attachment-invalid')
  for (const pending of ['q', 's']) {
    const result = await face.updateQueue(pending, { kind: 'steer' })
    assert.equal(result.ok, false)
    if (!result.ok) { assert.equal(result.error.code, 'session/steer-unavailable'); assert.match(remoteErrorMessage(result.error), /[ぁ-んァ-ヶ一-龠]/) }
  }
  ctx.mock.setSessionState(id, { running: true })
  assert.equal((await face.updateQueue('s', { kind: 'steer' })).ok, false)
  assert.equal((await face.updateQueue('q', { kind: 'steer' })).ok, true)
})

test('R10 解放後のsnapshotと履歴は固定され新世代の送信状態とページングを共有しない', async t => {
  const ctx = createMockContext({ pageSize: 2 }); t.after(() => ctx.dispose())
  const old = ctx.sessions.retain(id, { source: 'm3e.test' })
  const binding = await old.ready
  await binding.session.prompt([{ type: 'text', text: '前の送信' }], 'queue', AbortSignal.abort())
  await binding.session.loadOlder()
  assert.equal(binding.session.getSnapshot().promptAttempted, true)
  old.release()
  const snapshot = binding.session.getSnapshot(), window = binding.eventSource.getSnapshot()
  const fresh = ctx.sessions.retain(id, { source: 'm3e.test' })
  await fresh.ready
  assert.equal(fresh.binding.session.getSnapshot().promptAttempted, false)
  assert.equal(fresh.binding.session.getSnapshot().promptError, null)
  assert.equal(fresh.binding.eventSource.getSnapshot().entries.length, 2)
  ctx.mock.setSessionState(id, { running: true })
  await fresh.binding.session.rename('新しい世代')
  assert.equal(binding.session.getSnapshot(), snapshot)
  assert.equal(binding.eventSource.getSnapshot(), window)
  assert.equal(fresh.binding.session.getSnapshot().running, true)
})

test('R11 killの受付は行を完了させず別の一覧通知で停止を反映する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.setJobs(id, [job]); ctx.jobs.watchRows(id)
  assert.deepEqual(await ctx.jobs.kill(id, job.id), { ok: true, value: { outcome: 'requested' } })
  assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.[0]?.status, 'running')
  ctx.mock.setJobs(id, [{ ...job, status: 'killed' }])
  assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.[0]?.status, 'killed')
})

test('R11 observeは別の出力・終了通知で更新し最後の解除で消す', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.setJobs(id, [job])
  const stop = ctx.jobs.observe(id, job.id)
  await flush()
  ctx.mock.emitJobFrame(job.id, { type: 'opened' })
  ctx.mock.emitJobFrame(job.id, { type: 'output', text: '出力' })
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.streaming, true)
  ctx.mock.emitJobFrame(job.id, { type: 'status' })
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.text, '出力')
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.streaming, false)
  stop(); await flush()
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id], undefined)
})

for (const failure of ['reject', 'error'] as const) test('R12 deliverDraftのready ' + failure + 'で参照を解放し下書きを保持する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const key = 'new:review-ready-' + failure
  writeDraft(key, { text: '残す下書き', images: [] }); t.after(() => clearDraft(key))
  const retain = ctx.sessions.retain
  t.mock.method(ctx.sessions, 'retain', (target: SessionTarget, options: SessionRetainOptions) => {
    const ref = retain(target, options)
    if (failure === 'error') ctx.mock.setSessionState(ref.sessionId, { openState: 'error', openError: { code: 'gateway/internal', message: '失敗', details: {} } })
    return failure === 'reject' ? { ...ref, ready: Promise.reject(new Error('待機失敗')) } : ref
  })
  const result = await deliverDraft({ target: { kind: 'new', workspaceId: ctx.workspaces.list.getSnapshot().items[0]!.workspaceId }, draftKey: key, sessions: ctx.sessions, mode: 'queue',
    api: { async selectModel() { throw new Error('unused') }, async listCommands() { return [] } }, handoff() { assert.fail('失敗を引き継がない') } })
  assert.ok(result.error)
  assert.ok(result.createdId)
  assert.equal(ctx.sessions.retainInfo(result.createdId!).getSnapshot().referenceCount, 0)
  assert.equal(readDraft('session:' + result.createdId).text, '残す下書き')
})

test('R12 idsにない子も完了通知で未読になりdeliveryとrenameの一時参照では既読にならない', t => {
  const base = createMockContext(); t.after(() => base.dispose())
  const child = { id: 'child', parentId: id, origin: 'subagent' as const, displayTitle: '子', running: false, blank: false, updatedAt: 0, retainedBy: {} }
  const list = observable<SessionListState>({ phase: 'ready', ids: [], byId: { child }, projectionsBySession: {} })
  let notify!: (id: string, running: boolean) => void
  const ctx = { ...base, sessions: { ...base.sessions, list }, remote: { $on(_event: string, handler: typeof notify) { notify = handler; return () => {} } } }
  const state = completionStatus(ctx); t.after(() => state.dispose())
  notify('child', true); notify('child', false)
  assert.equal(state.getSnapshot().byId.child?.completionUnread, true)
  for (const source of ['m3e.delivery', 'm3e.rename']) {
    list.set({ ...list.getSnapshot(), byId: { child: { ...child, retainedBy: { [source]: 1 } } } })
    assert.equal(state.getSnapshot().byId.child?.completionUnread, true)
  }
  list.set({ ...list.getSnapshot(), byId: { child: { ...child, retainedBy: { 'm3e.mainView': 1 } } } })
  assert.equal(state.getSnapshot().byId.child?.completionUnread, false)
})

test('R12 inboxの未到着・画像のみ・異なるRPC ID・非userのnext-turnを保つ', () => {
  assert.deepEqual(queueFromInbox(undefined), [])
  const rows = queueFromInbox({ 'next-turn': [
    { ...message('image-id'), content: [{ type: 'image', attachment: imageAttachment }] },
    { ...message('system-id'), source: { kind: 'system' } },
  ], 'next-step': [] })
  assert.deepEqual(rows.map(row => [row.id, row.rpcId, row.text]), [['image-id', 'rpc-image-id', ''], ['system-id', undefined, 'system-id']])
  assert.equal(rows[0]?.content[0]?.type, 'image')
})

test('R12 ジョブ一覧取得失敗の後の新しい購読を古い解除が消さない', async t => {
  let fail = true
  const ctx = createMockContext({ readJobRows: async () => fail ? { ok: false, error: { code: 'gateway/internal', message: '失敗', details: {} } } : { ok: true, value: [job] } }); t.after(() => ctx.dispose())
  const old = ctx.jobs.watchRows(id); await flush()
  assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
  fail = false
  const fresh = ctx.jobs.watchRows(id); await flush()
  old(); old(); await flush()
  assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.length, 1)
  fresh(); await flush()
  assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
})

test('R12 ジョブ再接続は現在の購読を再取得し旧要求の後着を無視する', async t => {
  const old = deferred<RemoteResult<readonly SessionJob[]>>(), next = deferred<RemoteResult<readonly SessionJob[]>>()
  let reads = 0
  const ctx = createMockContext({ readJobRows: () => ++reads === 1 ? old.promise : next.promise }); t.after(() => ctx.dispose())
  ctx.jobs.watchRows(id)
  await reconnect(ctx)
  assert.equal(reads, 2)
  next.resolve({ ok: true, value: [{ ...job, label: '再接続後' }] }); await flush()
  old.resolve({ ok: true, value: [{ ...job, label: '旧接続' }] }); await flush()
  assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.[0]?.label, '再接続後')
})

test('R1 作り直した入力画面への引き継ぎを古い画面の解除が消さない', () => {
  const calls: string[] = []
  const old = registerDeliveryDestination('draft', () => calls.push('old'))
  const next = registerDeliveryDestination('draft', () => calls.push('new'))
  old()
  handoffDeliveryDestination('draft', {} as SessionReference)
  next()
  handoffDeliveryDestination('draft', {} as SessionReference)
  assert.deepEqual(calls, ['new'])
})
