import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { approvalRecords, imageBase64, MOCK_IDS, readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { createWorkspaceFilesMock } from '../web/src/features/session-tools/mock-files.ts'
import { appendFilePage, directoryChanged, directoryRequestPath, fileBreadcrumbs, fileChanged, fileRoute, readImageFile, workspaceFilesOf } from '../web/src/features/session-tools/files.ts'
import { extendMock, SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { catalogEntries, childAddress, contextPercent, hasChildren, maxTurn, menuActions, runningJobCount, type ContextPressure } from '../web/src/features/session-tools/presentation.ts'
import { goalsRemoteOf, performGoalOperation, type GoalProjection } from '../web/src/features/session-tools/operations.ts'

const sessionId = MOCK_IDS.sessions.approval

test('ファイルの偽物は相対パスと絶対パスを同じ作業フォルダに解決し、階層をたどれる', async () => {
  const { remote } = createWorkspaceFilesMock()
  const root = unwrapRemoteResult(await remote.list(sessionId, directoryRequestPath('')))
  assert.equal(root.path, '')
  assert.deepEqual(root.entries.map(entry => entry.name), ['docs', 'README.md', 'preview.png', 'sample.bin', 'unknown-format', 'undecodable.data', 'too-large.txt', 'too-large.png'])
  const docs = unwrapRemoteResult(await remote.list(sessionId, 'docs'))
  assert.deepEqual(docs.entries.map(entry => entry.name), ['canvas', 'handoff.md', 'ui-spec.md'])
  assert.deepEqual(unwrapRemoteResult(await remote.list(sessionId, '/mock/dsh-webui-m3e/docs')), docs)
  assert.equal((await remote.list(sessionId, '../outside')).ok, false)
  assert.equal((await remote.list(sessionId, '/outside')).ok, false)
  assert.equal((await remote.list(sessionId, '/mock/dsh-webui-m3e-other')).ok, false)
  assert.equal((await remote.list(sessionId, 'missing')).ok, false)
  assert.equal(unwrapRemoteResult(await remote.list(sessionId, 'docs/canvas')).entries[0]?.name, 'screens.md')
  const rootCrumb = fileBreadcrumbs(docs.path)[0]!
  assert.equal(fileRoute(sessionId, 'files', rootCrumb.path), `/s/${sessionId}/files`)
  assert.deepEqual(unwrapRemoteResult(await remote.list(sessionId, directoryRequestPath(rootCrumb.path))), root)
  assert.deepEqual(unwrapRemoteResult(await remote.list(sessionId, '/mock/dsh-webui-m3e')), root)
})

test('ファイルの偽物は実物と同じく空の要求パスを拒否し、ルートの変換は一覧の RPC に限る', async () => {
  const { remote } = createWorkspaceFilesMock()
  for (const result of await Promise.all([
    remote.list(sessionId, ''), remote.stat(sessionId, ''), remote.read(sessionId, '', {}), remote.readBytes(sessionId, '', {}),
  ])) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'gateway/bad-request')
  }
  assert.equal(directoryRequestPath('docs/canvas'), 'docs/canvas')
  assert.equal(directoryRequestPath('/mock/dsh-webui-m3e'), '/mock/dsh-webui-m3e')
  assert.equal(unwrapRemoteResult(await remote.list(sessionId, '.')).path, '')
})

test('仕様の偽ファイルを 5000 行と 1000 行に分けて読むと全文を重複なく復元できる', async () => {
  const { remote } = createWorkspaceFilesMock()
  const first = unwrapRemoteResult(await remote.read(sessionId, 'docs/ui-spec.md', { offset: 1, limit: 5000 }))
  assert.equal(first.offset, 1)
  assert.equal(first.lines, 5000)
  assert.equal(first.eof, false)
  const content = appendFilePage(undefined, first)
  const last = unwrapRemoteResult(await remote.read(sessionId, 'docs/ui-spec.md', { offset: content.nextOffset, limit: 5000 }))
  assert.equal(last.offset, 5001)
  assert.equal(last.lines, 1000)
  assert.equal(last.eof, true)
  assert.equal(last.bytes, first.bytes)
  const combined = appendFilePage(content, last)
  const lines = combined.text.split('\n')
  assert.equal(lines.length, 6000)
  assert.match(lines[0]!, /^1 行目:/)
  assert.match(lines[4999]!, /^5000 行目:/)
  assert.match(lines[5000]!, /^5001 行目:/)
  assert.match(lines[5999]!, /^6000 行目:/)
  assert.equal(new TextEncoder().encode(combined.text).length, first.bytes)
})

