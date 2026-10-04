import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { imageBase64, MOCK_IDS, readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { lifecycle, observable } from '../web/src/dsh/mock/observable.ts'
import type { MockQuestionProjection, MockUserQuestionsRemote } from '../web/src/dsh/mock/kit.ts'
import type { SessionWireEvent, SessionJob, RemoteResult, AgentContext, PendingSubmissionRetirement } from '../web/src/dsh/services.ts'
import { buildChatRows } from '../web/src/features/chat/model.ts'
import { promptOutcomeIsUnknown } from '../web/src/features/composer/delivery-status.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'

const id = MOCK_IDS.sessions.readme
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const event = (type: string, seq: number, data: unknown): SessionWireEvent => ({ type, seq, time: seq, data: data as never, ...(['user/message', 'assistant/message', 'tool/result'].includes(type) ? { surfaceOp: 'append' as const } : {}) })
const message = (seq: number, rpcId: string, kind = 'user') => event('user/message', seq, { id: `m${seq}`, role: 'user', source: { kind, rpcId }, content: [{ type: 'text', text: '同じ本文' }] })
function child(ctx: ReturnType<typeof createMockContext>, childId = 'child', parentId: string = id, live = false) {
  ctx.mock.addSession({ id: childId, parentId, origin: 'subagent', displayTitle: childId, running: live, blank: false, updatedAt: 1 }, [message(0, 'original')], { agentAvailable: live })
  ctx.mock.setProjection(parentId, 'subagentCatalog', [{ id: childId, mode: 'continuable', label: childId, createdAt: 0 }])
  return { parentSessionId: parentId, childSessionId: childId, mode: 'continuable' as const }
}
const on = (ctx: ReturnType<typeof createMockContext>, name: string, handler: (this: AgentContext, ...args: any[]) => unknown) => (ctx.remote.$on as Function)(name, handler)

test('S6A01 確定とpendingの重複は本文でなくuserのrpcIdで除く', () => {
  const pending = ['same', 'other', 'injected'].map(requestId => ({ requestId, placement: 'transcript' as const, text: '同じ本文', time: 0, attachments: [] }))
  const rows = buildChatRows([message(0, 'same'), message(1, 'injected', 'system')], null, pending)
  assert.equal(rows.filter(row => row.kind === 'user').length, 1)
  assert.deepEqual(rows.filter(row => row.kind === 'pending').map(row => row.submission.requestId), ['other', 'injected'])
})

test('S6A02 記録の同期観測から次フレームまでechoを残し描画行は一件', async t => {
  const frames: (() => void)[] = [], retired: PendingSubmissionRetirement[] = []
  const ctx = createMockContext({ scheduleFrame: callback => frames.push(callback) }); t.after(() => ctx.dispose())
  const binding = await ctx.sessions.retain(id, { source: 'test' }).ready
  const handle = binding.session.beginSubmission({ text: '同じ本文', attachments: [], mode: 'queue', onRetire: value => retired.push(value) })
  let overlap = false
  const counts: number[] = []
  binding.eventSource.subscribe(() => {
    const records = foldSessionWindow(binding.eventSource.getSnapshot()).records
    const pending = binding.session.getSnapshot().pendingSubmissions
    const durable = records.some(e => e.type === 'user/message' && (e.data as any).source?.rpcId === handle.requestId)
    if (durable && pending.length) {
      overlap = true
      counts.push(buildChatRows(records, null, pending).filter(row => (row.kind === 'user' || row.kind === 'pending') && row.text === '同じ本文').length)
    }
  })
  await binding.session.prompt([{ type: 'text', text: '同じ本文' }], 'queue', undefined, handle.requestId)
  assert.equal(overlap, true); assert.equal(retired.length, 0); assert.ok(counts.length > 0); assert.equal(Math.max(...counts), 1)
  assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 1)
  frames.splice(0).forEach(frame => frame())
  assert.deepEqual(retired, [{ reason: 'observed', attachments: [] }])
  assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 0)
})

