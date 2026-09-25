import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { extendMock, SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { goalActivationFor, watchGoalActivation, type GoalActivationChanged } from '../web/src/features/session-tools/goal-activation.ts'
import { goalPhaseLabel, goalPrimaryAction, goalsRemoteOf, performGoalOperation, type GoalActivationRef, type GoalProjection, type GoalsRemote, type GoalView } from '../web/src/features/session-tools/operations.ts'

const sessionId = SESSION_TOOLS_MOCK_IDS.parent
const view: GoalView = { id: 'goal', revision: 3, objective: '動作を確かめる', phase: 'active', maxGoalRounds: 8,
  roundsStarted: 2, createdAt: 1, updatedAt: 2, activation: 'armed' }
const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function harness(get: GoalsRemote['get']) {
  let listener: ((event: GoalActivationChanged) => void) | undefined
  let subscriptions = 0
  const remote = { $on(event: string, next: (event: GoalActivationChanged) => void) {
    assert.equal(event, 'goal/activation-changed')
    listener = next
    subscriptions++
    return () => { subscriptions--; listener = undefined }
  } }
  const goals: GoalsRemote = { get, pause: async () => ok(view), resume: async () => ok(view), complete: async () => ok(view), clear: async () => ok(view) }
  return { remote, goals, emit(event: GoalActivationChanged) { listener?.(event) }, get subscriptions() { return subscriptions } }
}

test('active/disarmed は初回 get で停止中・再開となり、一度の再開で armed になる', async () => {
  const ctx = createMockContext({ scenario: 'goal-disarmed', extensions: [{ extendMock }] })
  const goals = goalsRemoteOf(ctx.remote.goals)!
  let live: GoalActivationRef | undefined
  const watcher = watchGoalActivation(ctx.remote, goals, sessionId, value => { live = value }, () => assert.fail('取得に失敗'))
  try {
    const projection = ctx.sessions.binding(sessionId)!.session.projections.faceOf('goal').getSnapshot() as GoalProjection
    assert.equal('activation' in projection, false)
    assert.equal('activation' in projection.goal, false)
    assert.equal(projection.goal.phase, 'active')
    await watcher.refresh()
    const activation = goalActivationFor(projection.goal, live)
    assert.equal(goalPhaseLabel(projection.goal.phase, activation), '停止中')
    assert.equal(goalPrimaryAction(projection.goal, activation), 'resume')
    const resumed = await performGoalOperation(goals, sessionId, 'resume', projection.goal)
    assert.equal(resumed.ok, true)
    if (!resumed.ok || !resumed.value) throw new Error('再開できませんでした。')
    assert.equal(resumed.value.activation, 'armed')
    assert.equal(goalActivationFor(resumed.value.goal, live), 'armed')
    assert.equal(goalPrimaryAction(resumed.value.goal, live?.activation), 'pause')
    assert.equal(unwrapRemoteResult(await goals.get(sessionId))?.phase, 'active')
  } finally { watcher.dispose(); ctx.dispose() }
})

test('同じ revision の activation 通知に追従し、別の会話と別 revision を混ぜない', async () => {
  const source = harness(async () => ok(view))
  let live: GoalActivationRef | undefined
  const watcher = watchGoalActivation(source.remote, source.goals, sessionId, value => { live = value }, () => assert.fail())
  await watcher.refresh()
  assert.equal(goalActivationFor(view, live), 'armed')
  source.emit({ sessionId: 'another', goal: { ...view, activation: 'disarmed' } })
  assert.equal(goalActivationFor(view, live), 'armed')
  source.emit({ sessionId, goal: { ...view, activation: 'disarmed' } })
  assert.equal(goalActivationFor(view, live), 'disarmed')
  assert.equal(goalPhaseLabel(view.phase, goalActivationFor(view, live)), '停止中')
  assert.equal(goalActivationFor({ ...view, revision: 4 }, live), undefined)
  assert.equal(goalActivationFor({ ...view, id: 'new-goal' }, live), undefined)
  source.emit({ sessionId })
  assert.equal(live, undefined)
  watcher.dispose()
  assert.equal(source.subscriptions, 0)
})

test('取得開始後のイベントは遅れた get 応答に上書きされず、終了後の応答も捨てる', async () => {
  const pending = deferred<RemoteResult<GoalView | undefined>>()
  const source = harness(() => pending.promise)
  let live: GoalActivationRef | undefined
  let publications = 0
  const watcher = watchGoalActivation(source.remote, source.goals, sessionId, value => { live = value; publications++ }, () => assert.fail())
  const reading = watcher.refresh()
  source.emit({ sessionId, goal: { ...view, activation: 'disarmed' } })
  pending.resolve(ok(view))
  await reading
  assert.equal(goalActivationFor(view, live), 'disarmed')
  assert.equal(publications, 1)
  watcher.dispose()
  const pending2 = deferred<RemoteResult<GoalView | undefined>>()
  source.goals.get = () => pending2.promise
  const stopped = watchGoalActivation(source.remote, source.goals, sessionId, () => { publications++ }, () => assert.fail())
  const stoppedRead = stopped.refresh()
  stopped.dispose()
  pending2.resolve(ok(view))
  await stoppedRead
  assert.equal(publications, 1)
  assert.equal(source.subscriptions, 0)
})

test('再取得の順序を保ち、取得失敗は進行中と扱わず再試行できる', async () => {
  const first = deferred<RemoteResult<GoalView | undefined>>()
  const source = harness(() => first.promise)
  let live: GoalActivationRef | undefined
  let failures = 0
  const watcher = watchGoalActivation(source.remote, source.goals, sessionId, value => { live = value }, () => { failures++ })
  const oldRead = watcher.refresh()
  source.goals.get = async () => ok({ ...view, activation: 'disarmed' })
  await watcher.refresh()
  first.resolve(ok(view))
  await oldRead
  assert.equal(live?.activation, 'disarmed')
  source.goals.get = async () => ({ ok: false, error: { code: 'gateway/unavailable', message: '取得失敗', details: {} } })
  await watcher.refresh()
  assert.equal(failures, 1)
  source.goals.get = async () => ok({ ...view, activation: 'armed' })
  await watcher.refresh()
  assert.equal(live?.activation, 'armed')
  watcher.dispose()
})