test('偽の画像はバイト範囲で読め、バイナリの名前とサイズを取得できる', async () => {
  const { remote } = createWorkspaceFilesMock()
  const first = unwrapRemoteResult(await remote.readBytes(sessionId, 'preview.png', { offset: 0, length: 10 }))
  assert.equal(first.offset, 0)
  assert.equal(first.eof, false)
  const last = unwrapRemoteResult(await remote.readBytes(sessionId, 'preview.png', { offset: 10 }))
  assert.equal(last.offset, 10)
  assert.equal(last.eof, true)
  assert.equal(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(last.data, 'base64')]).toString('base64'), imageBase64)
  const image = await readImageFile(remote, sessionId, 'preview.png', new AbortController().signal)
  assert.equal(Buffer.from(image.data).toString('base64'), imageBase64)
  const binary = unwrapRemoteResult(await remote.stat(sessionId, 'sample.bin'))
  assert.equal(binary.bytes, 6)
  assert.equal(binary.absolutePath, '/mock/dsh-webui-m3e/sample.bin')
})

test('ファイル変更を通知し、読み直した内容と一覧のサイズ・バージョンへ反映する', async () => {
  const fixture = createWorkspaceFilesMock()
  const abort = new AbortController()
  const iterator = fixture.remote.changes(sessionId, abort.signal)[Symbol.asyncIterator]()
  const old = unwrapRemoteResult(await fixture.remote.stat(sessionId, 'README.md'))
  assert.deepEqual(await iterator.next(), { done: false, value: { kind: 'ready' } })
  const next = iterator.next()
  fixture.updateText('README.md', '# 更新しました')
  const result = await next
  assert.equal(result.done, false)
  assert.equal(result.value?.kind, 'change')
  if (result.value?.kind !== 'change') throw new Error('変更通知がありません。')
  assert.equal(fileChanged(result.value.change, old), true)
  assert.equal(directoryChanged(result.value.change, '/mock/dsh-webui-m3e', ''), true)
  assert.equal(directoryChanged(result.value.change, '/mock/dsh-webui-m3e', 'docs'), false)
  const current = unwrapRemoteResult(await fixture.remote.read(sessionId, 'README.md', {}))
  assert.equal(current.text, '# 更新しました')
  assert.notEqual(current.version, old.version)
  const entries = unwrapRemoteResult(await fixture.remote.list(sessionId, '.')).entries
  assert.equal(entries.find(entry => entry.name === 'README.md')?.size, current.bytes)
  assert.equal(fixture.subscriberCount, 1)
  const pending = iterator.next()
  abort.abort()
  assert.deepEqual(await pending, { done: true, value: undefined })
  assert.equal(fixture.subscriberCount, 0)
  fixture.updateText('README.md', '購読終了後の更新')
  assert.deepEqual(await iterator.next(), { done: true, value: undefined })
  assert.equal((await fixture.remote.read(sessionId, 'README.md', {}, abort.signal)).ok, false)
})

test('ファイル変更の購読を return または事前の中断で終了すると購読を残さない', async () => {
  const fixture = createWorkspaceFilesMock()
  const iterator = fixture.remote.changes(sessionId)[Symbol.asyncIterator]()
  await iterator.next()
  assert.equal(fixture.subscriberCount, 1)
  await iterator.return?.()
  assert.equal(fixture.subscriberCount, 0)
  const abort = new AbortController()
  abort.abort()
  const cancelled = fixture.remote.changes(sessionId, abort.signal)[Symbol.asyncIterator]()
  assert.deepEqual(await cancelled.next(), { done: true, value: undefined })
  assert.equal(fixture.subscriberCount, 0)
})