test('S6A03 Inboxで観測したqueued echoも次フレームで一度だけ退役', async t => {
  const frames: (() => void)[] = []
  const ctx = createMockContext({ scheduleFrame: callback => frames.push(callback) }); t.after(() => ctx.dispose())
  const face = (await ctx.sessions.retain(MOCK_IDS.sessions.approval, { source: 'test' }).ready).session
  const handle = face.beginSubmission({ mode: 'queue', text: '待機', attachments: [] })
  await face.prompt([{ type: 'text', text: '待機' }], 'queue', undefined, handle.requestId)
  assert.equal(face.getSnapshot().pendingSubmissions.length, 1)
  assert.equal((face.projections.faceOf('inbox').getSnapshot() as any)['next-turn'][0].source.rpcId, handle.requestId)
  assert.equal(frames.length, 1); frames[0]!()
  assert.equal(face.getSnapshot().pendingSubmissions.length, 0)
})

test('S6A04 一覧到着前の通知は履歴を開かずagentをContextへ変換する', async t => {
  let opens = 0
  const ctx = createMockContext({ openSession: async () => { opens++; return { ok: true, value: null } } }); t.after(() => ctx.dispose())
  const reply = deferred<string>()
  let received: AgentContext | undefined
  on(ctx, 'approval/request', function(request) {
    received = request.agent
    assert.equal(request.agent, this)
    assert.equal(ctx.sessions.scopeOf(request.agent), 'not-listed')
    assert.equal(ctx.sessions.sessionOf(this)!.getSnapshot().openState, 'cold')
    return reply.promise
  })
  const pending = ctx.mock.emit('approval/request', { agent: 'not-listed' })
  assert.equal(opens, 0)
  assert.deepEqual(ctx.sessions.retainInfo('not-listed').getSnapshot().retainedBy, { gateway: 1 })
  ctx.mock.addSession({ id: 'not-listed', displayTitle: '到着', running: false, blank: false, updatedAt: 0 }, [message(0, 'saved')])
  assert.equal(ctx.sessions.scope('not-listed'), received)
  reply.resolve('allowed-once'); assert.equal(await pending, 'allowed-once')
  assert.equal(ctx.sessions.retainInfo('not-listed').getSnapshot().referenceCount, 0)
  assert.equal(ctx.mock.getRecords('not-listed').length, 1)
})

test('S6A05 接続世代の終了は未回答通知のsignalとscopeを取り消す', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  let signal!: AbortSignal
  on(ctx, 'approval/request', request => { signal = request.signal; return new Promise(() => {}) })
  const pending = ctx.mock.emit('approval/request', { agent: id })
  assert.equal(signal.aborted, false)
  ctx.connection.reconnect()
  assert.equal(signal.aborted, true)
  assert.equal(await pending, undefined)
  assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 0)
})

test('S6A06 子のwire idは別物であり親の保存とAgent可用性を分離する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const address = child(ctx)
  assert.equal(ctx.sessions.list.getSnapshot().ids.includes('child'), false)
  assert.ok(ctx.sessions.list.getSnapshot().byId.child)
  const binding = await ctx.sessions.retain(address, { source: 'test' }).ready
  const handle = binding.session.beginSubmission({ mode: 'queue', text: '子への送信', attachments: [] })
  await binding.session.prompt([{ type: 'text', text: '子への送信' }], 'queue', undefined, handle.requestId)
  const sent = ctx.mock.getRecords('child').filter(e => e.type === 'user/message').at(-1)!
  assert.notEqual((sent.data as any).source.rpcId, handle.requestId)
  assert.equal(binding.session.getSnapshot().pendingSubmissions[0]?.requestId, handle.requestId)
  ctx.mock.setAgentAvailable('child', false)
  assert.equal(binding.session.getSnapshot().removed, false)
  assert.ok(ctx.mock.getRecords('child').length > 1)
  assert.deepEqual(foldSessionWindow(binding.eventSource.getSnapshot()).records, ctx.mock.getRecords('child'))
  const before = ctx.mock.getRecords('child')
  ctx.mock.setAgentAvailable(id, false)
  assert.ok(ctx.sessions.list.getSnapshot().byId[id])
  assert.equal(binding.session.getSnapshot().subagent?.parentAvailable, false)
  const result = await binding.session.prompt([{ type: 'text', text: '親は停止済み' }], 'queue')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'subagent/parent-unavailable')
  assert.deepEqual(ctx.mock.getRecords('child'), before)
})

