import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import type { RemoteResult, SessionJob } from '../web/src/dsh/services.ts'
import { referencesImage } from '../web/src/dsh/mock/session-validation.ts'

const id = MOCK_IDS.sessions.readme
const job: SessionJob = { id: 'audit-job', label: '照合用', kind: 'bash', status: 'running', startedAt: 1, output: { total: 0, earliest: 0 } }
function code(result: RemoteResult<unknown>) { assert.equal(result.ok, false); return result.ok ? '' : result.error.code }

test('照合 workspaceは空名・重複名・不存在・未所属の並べ替えを拒否する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const first = ctx.workspaces.list.getSnapshot().items[0]!
  await assert.rejects(ctx.workspaces.create({ path: 'relative' }), /workspace\/invalid-path/)
  const promise = ctx.workspaces.create({ path: '/mock/audit' })
  assert.equal(ctx.workspaces.list.getSnapshot().items.some(row => row.path === '/mock/audit'), false)
  const other = await promise
  assert.equal(ctx.workspaces.list.getSnapshot().items[0]?.workspaceId, other.workspaceId)
  assert.equal((await ctx.workspaces.create({ path: '/mock/./audit/' })).workspaceId, other.workspaceId)
  await assert.rejects(ctx.workspaces.rename(other.workspaceId, '  '), /gateway\/bad-request/)
  await assert.rejects(ctx.workspaces.rename(other.workspaceId, first.title), /workspace\/name-conflict/)
  await assert.rejects(ctx.workspaces.rename('missing', '変更'), /workspace\/not-found/)
  await assert.rejects(ctx.workspaces.delete('missing'), /workspace\/not-found/)
  await assert.rejects(ctx.workspaces.insertBefore(first.workspaceId, 'missing'), /workspace\/not-found/)
  await assert.rejects(ctx.workspaces.insertBefore('missing'), /workspace\/not-found/)
  await assert.rejects(ctx.workspaces.insertSessionBefore(other.workspaceId, id), /workspace\/move-invalid/)
  await assert.rejects(ctx.workspaces.insertSessionBefore(first.workspaceId, id, 'missing'), /workspace\/move-invalid/)
  assert.equal(ctx.workspaces.list.getSnapshot().items.find(row => row.workspaceId === first.workspaceId)?.sessionIds.includes(id), true)
})

test('照合 archiveはpinを外し未登録と固定済みアーカイブを拒否し解除は冪等', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  await assert.rejects(ctx.workspaces.archiveSession('missing'), /session\/not-found/)
  await assert.rejects(ctx.workspaces.pinSession('missing'), /session\/not-found/)
  await ctx.workspaces.pinSession(id)
  await ctx.workspaces.archiveSession(id)
  assert.deepEqual(ctx.workspaces.list.getSnapshot().pinnedSessionIds, [])
  await assert.rejects(ctx.workspaces.pinSession(id), /gateway\/bad-request/)
  const workspace = ctx.workspaces.list.getSnapshot().items.find(row => row.sessionIds.includes(id))!
  await ctx.workspaces.insertSessionBefore(workspace.workspaceId, id)
  assert.equal(ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(id), true)
  await ctx.workspaces.unarchiveSession(id)
  await ctx.workspaces.unarchiveSession(id)
  await ctx.workspaces.unpinSession('missing')
  await ctx.workspaces.unarchiveSession('missing')
  ctx.mock.setJobs(id, [job])
  await assert.rejects(ctx.workspaces.archiveSession(id), /workspace\/session-active/)
  await ctx.workspaces.archiveSession(id, { stopActivity: true })
  ctx.jobs.watchRows(id); await Promise.resolve()
  assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.[0]?.status, 'killed')
})

test('照合 initializeDefaultは初回だけ作成し既存データがあれば何もしない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  assert.equal(await ctx.workspaces.initializeDefault(), undefined)
  for (const session of ctx.sessions.list.getSnapshot().ids) ctx.mock.removeSession(session)
  for (const workspace of ctx.workspaces.list.getSnapshot().items) ctx.mock.removeWorkspace(workspace.workspaceId)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(ctx.workspaces.initializeDefault(controller.signal), /rpc\/aborted/)
  const first = await ctx.workspaces.initializeDefault()
  assert.ok(first)
  assert.equal((await ctx.workspaces.initializeDefault())?.workspaceId, first.workspaceId)
  assert.deepEqual(ctx.sessions.list.getSnapshot().ids, [])
})