test('会話の補助画面の偽物を追加しても共有の履歴を書き換えない', () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    assert.deepEqual(foldSessionWindow(ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records, approvalRecords)
    assert.deepEqual(foldSessionWindow(ctx.sessions.retain(MOCK_IDS.sessions.readme, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records, readmeRecords)
    assert.ok(workspaceFilesOf(ctx.remote))
  } finally { ctx.dispose() }
})

test('統計 62%・ジョブ 3 件・子 2 件からメニュー全項目を描く状態を作る', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const face = ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session
    const pressure = face.projections.faceOf('contextPressure').getSnapshot() as ContextPressure
    assert.equal(contextPercent(pressure), 62)
    assert.equal(maxTurn(foldSessionWindow(ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records), 3)
    ctx.jobs.watchRows(sessionId)
    const list = ctx.sessions.list.getSnapshot()
    assert.equal(ctx.jobs.state.getSnapshot().rows[sessionId]?.length, 3)
    assert.equal(runningJobCount(ctx.jobs.state.getSnapshot().rows[sessionId]), 1)
    const catalog = list.projectionsBySession[sessionId]
    const children = catalogEntries(catalog)
    assert.equal(children.length, 2)
    assert.equal(hasChildren(sessionId, catalog, list.byId), true)
    const goal = face.projections.faceOf('goal').getSnapshot()
    assert.deepEqual(menuActions(true, goal), ['rename', 'stats', 'files', 'jobs', 'subagents', 'goal', 'archive'])
    for (const child of children) {
      assert.equal(child.kind, 'child')
      if (child.kind !== 'child') throw new Error('子の会話がありません。')
      const address = childAddress(sessionId, child)
      assert.deepEqual(ctx.sessions.retain(child.id, { source: 'm3e.test' }).binding.session.getSnapshot().subagent, { address, parentAvailable: true })
      await conversationSelection(ctx.sessions).select(address)
      assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, child.id)
      assert.deepEqual(ctx.sessions.binding(address.childSessionId)?.session.getSnapshot().subagent?.address, address)
      assert.deepEqual(ctx.sessions.retain(child.id, { source: 'm3e.test' }).binding.session.getSnapshot().subagent, { address, parentAvailable: true })
      assert.equal(list.byId[child.id]?.origin, 'subagent')
      assert.ok(foldSessionWindow(ctx.sessions.retain(child.id, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records.some(row => row.type === 'assistant/message'))
    }
    let notified = 0
    const stop = ctx.jobs.state.subscribe(() => { notified++ })
    ctx.mock.setJobs(sessionId, ctx.jobs.state.getSnapshot().rows[sessionId]!.map(job => job.id === SESSION_TOOLS_MOCK_IDS.jobs.running ? { ...job, status: 'completed', finishedAt: Date.now() } : job))
    assert.equal(notified, 1)
    assert.equal(runningJobCount(ctx.jobs.state.getSnapshot().rows[sessionId]), 0)
    stop()
  } finally { ctx.dispose() }
})

test('未取得の子シナリオはアドレスを先に設定せず、親の取得後にカタログから子を開ける', async () => {
  const ctx = createMockContext({ scenario: 'subagents-unloaded', extensions: [{ extendMock }] })
  try {
    const initial = ctx.sessions.list.getSnapshot()
    assert.equal(Object.hasOwn(initial.projectionsBySession, sessionId), false)
    for (const childId of Object.values(SESSION_TOOLS_MOCK_IDS.children)) {
      assert.equal(initial.byId[childId]?.origin, 'subagent')
      assert.equal(initial.byId[childId]?.parentId, sessionId)
      assert.equal(ctx.sessions.retain(childId, { source: 'm3e.test' }).binding.session.getSnapshot().subagent, null)
      assert.equal(ctx.sessions.subagentAddress(childId), undefined)
      assert.ok(foldSessionWindow(ctx.sessions.retain(childId, { source: 'm3e.test' }).binding.eventSource.getSnapshot()).records.some(row => row.type === 'assistant/message'))
    }
    assert.equal(hasChildren(sessionId, initial.projectionsBySession[sessionId], initial.byId), true)

    await ctx.sessions.refreshProjections(MOCK_IDS.sessions.readme)
    assert.equal(Object.hasOwn(ctx.sessions.list.getSnapshot().projectionsBySession, sessionId), false)
    await ctx.sessions.refreshProjections(sessionId)
    const catalog = ctx.sessions.list.getSnapshot().projectionsBySession[sessionId]
    assert.equal(catalog?.state, 'ready')
    const children = catalogEntries(catalog)
    assert.equal(children.length, 2)
    for (const child of children) {
      if (child.kind !== 'child') throw new Error('子の会話がありません。')
      assert.equal(ctx.sessions.binding(child.id)?.session.getSnapshot().subagent, null)
      const address = childAddress(sessionId, child)
      await conversationSelection(ctx.sessions).select(address)
      assert.deepEqual(ctx.sessions.retain(child.id, { source: 'm3e.test' }).binding.session.getSnapshot().subagent, { address, parentAvailable: true })
      assert.deepEqual(ctx.sessions.binding(address.childSessionId)?.session.getSnapshot().subagent?.address, address)
    }
    assert.deepEqual(children.map(child => child.kind === 'child' ? child.mode : undefined), ['continuable', 'one-shot'])
  } finally { ctx.dispose() }
})

test('ゴールの停止・再開・完了・消去は revision を進め、projection の購読へ反映する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = goalsRemoteOf(ctx.remote.goals)
    assert.ok(remote)
    const projection = ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.projections.faceOf('goal')
    let notifications = 0
    const stop = projection.subscribe(() => { notifications++ })
    const original = unwrapRemoteResult(await remote.get(sessionId))!
    assert.equal(original.phase, 'active')
    const paused = unwrapRemoteResult(await remote.pause(sessionId, original))
    assert.equal(paused.revision, original.revision + 1)
    assert.equal(paused.phase, 'paused')
    assert.equal((projection.getSnapshot() as GoalProjection).goal.phase, 'paused')
    const resumed = unwrapRemoteResult(await remote.resume(sessionId, paused))
    assert.equal(resumed.revision, paused.revision + 1)
    assert.equal(resumed.phase, 'active')
    const completed = unwrapRemoteResult(await remote.complete(sessionId, resumed))
    assert.equal(completed.revision, resumed.revision + 1)
    assert.equal(completed.phase, 'complete')
    assert.equal((projection.getSnapshot() as GoalProjection).goal.phase, 'complete')
    assert.equal((await remote.resume(sessionId, completed)).ok, false)
    const removed = unwrapRemoteResult(await remote.clear(sessionId, completed))
    assert.deepEqual(removed, { id: original.id, revision: completed.revision + 1 })
    assert.equal(projection.getSnapshot(), null)
    assert.equal(unwrapRemoteResult(await remote.get(sessionId)), undefined)
    assert.equal(notifications, 4)
    stop()
  } finally { ctx.dispose() }
})