test('S6A07 retainの履歴待ちと受付後の初回turn待ちは独立しopen失敗も公開する', async t => {
  const opened = deferred<RemoteResult<null>>(), turn = deferred<void>()
  const ctx = createMockContext({ openSession: () => opened.promise, beforeFirstTurn: () => turn.promise }); t.after(() => ctx.dispose())
  const newId = await ctx.sessions.create()
  const reference = ctx.sessions.retain(newId, { source: 'test' })
  assert.equal(reference.binding.session.getSnapshot().openState, 'loading')
  assert.deepEqual(reference.binding.eventSource.getSnapshot().entries, [])
  let ready = false; void reference.ready.then(() => { ready = true })
  await flush(); assert.equal(ready, false)
  opened.resolve({ ok: true, value: null }); const { session } = await reference.ready
  assert.equal(session.getSnapshot().openState, 'open')
  const result = await session.prompt([{ type: 'text', text: '初回' }], 'queue')
  assert.equal(result.ok, true); assert.equal(session.getSnapshot().awaitingFirstTurn, true)
  turn.resolve(); await flush(); assert.equal(session.getSnapshot().awaitingFirstTurn, false)
  const failed = createMockContext({ openSession: async () => ({ ok: false, error: { code: 'gateway/internal', message: '読込失敗', details: {} } }) }); t.after(() => failed.dispose())
  const bad = await failed.sessions.retain(id, { source: 'test' }).ready
  assert.equal(bad.session.getSnapshot().openState, 'error'); assert.equal(bad.session.getSnapshot().openError?.code, 'gateway/internal')
  assert.deepEqual(bad.eventSource.getSnapshot().entries, [])
})

test('S6A08 切断・取消・受付後応答喪失は実物のコードで届いたか不明の分岐へ入る', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const face = (await ctx.sessions.retain(id, { source: 'test' }).ready).session
  for (const cancel of [false, true]) {
    ctx.mock.setConnectionState(cancel ? 'connected' : 'disconnected')
    const result = await face.prompt([{ type: 'text', text: '不明' }], 'queue', cancel ? AbortSignal.abort() : undefined)
    assert.equal(result.ok, false)
    if (!result.ok) { assert.equal(result.error.code, cancel ? 'gateway/cancelled' : 'gateway/internal'); assert.equal(promptOutcomeIsUnknown(new RemoteCallError(result.error)), true) }
  }
  assert.deepEqual(ctx.mock.getRecords(id), readmeRecords)
  const lost = createMockContext({ promptResponse: async () => ({ ok: false, error: { code: 'gateway/internal', message: '応答喪失', details: {} } }) }); t.after(() => lost.dispose())
  const result = await (await lost.sessions.retain(id, { source: 'test' }).ready).session.prompt([{ type: 'text', text: '受付済み' }], 'queue')
  assert.equal(result.ok, false)
  assert.ok(lost.mock.getRecords(id).some(e => JSON.stringify(e.data).includes('受付済み')))
  const search = await ctx.sessions.search('x', AbortSignal.abort())
  assert.equal(search.ok, false); if (!search.ok) assert.equal(search.error.code, 'gateway/cancelled')
})