test('照合 createは同じidを再登録しworkspace優先とcwd・子の所有権を検証する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const workspace = ctx.workspaces.list.getSnapshot().items[0]!
  await assert.rejects(ctx.sessions.create({ workspaceId: 'missing' }), /workspace\/not-found/)
  const created = await ctx.sessions.create({ workspaceId: workspace.workspaceId, cwd: '/ignored' })
  assert.equal(ctx.sessions.list.getSnapshot().byId[created]?.cwd, workspace.path)
  ctx.mock.updateWorkspace(workspace.workspaceId, { sessionIds: [] })
  assert.equal(await ctx.sessions.create({ sessionId: created, workspaceId: workspace.workspaceId }), created)
  assert.deepEqual(ctx.workspaces.list.getSnapshot().items[0]?.sessionIds, [created])
  await assert.rejects(ctx.sessions.create({ sessionId: created, cwd: '/different' }), /session\/conflict/)
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  await assert.rejects(ctx.sessions.create({ sessionId: 'child' }), /session\/agent-busy/)
})

test('照合 forkは無効な境界と完了ターンのない会話を拒否し通常の子孫を作る', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const blank = await ctx.sessions.create()
  await assert.rejects(ctx.sessions.fork({ sessionId: blank }), /session\/fork-unavailable/)
  await assert.rejects(ctx.sessions.fork({ sessionId: 'missing' }), /session\/not-found/)
  for (const atSeq of [-1, 0.5, -0, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(ctx.sessions.fork({ sessionId: id, atSeq }), TypeError)
  await assert.rejects(ctx.sessions.fork({ sessionId: id, atSeq: 10000 }), /session\/fork-unavailable/)
  let created = ''
  const fork = await ctx.sessions.fork({ sessionId: id, atSeq: 1, onCreated(value) { created = value; assert.ok(ctx.sessions.list.getSnapshot().byId[value]) } })
  assert.equal(fork, created)
  assert.equal(ctx.sessions.list.getSnapshot().byId[fork]?.origin, undefined)
  assert.equal(ctx.sessions.list.getSnapshot().byId[fork]?.parentId, id)
  assert.equal(ctx.sessions.list.getSnapshot().byId[fork]?.title, ctx.sessions.list.getSnapshot().byId[id]?.title)
})

test('照合 promptは空白を拒否してechoを退役し通常会話のrequestIdを重複受付しない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const ref = ctx.sessions.retain(id, { source: 'm3e.test' }); const face = (await ref.ready).session
  let failed = 0
  const pending = face.beginSubmission({ mode: 'queue', text: '', attachments: [], onRetire(value) { if (value.reason === 'failed') failed++ } })
  assert.equal(face.getSnapshot().promptAttempted, true)
  assert.equal(code(await face.prompt([{ type: 'text', text: '  ' }], 'queue', undefined, pending.requestId)), 'gateway/bad-request')
  assert.equal(failed, 1)
  assert.equal(face.getSnapshot().promptError?.error.code, 'gateway/bad-request')
  const content = [{ type: 'text' as const, text: '一度だけ' }]
  assert.equal((await face.prompt(content, 'queue', undefined, 'same-request')).ok, true)
  const before = ctx.mock.getRecords(id)
  assert.equal((await face.prompt(content, 'queue', undefined, 'same-request')).ok, true)
  assert.deepEqual(ctx.mock.getRecords(id), before)
  assert.equal(ctx.mock.getProjection<{ 'next-turn': unknown[] }>(id, 'inbox')?.['next-turn'].length ?? 0, 0)
})

test('照合 子のpromptは閲覧専用・親不在・ファイルを拒否しrenameも通常経路を拒否する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(id, 'subagentCatalog', [{ id: 'child', mode: 'one-shot', createdAt: 0 }])
  const ref = ctx.sessions.retain({ parentSessionId: id, childSessionId: 'child', mode: 'one-shot' }, { source: 'm3e.test' })
  const face = (await ref.ready).session
  assert.equal(code(await face.prompt([{ type: 'text', text: '続ける' }], 'queue')), 'subagent/not-resumable')
  assert.equal(code(await face.prompt([{ type: 'file', receiptId: 'unknown' }], 'queue')), 'subagent/attachment-invalid')
  assert.equal(code(await face.rename('変更')), 'session/agent-busy')
  ctx.mock.removeSession(id)
  assert.equal(code(await face.prompt([{ type: 'text', text: '続ける' }], 'queue')), 'subagent/parent-unavailable')
})

