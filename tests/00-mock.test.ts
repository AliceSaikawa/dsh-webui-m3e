import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { imageBase64, MOCK_IDS, readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import type { PendingSubmissionRetirement, SessionWireEvent } from '../web/src/dsh/services.ts'

test('共有の 3 ワークスペースと Canvas の 2 履歴を実物の controller 契約で公開する', () => {
  const ctx = createMockContext()
  try {
    assert.deepEqual(ctx.workspaces.list.getSnapshot().items.map((item) => item.title), ['dsh-webui-m3e', 'deepseek-harness', 'notes'])
    assert.equal(ctx.sessions.list.getSnapshot().ids.length, 2)
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.readme)!
    assert.equal(ctx.sessions.sessionOf(ctx.sessions.scope(binding.sessionId)), binding.session)
    assert.equal(ctx.sessions.scopeOf(binding.ctx), binding.sessionId)
    assert.equal(binding.session.getSnapshot().running, false)
    const journal = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.deepEqual(journal.records, readmeRecords)
    assert.equal(journal.stream, null)
    const failed = journal.records.find((event) => event.type === 'tool/result' && JSON.stringify(event.data).includes('EXIT_1'))!
    const data = failed.data as { message: { role: string; content: { type: string; isError: boolean }[] } }
    assert.equal(data.message.role, 'user')
    assert.equal(data.message.content[0]!.type, 'tool-result')
    assert.equal(data.message.content[0]!.isError, true)
    const running = ctx.sessions.binding(MOCK_IDS.sessions.approval)!
    assert.equal(running.session.getSnapshot().running, true)
    assert.equal(foldSessionWindow(running.eventSource.getSnapshot()).stream?.turn, 3)
    assert.throws(() => ctx.mock.addSession(ctx.sessions.list.getSnapshot().byId[binding.sessionId]!, []), /重複/)
  } finally { ctx.dispose() }
})

test('送信前の echo は prompt による観測時に 1 回だけ退役し、履歴が重複しない', async () => {
  const ctx = createMockContext()
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.readme)!
    const retirements: PendingSubmissionRetirement[] = []
    const submission = binding.session.beginSubmission({ mode: 'queue', text: '確認しました', attachments: [], onRetire: (value) => retirements.push(value) })
    assert.equal(binding.session.getSnapshot().pendingSubmissions[0]?.placement, 'transcript')
    assert.equal((await binding.session.prompt([{ type: 'text', text: '確認しました' }, { type: 'image', mediaType: 'image/png', data: imageBase64, name: '確認.png' }], 'queue', undefined, submission.requestId)).ok, true)
    submission.abandon()
    assert.equal(retirements.length, 1)
    const retirement = retirements[0]!
    assert.equal(retirement.reason, 'observed')
    if (retirement.reason === 'observed') {
      assert.equal(retirement.attachments[0]?.name, '確認.png')
      const image = await binding.session.readAttachment(retirement.attachments[0]!.attachmentId)
      assert.equal(image.ok, true)
      if (image.ok) assert.equal(Buffer.from(image.value.data).toString('base64'), imageBase64)
    }
    assert.equal(binding.session.getSnapshot().pendingSubmissions.length, 0)
    assert.equal(foldSessionWindow(binding.eventSource.getSnapshot()).records.filter((row) => row.type === 'user/message' && JSON.stringify(row.data).includes('確認しました')).length, 1)
    await binding.session.cancel()
  } finally { ctx.dispose() }
})

test('実行中の送信は queue に入り、編集・削除・割り込みできる', async () => {
  const ctx = createMockContext()
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.approval)!
    const initialCount = foldSessionWindow(binding.eventSource.getSnapshot()).records.length
    await binding.session.prompt([{ type: 'text', text: '待機するメッセージ' }], 'queue')
    const queued = binding.session.getSnapshot().queue[0]!
    assert.equal(queued.placement, 'queued')
    assert.equal(foldSessionWindow(binding.eventSource.getSnapshot()).records.length, initialCount)
    await binding.session.updateQueue(queued.id, { kind: 'edit', content: [{ type: 'text', text: '編集したメッセージ' }] })
    assert.equal(binding.session.getSnapshot().queue[0]?.text, '編集したメッセージ')
    await binding.session.updateQueue(queued.id, { kind: 'steer' })
    assert.equal(binding.session.getSnapshot().queue.length, 0)
    assert.ok(foldSessionWindow(binding.eventSource.getSnapshot()).records.some((event) => event.type === 'user/message' && JSON.stringify(event.data).includes('編集したメッセージ')))
    await binding.session.prompt([{ type: 'text', text: '削除するメッセージ' }], 'queue')
    await binding.session.updateQueue(binding.session.getSnapshot().queue[0]!.id, { kind: 'remove' })
    assert.equal(binding.session.getSnapshot().queue.length, 0)
    await binding.session.cancel()
  } finally { ctx.dispose() }
})