test('S6A09 archiveは稼働中の子孫と自分のjobだけを拒否・停止する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  child(ctx, 'child', id, true); child(ctx, 'grandchild', 'child', true)
  const job = (name: string, owner?: string): SessionJob => ({ id: name, owner, kind: 'bash', label: name, status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } })
  ctx.mock.setJobs(id, [job('owned', id), job('unowned')])
  const fork = await ctx.sessions.fork({ sessionId: id }); ctx.mock.setSessionState(fork, { running: true })
  await assert.rejects(ctx.workspaces.archiveSession(id), /workspace\/session-active/)
  await ctx.workspaces.archiveSession(id, { stopActivity: true })
  for (const name of ['child', 'grandchild']) assert.equal(ctx.sessions.list.getSnapshot().byId[name]?.running, false)
  assert.equal(ctx.sessions.list.getSnapshot().byId[fork]?.running, true)
  ctx.jobs.watchRows(id); await flush()
  assert.deepEqual(ctx.jobs.state.getSnapshot().rows[id]?.map(row => row.status), ['killed', 'running'])
  await ctx.workspaces.unarchiveSession(id); await ctx.workspaces.archiveSession(id)
})

const image = { type: 'image' as const, mediaType: 'image/png' as const, data: imageBase64 }
for (const [reason, parts, limits] of [
  ['INVALID_IMAGE_BASE64', [{ ...image, data: '' }], {}],
  ['INVALID_IMAGE_BASE64', [{ ...image, data: imageBase64 + '\n' }], {}],
  ['INVALID_IMAGE', [{ ...image, data: btoa('not an image') }], {}],
  ['IMAGE_TYPE_MISMATCH', [{ ...image, mediaType: 'image/jpeg' }], {}],
  ['UNSUPPORTED_IMAGE_TYPE', [{ ...image, mediaType: 'image/svg+xml' }], {}],
  ['TOO_MANY_IMAGES', [image, image], { maxImagesPerMessage: 1 }],
  ['IMAGES_TOO_LARGE', [image], { maxMessageImageBytes: 1 }],
  ['IMAGE_TOO_LARGE', [image], { maxImageBytes: 1 }],
] as const) test(`S6A10 画像受付 ${reason} ${JSON.stringify(limits) || ''} ${parts[0].data.length}`, async t => {
  const ctx = createMockContext({ imageLimits: limits }); t.after(() => ctx.dispose())
  const face = (await ctx.sessions.retain(id, { source: 'test' }).ready).session
  const result = await face.prompt(parts as any, 'queue')
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.error.code, 'session/attachment-invalid'); assert.equal(result.error.details.reason, reason) }
  assert.deepEqual(ctx.mock.getRecords(id), readmeRecords)
})

test('S6A11 jobの出力は所有者なし・正しい所有者・別所有者を区別する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  for (const owner of [id, undefined]) {
    const job: SessionJob = { id: `job-${owner}`, owner, kind: 'bash', label: '処理', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }
    ctx.mock.setJobs(id, [job])
    for (const caller of [undefined, id, 'other']) {
      const stop = ctx.jobs.observe(caller, job.id); await flush()
      assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.streaming, owner === undefined || owner === caller)
      stop(); await flush()
    }
  }
})

test('S6A12 forkは未開始と開始済みtoolを区別してstepとturnを閉じる', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const records = [event('turn/start', 0, { turn: 1 }), event('step/start', 1, { turn: 1, step: 1 }), event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'started' }, { type: 'tool-call', id: 'waiting' }] } }), event('tool/call', 3, { callId: 'started' })]
  ctx.mock.addSession({ id: 'fork-source', displayTitle: '分岐元', running: true, blank: false, updatedAt: 0 }, records)
  const fork = await ctx.sessions.fork({ sessionId: 'fork-source', atSeq: 3 })
  const seed = ctx.mock.getRecords(fork)
  assert.deepEqual(seed.slice(0, 4), records)
  assert.deepEqual(seed.slice(4).map(e => e.type), ['session/end-seed', 'tool/result', 'tool/result', 'step/end', 'turn/end'])
  assert.deepEqual(seed.slice(5, 7).map(e => (e.data as any).error.code), ['TOOL_OUTCOME_UNKNOWN', 'TOOL_NOT_STARTED'])
  assert.deepEqual(seed[5]?.sourceEventSeqs, [3]); assert.equal(seed[6]?.sourceEventSeqs, undefined)
  assert.deepEqual(seed.at(-1)?.data, { turn: 1, reason: { kind: 'forked' } })
})