test('照合 画像は参照元の会話だけが取得できrenameはtitle投影にも反映する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const source = (await ctx.sessions.retain(id, { source: 'm3e.test' }).ready).session
  const other = (await ctx.sessions.retain(MOCK_IDS.sessions.approval, { source: 'm3e.test' }).ready).session
  assert.equal((await source.readAttachment('mock-readme-image')).ok, true)
  assert.equal(code(await other.readAttachment('mock-readme-image')), 'session/attachment-invalid')
  assert.equal((await source.rename('変更後の題名')).ok, true)
  assert.equal(source.projections.faceOf('title').getSnapshot(), '変更後の題名')
  assert.equal(code(await source.rename('\u200b\u202e')), 'session/title-invalid')
  assert.deepEqual(await source.rename('\u001b[31m赤\u001b[0m\n  題名'), { ok: true, value: { title: '赤 題名', seq: ctx.mock.getRecords(id).at(-1)!.seq } })
  const long = await source.rename('あ'.repeat(41))
  assert.equal(long.ok && long.value.title, 'あ'.repeat(40))
})

test('照合 添付の参照は宣言済みフィールドに限定し入れ子と未知のイベントを認可しない', () => {
  const image = { type: 'image', attachment: { attachmentId: 'image' } }
  const event = (type: string, data: unknown) => [{ type, seq: 0, time: 0, data: data as never }]
  assert.equal(referencesImage(event('tool/result', { message: { content: [image] } }), 'image'), true)
  assert.equal(referencesImage(event('tool/result', { message: { content: [{ type: 'tool-result', content: [image] }] } }), 'image'), false)
  assert.equal(referencesImage(event('unknown/event', { content: [image] }), 'image'), false)
  assert.equal(referencesImage(event('agent/inbox/spliced', { inserted: [{ content: [image] }] }), 'image'), true)
  assert.equal(referencesImage(event('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'block-end', block: image } }] }), 'image'), true)
})

test('照合 cancelは親の不一致を拒否してstopのエラーを保持する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.setProjection(id, 'subagentCatalog', [{ id: 'child', mode: 'continuable', label: '子', createdAt: 0 }])
  const ref = ctx.sessions.retain({ parentSessionId: 'wrong', childSessionId: 'child', mode: 'continuable' }, { source: 'm3e.test' })
  const face = (await ref.ready).session
  assert.equal(code(await face.cancel()), 'subagent/unauthorized')
  assert.equal(face.getSnapshot().promptError?.op, 'stop')
  assert.equal(face.getSnapshot().promptError?.error.code, 'subagent/unauthorized')
  const ordinary = (await ctx.sessions.retain(id, { source: 'm3e.test' }).ready).session
  ctx.mock.removeSession(id)
  assert.equal(code(await ordinary.cancel()), 'session/not-found')
  assert.equal(ordinary.getSnapshot().promptError?.op, 'stop')
})

test('照合 子の継承境界より古いdescriptorはunsupportedで開けない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'child', parentId: id, origin: 'subagent', displayTitle: '子', running: false, blank: false, updatedAt: 0 }, [
    { type: 'user/message', seq: 0, time: 0, data: { content: [] } },
    { type: 'session/end-seed', seq: 1, time: 0, data: { inherited: true } },
  ])
  ctx.mock.setProjection('child', 'subagent', { mode: 'continuable', label: '子', seq: 0 })
  const ref = ctx.sessions.retain({ parentSessionId: id, childSessionId: 'child', mode: 'continuable' }, { source: 'm3e.test' })
  const snapshot = (await ref.ready).session.getSnapshot()
  assert.equal(snapshot.openState, 'error')
  assert.equal(snapshot.openError?.code, 'subagent/catalog-diagnostic')
  assert.equal(snapshot.openError?.details.reason, 'unsupported')
})

