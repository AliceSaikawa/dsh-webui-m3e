import type { RemoteResult, SessionJob } from '../../dsh/services.ts'

/** Browser RPC shapes verified against the installed dsh-goal package. */
export interface GoalRef { readonly id: string; readonly revision: number }
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'
export type GoalActivation = 'armed' | 'disarmed'
export interface GoalActivationRef extends GoalRef { readonly activation: GoalActivation }
export interface GoalSnapshot extends GoalRef {
  readonly objective: string
  readonly phase: GoalPhase
  readonly maxGoalRounds: number
  readonly blockedReason?: { readonly code: string; readonly message: string }
}
export interface GoalProjection {
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}
/** Display observations may include live activation; the durable projection never does. */
export interface GoalDisplayState extends GoalProjection { readonly activation?: GoalActivation }
export interface GoalView extends GoalSnapshot {
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly activation: GoalActivation
}
export type GoalAction = 'pause' | 'resume' | 'complete' | 'clear'
export interface GoalsRemote {
  get(sessionId: string): Promise<RemoteResult<GoalView | undefined>>
  pause(sessionId: string, ref: GoalRef): Promise<RemoteResult<GoalView>>
  resume(sessionId: string, ref: GoalRef): Promise<RemoteResult<GoalView>>
  complete(sessionId: string, ref: GoalRef): Promise<RemoteResult<GoalView>>
  clear(sessionId: string, ref: GoalRef): Promise<RemoteResult<GoalRef>>
}

export function goalsRemoteOf(value: unknown): GoalsRemote | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const remote = value as Partial<GoalsRemote>
  return ['get', 'pause', 'resume', 'complete', 'clear'].every(key =>
    typeof remote[key as keyof GoalsRemote] === 'function') ? remote as GoalsRemote : undefined
}

export function goalProjectionOf(view: GoalView | undefined): GoalDisplayState | null {
  if (!view) return null
  const { roundsStarted, createdAt, updatedAt, activation, ...goal } = view
  return { goal, roundsStarted, createdAt, updatedAt, activation }
}

export interface GoalObservation {
  readonly baseline: GoalProjection | null | undefined
  readonly value: GoalDisplayState | null
  readonly ref?: GoalRef
}

/** A successful response remains visible while the event projection catches up. */
export function currentGoalProjection(
  projected: GoalProjection | null | undefined,
  observed: GoalObservation | undefined,
): GoalDisplayState | null | undefined {
  if (!observed) return projected
  if (projected === observed.baseline) return observed.value
  const newest = observed.value?.goal ?? observed.ref
  if (projected && newest && projected.goal.id === newest.id) {
    if (projected.goal.revision < newest.revision) return observed.value
    if (projected.goal.revision === newest.revision && observed.value
      && projected.roundsStarted < observed.value.roundsStarted) return observed.value
  }
  return projected
}

export type GoalOperationResult =
  | { readonly ok: true; readonly value: GoalDisplayState | null; readonly ref: GoalRef }
  | { readonly ok: false; readonly refreshed: true; readonly value: GoalDisplayState | null }
  | { readonly ok: false; readonly refreshed: false }

/** Never retry a mutation with a new ref; refresh failures for an explicit next action. */
export async function performGoalOperation(
  remote: GoalsRemote, sessionId: string, action: GoalAction, ref: GoalRef,
): Promise<GoalOperationResult> {
  try {
    if (action === 'clear') {
      const result = await remote.clear(sessionId, ref)
      if (result.ok) return { ok: true, value: null, ref: result.value }
    } else {
      const result = await remote[action](sessionId, ref)
      if (result.ok) return { ok: true, value: goalProjectionOf(result.value), ref: result.value }
    }
  } catch { /* Read back after both wire failures and rejected results. */ }
  try {
    const result = await remote.get(sessionId)
    if (result.ok) return { ok: false, refreshed: true, value: goalProjectionOf(result.value) }
  } catch { /* The caller keeps the last known goal and offers a manual retry. */ }
  return { ok: false, refreshed: false }
}

export function goalPhaseLabel(phase: GoalPhase, activation?: GoalActivation): string {
  if (phase === 'active') return activation === 'disarmed' ? '停止中' : activation === 'armed' ? '進行中' : '状態未確認'
  return { active: '進行中', paused: '一時停止', blocked: '行き詰まり', complete: '完了' }[phase]
}

export function goalPrimaryAction(goal: GoalSnapshot, activation?: GoalActivation): 'pause' | 'resume' | undefined {
  if (goal.phase === 'active') return activation === 'disarmed' ? 'resume' : activation === 'armed' ? 'pause' : undefined
  if (goal.phase === 'paused' || goal.phase === 'blocked') return 'resume'
  return undefined
}

export function isLiveJob(job: SessionJob): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

export function sortJobs(jobs: readonly SessionJob[]): SessionJob[] {
  return [...jobs].sort((left, right) => {
    const live = Number(isLiveJob(right)) - Number(isLiveJob(left))
    if (live) return live
    const latest = (isLiveJob(right) ? right.startedAt : right.finishedAt ?? right.startedAt)
      - (isLiveJob(left) ? left.startedAt : left.finishedAt ?? left.startedAt)
    return latest || right.startedAt - left.startedAt || left.id.localeCompare(right.id)
  })
}

export function jobStatusLabel(status: SessionJob['status']): string {
  return { running: '実行中', stopping: '停止中', completed: '完了', killed: '停止済み', failed: '失敗' }[status]
}

export function jobKindLabel(kind: string): string {
  return kind === 'bash' ? 'bash' : kind === 'subagent' ? 'サブエージェント' : 'ジョブ'
}

export function jobDurationLabel(job: SessionJob, now: number): string {
  const end = isLiveJob(job) ? now : job.finishedAt ?? job.startedAt
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1000))
  if (!Number.isFinite(seconds)) return '時間不明'
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return `${Math.floor(seconds / 3600)} 時間 ${Math.floor(seconds % 3600 / 60)} 分`
}