test('S6A13 fork作成後のrename失敗は作成済みidを残して拒否する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  let created = ''
  await assert.rejects(ctx.sessions.fork({ sessionId: id, increaseTitle: true, onCreated(value) {
    created = value
    const face = ctx.sessions.retain(value, { source: 'test' }).binding.session
    face.rename = async () => ({ ok: false, error: { code: 'gateway/internal', message: '題名変更失敗', details: {} } })
  } }), /fork child rename failed: gateway\/internal/)
  assert.ok(created); assert.ok(ctx.sessions.list.getSnapshot().byId[created])
})

test('S6A14 通常会話の開いた履歴から再接続後に投影を復元する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const binding = await ctx.sessions.retain(id, { source: 'test' }).ready
  ctx.mock.setProjection(id, 'plan', { active: true, pending: false })
  ctx.connection.reconnect(); t.mock.timers.tick(400); await flush()
  assert.deepEqual(binding.session.projections.faceOf('plan').getSnapshot(), { active: true, pending: false })
  assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.state, 'ready')
})

test('S6A15 検索はイベントを跨がず最強一致の抜粋を240 code pointにする', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const add = (name: string, texts: string[]) => ctx.mock.addSession({ id: name, cwd: '/mock', displayTitle: name, running: false, blank: false, updatedAt: 0 }, texts.map((text, i) => event('user/message', i, { content: [{ type: 'text', text }] })))
  add('cross', ['first', 'second']); add('weak', ['needle']); add('strong', ['needle needle ' + '😀'.repeat(300)])
  assert.deepEqual(await ctx.sessions.search('first\nsecond', new AbortController().signal), { ok: true, value: { items: [], hasMore: false } })
  const result = await ctx.sessions.search('needle', new AbortController().signal)
  assert.equal(result.ok, true)
  if (result.ok) { assert.deepEqual(result.value.items.map(item => item.sessionId), ['strong', 'weak']); assert.equal(Array.from(result.value.items[0]!.snippet).length, 240); assert.ok(result.value.items[0]!.snippet.endsWith('😀')) }
})

test('S6A16 lifecycleは通知をまとめ例外を隔離しeventSourceは同期のまま', async t => {
  const log = t.mock.method(console, 'error', () => {})
  const state = lifecycle(0), events = observable(0), seen: number[] = []
  state.subscribe(() => { throw new Error('observer failure') }); state.subscribe(() => seen.push(state.getSnapshot()))
  state.set(1); state.set(2); assert.deepEqual(seen, []); assert.equal(state.getSnapshot(), 2)
  await flush(); assert.deepEqual(seen, [2]); assert.equal(log.mock.callCount(), 1)
  let sync = 0; events.subscribe(() => sync++); events.set(1); events.set(2); assert.equal(sync, 2)
})

test('S6A17 接続前と破棄後のstateはundefinedで放送にはnextを足さない', async t => {
  const ctx = createMockContext({ scenario: 'unconnected' }); t.after(() => ctx.dispose())
  assert.equal(ctx.connection.state.getSnapshot(), undefined)
  const args: unknown[][] = []
  on(ctx, 'commands/change', (...received) => args.push(received))
  await ctx.mock.emit('commands/change'); await ctx.mock.emit('commands/change', 'session', { additionalArgs: [true] })
  assert.deepEqual(args, [[], ['session', true]])
  ctx.mock.setConnectionState('connected'); ctx.dispose(); assert.equal(ctx.connection.state.getSnapshot(), undefined)
})

