import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { queueFromInbox } from '../web/src/dsh/inbox.ts'
import { remoteErrorMessage } from '../web/src/dsh/remote-result.ts'
import type { InboxMessage, PendingSubmissionRetirement } from '../web/src/dsh/services.ts'

const id = MOCK_IDS.sessions.readme
test('retainInfo は読み取りだけで通知せず、同じ世代を参照数と所有者ごとに管理する', async () => {
  const ctx = createMockContext()
  try {
    let notifications = 0
    ctx.sessions.list.subscribe(() => { notifications++ })
    const info = ctx.sessions.retainInfo(id)
    assert.equal(notifications, 0)
    assert.equal(ctx.sessions.retainInfo(id), info)
    assert.equal(ctx.sessions.scope(id), undefined)
    assert.equal(ctx.sessions.binding(id), undefined)
    const a = ctx.sessions.retain(id, { source: 'm3e.a' })
    const b = ctx.sessions.retain(id, { source: 'm3e.b' })
    const c = ctx.sessions.retain(id, { source: 'm3e.a' })
    const binding = await a.ready
    assert.equal(await b.ready, binding)
    assert.equal(c.binding, binding)
    assert.deepEqual(info.getSnapshot(), { referenceCount: 3, retainedBy: { 'm3e.a': 2, 'm3e.b': 1 } })
    a.release(); a.release()
    assert.throws(() => a.binding, /released/)
    assert.equal(b.binding, binding)
    c.release()
    assert.deepEqual(info.getSnapshot(), { referenceCount: 1, retainedBy: { 'm3e.b': 1 } })
    b.release()
    assert.equal(ctx.sessions.scope(id), undefined)
    assert.equal(ctx.sessions.binding(id), undefined)
    assert.equal(ctx.sessions.scopeOf(binding.ctx), id)
    assert.equal(ctx.sessions.sessionOf(binding.ctx), undefined)
    const next = ctx.sessions.retain(id, { source: 'm3e.a' })
    assert.notEqual(next.binding, binding)
    assert.notEqual(next.binding.ctx, binding.ctx)
    assert.notEqual(next.binding.session, binding.session)
    assert.equal(ctx.sessions.scopeOf(binding.ctx), id)
    assert.equal(ctx.sessions.sessionOf(binding.ctx), undefined)
    assert.equal(ctx.sessions.sessionOf(next.binding.ctx), next.binding.session)
  } finally { ctx.dispose() }
})

test('B2 最後の解放は内部購読だけ止め、外部の投影購読は明示解除まで世代を越えて残る', async () => {
  const ctx = createMockContext()
  try {
    const reference = ctx.sessions.retain(id, { source: 'm3e.test' })
    const binding = await reference.ready
    let changes = 0
    const stopSnapshot = binding.session.subscribe(() => { changes++ })
    const stopEvents = binding.eventSource.subscribe(() => { changes++ })
    const projection = binding.session.projections.faceOf('goal')
    const stopProjection = projection.subscribe(() => { changes++ })
    const retirements: PendingSubmissionRetirement[] = []
    binding.session.beginSubmission({ text: '未送信', attachments: [], mode: 'queue', onRetire: value => retirements.push(value) })
    reference.release()
    assert.deepEqual(retirements, [{ reason: 'failed' }])
    const before = changes
    ctx.mock.setProjection(id, 'goal', { active: true })
    ctx.mock.setSessionState(id, { running: true })
    assert.equal(changes, before + 1)
    const next = ctx.sessions.retain(id, { source: 'm3e.test' })
    assert.equal(next.binding.session.projections.faceOf('goal'), projection)
    ctx.mock.setProjection(id, 'goal', { active: false })
    assert.equal(changes, before + 2)
    stopProjection(); stopSnapshot(); stopEvents()
    ctx.mock.setProjection(id, 'goal', { active: true })
    assert.equal(changes, before + 2)
  } finally { ctx.dispose() }
})

for (const end of ['release', 'abort', 'dispose'] as const) {
  test(`ready 待ちを ${end} すると reject し、所有権は明示的な解放まで残る`, async () => {
    const ctx = createMockContext()
    const controller = new AbortController()
    const reference = ctx.sessions.retain(id, { source: 'm3e.test', signal: controller.signal })
    if (end === 'release') reference.release()
    else if (end === 'abort') controller.abort()
    else ctx.dispose()
    await assert.rejects(reference.ready)
    assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, end === 'abort' ? 1 : 0)
    if (end === 'abort') assert.ok(reference.binding)
    else assert.equal(ctx.sessions.binding(id), undefined)
    reference.release()
    assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 0)
    ctx.dispose()
  })
}

for (const outcome of ['success', 'throw', 'reject'] as const) {
  test(`using の ${outcome} で一時的な参照を必ず放す`, async () => {
    const ctx = createMockContext()
    try {
      const flight = ctx.sessions.using(id, { source: 'm3e.rename' }, reference => {
        assert.equal(reference.binding, ctx.sessions.binding(id))
        if (outcome === 'throw') throw new Error('同期失敗')
        if (outcome === 'reject') return Promise.reject(new Error('非同期失敗'))
        return 42
      })
      if (outcome === 'success') assert.equal(await flight, 42)
      else await assert.rejects(flight)
      assert.equal(ctx.sessions.retainInfo(id).getSnapshot().referenceCount, 0)
      assert.equal(ctx.sessions.binding(id), undefined)
    } finally { ctx.dispose() }
  })
}