test('キャンセルは待機列を保持し、その後に先頭のメッセージを開始する', async () => {
  const ctx = createMockContext()
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.approval)!
    await binding.session.prompt([{ type: 'text', text: '次の仕事' }], 'queue')
    await binding.session.cancel()
    assert.equal(binding.session.getSnapshot().running, false)
    assert.equal(binding.session.getSnapshot().queue.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(binding.session.getSnapshot().queue.length, 0)
    assert.equal(binding.session.getSnapshot().running, true)
    assert.ok(foldSessionWindow(binding.eventSource.getSnapshot()).records.some((event) => JSON.stringify(event.data).includes('次の仕事')))
  } finally { ctx.dispose() }
})

test('ストリームの再接続 baseline を置き換えても応答が重複せず確定する', async () => {
  const ctx = createMockContext()
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.readme)!
    const text = '再接続後も一度だけ表示します。'
    const done = ctx.mock.streamAssistant(binding.sessionId, text, { chunkMs: 30 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    const before = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.ok(before.stream?.content.length)
    ctx.connection.reconnect()
    assert.equal(ctx.connection.state.getSnapshot(), 'connecting')
    await done
    assert.equal(ctx.connection.state.getSnapshot(), 'connected')
    const after = foldSessionWindow(binding.eventSource.getSnapshot())
    assert.equal(after.stream, null)
    assert.equal(after.records.filter((event) => event.type === 'assistant/message' && JSON.stringify(event.data).includes(text)).length, 1)
    assert.equal(binding.session.getSnapshot().running, false)
  } finally { ctx.dispose() }
})

test('ページングは既存履歴に古い記録を継ぎ足し、loadThrough で必要な位置まで読む', async () => {
  const ctx = createMockContext({ pageSize: 4 })
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.readme)!
    assert.equal(binding.session.getSnapshot().hasMore, true)
    await binding.session.loadOlder()
    assert.equal(binding.eventSource.getSnapshot().change.kind, 'prepend')
    await binding.session.loadThrough(0)
    assert.deepEqual(foldSessionWindow(binding.eventSource.getSnapshot()).records, readmeRecords)
    assert.equal(binding.session.getSnapshot().hasMore, false)
    assert.equal(binding.session.getSnapshot().loadingOlder, false)
  } finally { ctx.dispose() }
})

test('projection は安定した observable を持ち、rename と command は一覧・履歴へ反映する', async () => {
  const ctx = createMockContext()
  try {
    const binding = ctx.sessions.binding(MOCK_IDS.sessions.readme)!
    const projection = binding.session.projections.faceOf('goal')
    assert.equal(projection, binding.session.projections.faceOf('goal'))
    let notifications = 0
    const stop = projection.subscribe(() => { notifications++ })
    ctx.mock.setProjection(binding.sessionId, 'goal', { phase: 'active' })
    assert.deepEqual(projection.getSnapshot(), { phase: 'active' })
    assert.equal(notifications, 1)
    stop()
    await binding.session.rename('見直し完了')
    assert.equal(ctx.sessions.list.getSnapshot().byId[binding.sessionId]?.displayTitle, '見直し完了')
    assert.deepEqual(await binding.session.command('/plan'), { ok: true, value: { matched: true } })
    assert.deepEqual(binding.session.projections.faceOf('plan').getSnapshot(), { active: true, pending: false })
    assert.equal(foldSessionWindow(binding.eventSource.getSnapshot()).records.at(-1)?.type, 'command/done')
  } finally { ctx.dispose() }
})

