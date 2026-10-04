import test from 'node:test'
import assert from 'node:assert/strict'
import type { RemoteResult, SessionJob } from '../web/src/dsh/services.ts'
import {
  currentGoalProjection, goalPhaseLabel, goalPrimaryAction, goalProjectionOf, goalsRemoteOf,
  isLiveJob, jobDurationLabel, jobKindLabel, jobStatusLabel, performGoalOperation, sortJobs,
  type GoalRef, type GoalView, type GoalsRemote,
} from '../web/src/features/session-tools/operations.ts'

const view: GoalView = {
  id: 'goal-1', revision: 2, objective: '画面を確かめる', phase: 'active', maxGoalRounds: 8,
  roundsStarted: 3, createdAt: 1000, updatedAt: 2000, activation: 'armed',
}
const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure: RemoteResult<never> = { ok: false, error: { code: 'gateway/internal', message: '変更済み', details: {} } }
function remote(overrides: Partial<GoalsRemote> = {}): GoalsRemote {
  return {
    get: async () => success(view), pause: async () => success(view), resume: async () => success(view),
    complete: async () => success(view), clear: async () => success({ id: view.id, revision: view.revision + 1 }),
    ...overrides,
  }
}
function job(id: string, status: SessionJob['status'], startedAt: number, finishedAt?: number): SessionJob {
  return { output: { total: 0, earliest: 0 }, id, kind: 'bash', label: id, status, startedAt, ...(finishedAt === undefined ? {} : { finishedAt }) }
}

test('ジョブは実行中と停止中を先にし、各群は新しい順で元配列を変更しない', () => {
  const jobs = [job('old-complete', 'completed', 100, 400), job('run-old', 'running', 200),
    job('fail', 'failed', 300, 500), job('run-new', 'running', 350), job('stopping', 'stopping', 250)]
  const ids = jobs.map(item => item.id)
  assert.deepEqual(sortJobs(jobs).map(item => item.id), ['run-new', 'stopping', 'run-old', 'fail', 'old-complete'])
  assert.deepEqual(jobs.map(item => item.id), ids)
  assert.equal(isLiveJob(jobs[4]!), true)
  assert.equal(isLiveJob(jobs[0]!), false)
})

test('全状態と種類に日本語の表示を用意し、完了後の経過時間は増えない', () => {
  assert.deepEqual(['running', 'stopping', 'completed', 'killed', 'failed'].map(status => jobStatusLabel(status as SessionJob['status'])),
    ['実行中', '停止中', '完了', '停止済み', '失敗'])
  assert.equal(jobKindLabel('bash'), 'bash')
  assert.equal(jobKindLabel('subagent'), 'サブエージェント')
  assert.equal(jobKindLabel('other'), 'ジョブ')
  assert.equal(jobDurationLabel(job('live', 'running', 1000), 62_000), '1 分 1 秒')
  assert.equal(jobDurationLabel(job('done', 'completed', 1000, 5000), 100_000), '4 秒')
  assert.equal(jobDurationLabel(job('clock-skew', 'running', 1000), 500), '0 秒')
  assert.equal(jobDurationLabel(job('long', 'completed', 1000, 3_662_000), 0), '1 時間 1 分')
})

test('ゴールのRPC値はprojectionに変換し、位相に合う操作だけを選ぶ', () => {
  const projection = goalProjectionOf(view)!
  assert.equal(projection.goal.id, view.id)
  assert.equal(projection.roundsStarted, 3)
  assert.equal('activation' in projection.goal, false)
  assert.equal(projection.activation, 'armed')
  assert.equal('roundsStarted' in projection.goal, false)
  assert.equal(goalProjectionOf(undefined), null)
  assert.equal(goalPrimaryAction(view, view.activation), 'pause')
  assert.equal(goalPrimaryAction(view, 'disarmed'), 'resume')
  assert.equal(goalPhaseLabel('active', 'disarmed'), '停止中')
  assert.equal(goalPhaseLabel('active', 'armed'), '進行中')
  assert.equal(goalPrimaryAction(view), undefined)
  assert.equal(goalPhaseLabel('active'), '状態未確認')
  assert.equal(goalPrimaryAction({ ...view, phase: 'blocked' }), 'resume')
  assert.equal(goalPrimaryAction({ ...view, phase: 'paused' }), 'resume')
  assert.equal(goalPrimaryAction({ ...view, phase: 'complete' }), undefined)
  assert.equal(goalPhaseLabel('blocked'), '行き詰まり')
  assert.ok(goalsRemoteOf(remote()))
  assert.equal(goalsRemoteOf({ get() {} }), undefined)
})

test('ゴール操作は表示したGoalRefをそのまま送り、成功値を画面へ返す', async () => {
  const requested: GoalRef[] = []
  let reads = 0
  const ref = { id: view.id, revision: view.revision }
  const paused = { ...view, revision: 3, phase: 'paused' as const, activation: 'disarmed' as const }
  const result = await performGoalOperation(remote({
    pause: async (id, passed) => { assert.equal(id, 'session-1'); requested.push(passed); return success(paused) },
    get: async () => { reads += 1; return success(view) },
  }), 'session-1', 'pause', ref)
  assert.equal(requested[0], ref)
  assert.equal(reads, 0)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value?.goal.phase, 'paused')
})

test('古いrevisionの拒否時は読み直し、操作を自動で再送しない', async () => {
  let mutations = 0
  let reads = 0
  const updated = { ...view, revision: 4, phase: 'complete' as const }
  const result = await performGoalOperation(remote({
    pause: async () => { mutations += 1; return failure },
    get: async () => { reads += 1; return success(updated) },
  }), 'session-1', 'pause', { id: view.id, revision: 1 })
  assert.equal(mutations, 1)
  assert.equal(reads, 1)
  assert.deepEqual(result, { ok: false, refreshed: true, value: goalProjectionOf(updated) })
})

test('消去はtombstone refを保持し、RPC例外と読み直し失敗も返す', async () => {
  const ref = { id: view.id, revision: view.revision }
  assert.deepEqual(await performGoalOperation(remote(), 'session-1', 'clear', ref), {
    ok: true, value: null, ref: { id: view.id, revision: view.revision + 1 },
  })
  assert.deepEqual(await performGoalOperation(remote({
    complete: async () => { throw new Error('切断') }, get: async () => failure,
  }), 'session-1', 'complete', ref), { ok: false, refreshed: false })
})

test('イベントがRPC応答に追いつくまで新しいrevisionを保ち、さらに新しいイベントを優先する', () => {
  const baseline = goalProjectionOf(view)!
  const next = goalProjectionOf({ ...view, revision: 3, phase: 'paused' })!
  const observed = { baseline, value: next }
  assert.equal(currentGoalProjection(baseline, observed), next)
  assert.equal(currentGoalProjection({ ...baseline, roundsStarted: 4 }, observed), next)
  const newest = goalProjectionOf({ ...view, revision: 4, phase: 'complete' })!
  assert.equal(currentGoalProjection(newest, observed), newest)
  const cleared = { baseline, value: null, ref: { id: view.id, revision: 3 } }
  assert.equal(currentGoalProjection({ ...baseline }, cleared), null)
  const replacement = goalProjectionOf({ ...view, id: 'goal-2', revision: 1 })!
  assert.equal(currentGoalProjection(replacement, cleared), replacement)
})