test('照合 searchは本文だけを探しcwdなし・空語・長過ぎる語を受け入れない', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  const signal = new AbortController().signal
  ctx.mock.addSession({ id: 'title-only', displayTitle: 'needleonly', cwd: '/mock', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.addSession({ id: 'without-cwd', displayTitle: '無所属', running: false, blank: false, updatedAt: 0 }, [{ type: 'user/message', seq: 0, time: 0, data: { content: [{ type: 'text', text: 'needleonly' }] } }])
  assert.deepEqual(await ctx.sessions.search('needleonly', signal), { ok: true, value: { items: [], hasMore: false } })
  for (const query of ['', ' ', 'x'.repeat(501), '\0']) assert.equal(code(await ctx.sessions.search(query, signal)), 'gateway/bad-request')
})

test('照合 searchは置換前の履歴を除き現在の表示対象だけを検索する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'surface-search', displayTitle: '表示対象', cwd: '/mock', running: false, blank: false, updatedAt: 0 }, [
    { type: 'user/message', seq: 0, time: 0, surfaceOp: 'append', data: { content: [{ type: 'text', text: 'shadowed-needle' }] } },
    { type: 'assistant/message', seq: 1, time: 0, surfaceOp: 'append', data: { message: { content: [{ type: 'text', text: 'shadowed-answer' }] } } },
    { type: 'user/message', seq: 2, time: 0, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 1 }, sourceEventSeqs: [0, 1], data: { content: [{ type: 'text', text: 'current-needle' }] } },
  ])
  const signal = new AbortController().signal
  for (const query of ['shadowed-needle', 'shadowed-answer']) assert.deepEqual(await ctx.sessions.search(query, signal), { ok: true, value: { items: [], hasMore: false } })
  assert.deepEqual(await ctx.sessions.search('current-needle', signal), { ok: true, value: { items: [{ sessionId: 'surface-search', snippet: 'current-needle' }], hasMore: false } })
})

test('照合 searchはassistantのtool-callの名前と引数も検索する', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.addSession({ id: 'tool-search', displayTitle: 'ツール検索', cwd: '/mock', running: false, blank: false, updatedAt: 0 }, [
    { type: 'assistant/message', seq: 0, time: 0, surfaceOp: 'append', data: { message: { content: [{ type: 'tool-call', name: 'needle-tool', arguments: '{"path":"needle-argument"}' }] } } },
  ])
  for (const query of ['needle-tool', 'needle-argument']) {
    const result = await ctx.sessions.search(query, new AbortController().signal)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.value.items.map(item => item.sessionId), ['tool-search'])
      assert.ok(result.value.items[0]!.snippet.includes(query))
    }
  }
})

test('照合 jobsは非同期で開き別会話のjobを拒否し出力の上限と明示解除を保つ', async t => {
  const ctx = createMockContext(); t.after(() => ctx.dispose())
  ctx.mock.setJobs(id, [job])
  const invalid = ctx.jobs.observe('different-session', job.id)
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id], undefined)
  await Promise.resolve()
  assert.match(ctx.jobs.state.getSnapshot().observed[job.id]?.error ?? '', /job\/not-found/)
  invalid(); await Promise.resolve()
  const stop = ctx.jobs.observe(id, job.id)
  ctx.mock.emitJobFrame(job.id, { type: 'output', text: '開く前' })
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id], undefined)
  await Promise.resolve()
  ctx.mock.emitJobFrame(job.id, { type: 'output', text: 'a'.repeat(128 * 1024) + '最後' })
  const observed = ctx.jobs.state.getSnapshot().observed[job.id]!
  assert.equal(observed.text.length, 128 * 1024)
  assert.equal(observed.text.endsWith('最後'), true)
  assert.equal(observed.gapBefore, true)
  const connected = new Promise<void>(resolve => {
    const off = ctx.connection.state.subscribe(() => { if (ctx.connection.state.getSnapshot() === 'connected') { off(); resolve() } })
  })
  ctx.connection.reconnect(); await connected; await Promise.resolve()
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.text, observed.text)
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id]?.streaming, true)
  stop(); await Promise.resolve()
  assert.equal(ctx.jobs.state.getSnapshot().observed[job.id], undefined)
})