test('切断・接続中・独自シナリオを選び、切断時の送信エラーと echo 退役を通知する', async () => {
  const ctx = createMockContext({ scenario: 'disconnected' })
  try {
    assert.equal(ctx.connection.state.getSnapshot(), 'disconnected')
    const session = ctx.sessions.binding(MOCK_IDS.sessions.readme)!.session
    const retirement: PendingSubmissionRetirement[] = []
    const pending = session.beginSubmission({ mode: 'queue', text: '送信', attachments: [], onRetire: (value) => retirement.push(value) })
    const result = await session.prompt([{ type: 'text', text: '送信' }], 'queue', undefined, pending.requestId)
    assert.equal(result.ok, false)
    assert.deepEqual(retirement, [{ reason: 'failed' }])
    assert.equal(session.getSnapshot().promptError?.error.code, 'connection/disconnected')
  } finally { ctx.dispose() }
  const reconnecting = createMockContext({ scenario: 'reconnecting' })
  assert.equal(reconnecting.connection.state.getSnapshot(), 'connecting')
  reconnecting.dispose()
  const custom = createMockContext({ scenario: 'custom', extensions: [{ extendMock(kit) { kit.scenario('custom', () => kit.updateList((state) => { state.jobsBySession = { sample: [] } })) } }] })
  assert.deepEqual(custom.sessions.list.getSnapshot().jobsBySession, { sample: [] })
  custom.dispose()
})

test('機能の拡張が remote・イベント waterfall・関数差し替えを使える', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock(kit) { kit.addRemote('demo', { available: true }); kit.patch('sessions.search', async () => ({ ok: true, value: { items: [], hasMore: false } })) } }] })
  try {
    assert.deepEqual(ctx.remote.demo, { available: true })
    const on = ctx.remote.$on as (event: string, handler: (this: unknown, payload: unknown) => unknown) => () => void
    let eventSession: string | undefined
    const stop = on('approval/request', function () { eventSession = ctx.sessions.scopeOf(this); return 'allowed-once' })
    assert.equal(await ctx.mock.emit('approval/request', { agent: MOCK_IDS.sessions.readme }, { afterMs: 0 }), 'allowed-once')
    assert.equal(eventSession, MOCK_IDS.sessions.readme)
    stop()
    let ordinaryEvents = 0
    on('api-session/status', () => { ordinaryEvents++ })
    on('api-session/status', () => { ordinaryEvents++ })
    await ctx.mock.emit('api-session/status', { agent: MOCK_IDS.sessions.readme })
    assert.equal(ordinaryEvents, 2)
    assert.deepEqual(await ctx.sessions.search('README', new AbortController().signal), { ok: true, value: { items: [], hasMore: false } })
    assert.throws(() => ctx.mock.patch('__proto__.bad', 1), /不正/)
  } finally { ctx.dispose() }
})

test('セッション追加・分岐・ワークスペース操作は共通の履歴を変更しない', async () => {
  const ctx = createMockContext()
  try {
    const workspace = await ctx.workspaces.create({ path: '/mock/example' })
    const sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
    assert.equal(ctx.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspace.workspaceId)?.sessionIds[0], sessionId)
    const fork = await ctx.sessions.fork({ sessionId: MOCK_IDS.sessions.readme, atSeq: 5 })
    const events = foldSessionWindow(ctx.sessions.binding(fork)!.eventSource.getSnapshot()).records
    assert.equal(events.length, 6)
    assert.deepEqual(foldSessionWindow(ctx.sessions.binding(MOCK_IDS.sessions.readme)!.eventSource.getSnapshot()).records, readmeRecords)
    await ctx.workspaces.archiveSession(fork)
    assert.ok(ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(fork))
    await ctx.workspaces.insertSessionBefore(workspace.workspaceId, fork, sessionId)
    assert.equal(ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(fork), false)
    const attachment = await ctx.sessions.binding(MOCK_IDS.sessions.readme)!.session.readAttachment('mock-readme-image')
    assert.equal(attachment.ok, true)
    if (attachment.ok) assert.ok(attachment.value.data.length > 0)
  } finally { ctx.dispose() }
})

test('全偽履歴のメッセージは JSON として保存できる', () => {
  const ctx = createMockContext()
  try {
    const records: SessionWireEvent[] = []
    for (const sessionId of ctx.sessions.list.getSnapshot().ids) records.push(...foldSessionWindow(ctx.sessions.binding(sessionId)!.eventSource.getSnapshot()).records)
    assert.deepEqual(JSON.parse(JSON.stringify(records)), records)
  } finally { ctx.dispose() }
})