test('古い GoalRef は状態を変えず拒否し、再読み込みだけで現在のゴールを取得する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = goalsRemoteOf(ctx.remote.goals)!
    const original = unwrapRemoteResult(await remote.get(sessionId))!
    const paused = unwrapRemoteResult(await remote.pause(sessionId, original))
    const projection = ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.projections.faceOf('goal')
    let changes = 0
    const stop = projection.subscribe(() => { changes++ })
    const stale = await remote.complete(sessionId, original)
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.error.code, 'GOAL_STALE_REVISION')
    assert.equal((await remote.clear(sessionId, { id: 'other-goal', revision: paused.revision })).ok, false)
    const result = await performGoalOperation(remote, sessionId, 'resume', original)
    assert.equal(result.ok, false)
    if (!result.ok && result.refreshed) {
      assert.equal(result.value?.goal.phase, 'paused')
      assert.equal(result.value?.goal.revision, paused.revision)
    } else assert.fail('拒否後は現在のゴールを読み直します。')
    assert.equal(unwrapRemoteResult(await remote.get(sessionId))?.phase, 'paused')
    assert.equal(changes, 0)
    stop()
  } finally { ctx.dispose() }
})

test('行き詰まりのシナリオは理由を表示し、再開で解除して projection を更新する', async () => {
  const ctx = createMockContext({ scenario: 'goal-blocked', extensions: [{ extendMock }] })
  try {
    const remote = goalsRemoteOf(ctx.remote.goals)!
    const goal = unwrapRemoteResult(await remote.get(sessionId))!
    assert.equal(goal.phase, 'blocked')
    assert.match(goal.blockedReason?.message ?? '', /テストに失敗/)
    const result = unwrapRemoteResult(await remote.resume(sessionId, goal))
    assert.equal(result.phase, 'active')
    assert.equal(result.blockedReason, undefined)
    assert.equal((ctx.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.projections.faceOf('goal').getSnapshot() as GoalProjection).goal.phase, 'active')
    assert.equal(unwrapRemoteResult(await remote.get(MOCK_IDS.sessions.readme)), undefined)
  } finally { ctx.dispose() }
})