test('知らない文字列は例外、明示アドレスの Remote 失敗は ready の解決した error になる', async () => {
  const ctx = createMockContext()
  try {
    assert.throws(() => ctx.sessions.retain('missing', { source: 'm3e.test' }), /unknown session/)
    const reference = ctx.sessions.retain({ parentSessionId: id, childSessionId: 'missing', mode: 'continuable' }, { source: 'm3e.test' })
    assert.equal((await reference.ready).session.getSnapshot().openState, 'error')
    reference.release()
    assert.equal(ctx.sessions.binding('missing'), undefined)
    assert.equal(ctx.sessions.list.getSnapshot().byId.missing, undefined)
    assert.throws(() => ctx.sessions.retain('missing', { source: 'm3e.test' }), /unknown session/)
  } finally { ctx.dispose() }
})

test('投影は ready なら再読込せず、失敗は次回に再試行し、再接続で再取得可能になる', async () => {
  let fail = true
  const ctx = createMockContext({ readProjections: async () => fail ? { ok: false, error: { code: 'gateway/internal', message: '注入した失敗', details: {} } } : { ok: true, value: {} } })
  try {
    await ctx.sessions.refreshProjections(id)
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.state, 'error')
    fail = false
    await ctx.sessions.refreshProjections(id)
    const loaded = ctx.sessions.list.getSnapshot().projectionsBySession[id]
    await ctx.sessions.refreshProjections(id)
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id], loaded)
    await ctx.sessions.refreshProjections('later')
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession.later?.state, 'ready')
    ctx.mock.addSession({ id: 'later', displayTitle: '後着', running: false, blank: true, updatedAt: 0 }, [])
    await ctx.sessions.refreshProjections('later')
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession.later?.state, 'ready')
    ctx.connection.reconnect()
    await new Promise<void>(resolve => {
      const stop = ctx.connection.state.subscribe(() => { if (ctx.connection.state.getSnapshot() === 'connected') { stop(); resolve() } })
    })
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.state, 'loading')
    await ctx.sessions.refreshProjections(id)
    assert.equal(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.state, 'ready')
  } finally { ctx.dispose() }
})

test('inbox は next-turn 全件と next-step の user だけを MessageId 付きで表示する', () => {
  const message = (id: string, kind: string): InboxMessage => ({ id, role: 'user', source: { kind, rpcId: 'request-' + id }, content: [{ type: 'text', text: id }] })
  assert.deepEqual(queueFromInbox({ 'next-turn': [message('queued', 'user')], 'next-step': [message('human', 'user'), message('context', 'system')] })
    .map(row => [row.id, row.rpcId, row.placement, row.text]), [['queued', 'request-queued', 'queued', 'queued'], ['human', 'request-human', 'steering', 'human']])
})

test('ジョブ一覧の購読を共有し、最後の解除と空の一覧は rows のキーを消す', async () => {
  const ctx = createMockContext()
  try {
    ctx.mock.setJobs(id, [{ id: 'job', label: '処理', kind: 'bash', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }])
    assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
    const a = ctx.jobs.watchRows(id), b = ctx.jobs.watchRows(id)
    a(); a()
    assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
    await Promise.resolve()
    assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.length, 1)
    assert.deepEqual(await ctx.jobs.kill(id, 'job'), { ok: true, value: { outcome: 'requested' } })
    assert.equal(ctx.jobs.state.getSnapshot().rows[id]?.[0]?.status, 'running')
    ctx.mock.setJobs(id, [{ id: 'job', label: '処理', kind: 'bash', status: 'killed', startedAt: 0, output: { total: 0, earliest: 0 } }])
    assert.deepEqual(await ctx.jobs.kill(id, 'job'), { ok: true, value: { outcome: 'already-finished' } })
    b()
    await Promise.resolve()
    assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
    const stop = ctx.jobs.watchRows(id)
    await Promise.resolve()
    assert.deepEqual(ctx.jobs.state.getSnapshot().rows[id], [{ id: 'job', label: '処理', kind: 'bash', status: 'killed', startedAt: 0, output: { total: 0, earliest: 0 } }])
    ctx.mock.setJobs(id, [])
    assert.equal(ctx.jobs.state.getSnapshot().rows[id], undefined)
    stop()
  } finally { ctx.dispose() }
})

test('実行中アーカイブを黙って停止せず拒否し、既存の日本語エラー案内へ渡す', async () => {
  const ctx = createMockContext()
  try {
    await assert.rejects(ctx.workspaces.archiveSession(MOCK_IDS.sessions.approval), error => {
      assert.equal((error as { rpcError: { code: string } }).rpcError.code, 'workspace/session-active')
      assert.equal(remoteErrorMessage(error), '実行中の会話はアーカイブできません。実行を止めてから、もう一度お試しください。')
      return true
    })
    assert.deepEqual(ctx.workspaces.list.getSnapshot().archivedSessionIds, [])
    assert.equal(ctx.sessions.list.getSnapshot().byId[MOCK_IDS.sessions.approval]?.running, true)
  } finally { ctx.dispose() }
})
