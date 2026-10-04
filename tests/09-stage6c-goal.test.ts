import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { goalsRemoteOf, type GoalActivationRef } from '../web/src/features/session-tools/operations.ts'
import { watchGoalActivation } from '../web/src/features/session-tools/goal-activation.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'

const id = SESSION_TOOLS_MOCK_IDS.parent
test('B2 保存済みゴールがあっても未準備・終了済み・未知のAgentへの全RPCを拒否する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = goalsRemoteOf(ctx.remote.goals)!
    const goal = unwrapRemoteResult(await api.get(id))!
    ctx.mock.setAgentAvailable(id, false)
    assert.ok(ctx.mock.getProjection(id, 'goal'))
    for (const target of [id, 'missing']) for (const result of await Promise.all([
      api.get(target), api.pause(target, goal), api.resume(target, goal), api.complete(target, goal), api.clear(target, goal),
    ])) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'gateway/lookup-not-found')
    }
    ctx.mock.setAgentAvailable(id, true)
    assert.equal(unwrapRemoteResult(await api.get(id))!.activation, 'disarmed')
  } finally { ctx.dispose() }
})

test('B2 画面終了時は準備待ちの再取得を取り消す', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  let reads = 0
  const api = { ...goalsRemoteOf(ctx.remote.goals)!, async get() {
    reads++
    return { ok: false as const, error: { code: 'gateway/lookup-not-found', message: '準備前', details: {} } }
  } }
  const watcher = watchGoalActivation(ctx.remote, api, id, () => assert.fail('終了後の通知'), () => {})
  try {
    await watcher.refresh()
    watcher.dispose()
    t.mock.timers.tick(5000)
    await Promise.resolve()
    assert.equal(reads, 1)
  } finally { watcher.dispose(); ctx.dispose() }
})

test('M10 m5 activation不変の完了は通知せず投影を更新し時刻を逆行させない', async t => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = goalsRemoteOf(ctx.remote.goals)!
    const goal = unwrapRemoteResult(await api.get(id))!
    let events = 0
    const off = onRemoteEvent(ctx.remote, 'goal/activation-changed', () => { events++ })
    const paused = unwrapRemoteResult(await api.pause(id, goal))
    await Promise.resolve()
    assert.equal(events, 1)
    t.mock.method(Date, 'now', () => goal.updatedAt - 1000)
    const complete = unwrapRemoteResult(await api.complete(id, paused))
    await Promise.resolve()
    assert.equal(events, 1)
    assert.equal(complete.updatedAt, paused.updatedAt)
    assert.equal(complete.revision, paused.revision + 1)
    assert.equal(ctx.mock.getProjection<any>(id, 'goal').goal.phase, 'complete')
    const cleared = unwrapRemoteResult(await api.clear(id, complete))
    assert.equal(cleared.revision, complete.revision + 1)
    assert.equal(ctx.mock.getProjection(id, 'goal'), null)
    off()
  } finally { ctx.dispose() }
})

test('B2 準備に3秒かかっても通知なしで自動復帰する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const real = goalsRemoteOf(ctx.remote.goals)!
  let ready = false
  let reads = 0
  let failures = 0
  let live: GoalActivationRef | undefined
  const api = { ...real, async get(sessionId: string) {
    reads++
    return ready ? real.get(sessionId) : { ok: false as const, error: { code: 'gateway/lookup-not-found', message: '準備前', details: {} } }
  } }
  const watcher = watchGoalActivation(ctx.remote, api, id, value => { live = value }, () => { failures++ })
  try {
    await watcher.refresh()
    assert.equal(live, undefined)
    assert.equal(failures, 1)
    for (let elapsed = 250; elapsed <= 3000; elapsed += 250) {
      if (elapsed === 3000) ready = true
      t.mock.timers.tick(250)
      // Drain the RPC and the subsequent retry scheduling between clock ticks.
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    }
    assert.equal((live as GoalActivationRef | undefined)?.id, 'session-tools-goal')
    assert.equal(reads, 13)
  } finally { watcher.dispose(); ctx.dispose() }
})