const questions = [{ id: 'q', question: '確認しますか' }], answer = { answers: [{ id: 'q', selected: ['はい'] }] }
test('S6A18 無保持の質問は期限でsignalを取り消しcontinued投影へ移る', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 })
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  let request: any
  on(ctx, 'user-questions/request', input => { request = input; return new Promise(() => {}) })
  const pending = ctx.mock.emitTimedQuestion(id, { callId: 'timed', questions, timeoutMs: 50 })
  assert.deepEqual(request.wait, { callId: 'timed', timed: true })
  assert.equal(ctx.sessions.scopeOf(request.agent), id)
  assert.equal(ctx.mock.getProjection<MockQuestionProjection>(id, 'userQuestions')?.active[0]?.state, 'open')
  t.mock.timers.tick(50); await flush()
  assert.deepEqual(await pending, { pending: true, callId: 'timed' })
  assert.equal(request.signal.aborted, true)
  assert.equal(ctx.mock.getProjection<MockQuestionProjection>(id, 'userQuestions')?.active[0]?.state, 'continued')
})

test('S6A19 attachWaitは期限を保持しdisposeと切断で解放する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 })
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  on(ctx, 'user-questions/request', () => new Promise(() => {}))
  const rpc = ctx.remote.userQuestions as MockUserQuestionsRemote
  for (const finish of ['dispose', 'disconnect']) {
    const pending = ctx.mock.emitTimedQuestion(id, { callId: finish, questions, timeoutMs: 50 })
    const stream = rpc.attachWait(id, finish, new AbortController().signal)
    const iterator = stream[Symbol.asyncIterator]()
    assert.deepEqual(await iterator.next(), { done: false, value: { remainingMs: 50 } })
    t.mock.timers.tick(100); await flush()
    assert.equal(ctx.mock.getProjection<MockQuestionProjection>(id, 'userQuestions')?.active.find(q => q.callId === finish)?.state, 'open')
    const end = iterator.next()
    if (finish === 'dispose') stream.dispose(); else ctx.mock.setConnectionState('disconnected')
    await end; t.mock.timers.tick(0); await flush()
    assert.deepEqual(await pending, { pending: true, callId: finish })
    ctx.mock.setConnectionState('connected')
  }
})

test('S6A20 期限内回答と遅延回答のbatch・二重受付・記録・投影を再現する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 })
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const rpc = ctx.remote.userQuestions as MockUserQuestionsRemote
  const stop = on(ctx, 'user-questions/request', () => answer)
  assert.deepEqual(await ctx.mock.emitTimedQuestion(id, { callId: 'early', questions, timeoutMs: 50 }), answer)
  stop()
  const pending = ctx.mock.emitTimedQuestion(id, { callId: 'late', questions, timeoutMs: 50 })
  t.mock.timers.tick(50); await flush(); await pending
  assert.deepEqual(await rpc.answer(id, 'early', answer), { ok: true, value: false })
  const bad = await rpc.answer(id, 'late', { answers: [] }); assert.equal(bad.ok, false)
  assert.deepEqual(await rpc.answer(id, 'late', answer), { ok: true, value: true })
  const duplicate = await rpc.answer(id, 'late', answer); assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.match(duplicate.error.message, /REPLY_QUEUED/)
  t.mock.timers.tick(0); await flush()
  assert.deepEqual(ctx.mock.getProjection(id, 'userQuestions'), { active: [], settled: [{ callId: 'early', answers: answer.answers }, { callId: 'late', answers: answer.answers }] })
  assert.deepEqual((ctx.mock.getRecords(id).at(-1)?.data as any).source, { kind: 'user-question-reply', callId: 'late', outcome: 'answered' })
})
