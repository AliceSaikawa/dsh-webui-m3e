import type { RemoteResult, SessionJob } from '../../dsh/services.ts'
import { sessionToolsMessages, type SessionToolsText } from './messages.ts'

/** Japanese texts used when no dictionary is passed (non-React calls, tests). */
const defaultText: SessionToolsText = sessionToolsMessages.ja

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

/** Optional host fields for goals.edit — not required on GoalsRemote. */
export interface EditGoalRequest {
  readonly objective?: string
  readonly maxGoalRounds?: number
}

/**
 * Optional host capability. Not required for goalsRemoteOf to succeed.
 * Presence exposes canEdit only when this method exists on the remote.
 */
export interface GoalsEditRemote {
  edit(sessionId: string, ref: GoalRef, request: EditGoalRequest): Promise<RemoteResult<GoalView>>
}

export type GoalsRemoteWithEdit = GoalsRemote & GoalsEditRemote

export function goalsRemoteOf(value: unknown): GoalsRemote | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const remote = value as Partial<GoalsRemote>
  return ['get', 'pause', 'resume', 'complete', 'clear'].every(key =>
    typeof remote[key as keyof GoalsRemote] === 'function') ? remote as GoalsRemote : undefined
}

/** One gate for edit UI; callers never probe remote.edit themselves. */
export function goalsEditOf(remote: GoalsRemote): GoalsEditRemote | undefined {
  const candidate = remote as GoalsRemote & Partial<GoalsEditRemote>
  return typeof candidate.edit === 'function' ? candidate as GoalsEditRemote : undefined
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

/** Same refresh-on-fail pattern as performGoalOperation; never retries with a new ref. */
export async function performGoalEdit(
  remote: GoalsRemoteWithEdit, sessionId: string, ref: GoalRef, request: EditGoalRequest,
): Promise<GoalOperationResult> {
  try {
    const result = await remote.edit(sessionId, ref, request)
    if (result.ok) return { ok: true, value: goalProjectionOf(result.value), ref: result.value }
  } catch { /* Read back after both wire failures and rejected results. */ }
  try {
    const result = await remote.get(sessionId)
    if (result.ok) return { ok: false, refreshed: true, value: goalProjectionOf(result.value) }
  } catch { /* The caller keeps the last known goal and offers a manual retry. */ }
  return { ok: false, refreshed: false }
}

export function goalPhaseLabel(phase: GoalPhase, activation?: GoalActivation, text: SessionToolsText = defaultText): string {
  if (phase === 'active') return activation === 'disarmed' ? text.goalPhaseStopping : activation === 'armed' ? text.goalPhaseRunning : text.goalPhaseUnknown
  return { active: text.goalPhaseRunning, paused: text.goalPhasePaused, blocked: text.goalPhaseBlocked, complete: text.goalPhaseComplete }[phase]
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

export function jobStatusLabel(status: SessionJob['status'], text: SessionToolsText = defaultText): string {
  return { running: text.jobStatusRunning, stopping: text.jobStatusStopping, completed: text.jobStatusCompleted, killed: text.jobStatusKilled, failed: text.jobStatusFailed }[status]
}

/** Kinds actually produced by DSH 0.2.1 (dsh-tool-bash/lib/index.js:395, dsh-tool-pwsh/lib/index.js:369,
    dsh-tool-workflow/lib/index.js:225, dsh-tool-terminal/lib/index.js:404). `subagent` no longer exists. */
export function jobKindLabel(kind: string, text: SessionToolsText = defaultText): string {
  return kind === 'bash' ? text.jobKindBash : kind === 'pwsh' ? text.jobKindPwsh
    : kind === 'workflow' ? text.jobKindWorkflow : kind === 'pty-send' ? text.jobKindPtySend : text.jobKindOther
}

export function jobDurationLabel(job: SessionJob, now: number, text: SessionToolsText = defaultText): string {
  const end = isLiveJob(job) ? now : job.finishedAt ?? job.startedAt
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1000))
  if (!Number.isFinite(seconds)) return text.durationUnknown
  if (seconds < 60) return text.durationSeconds(seconds)
  if (seconds < 3600) return text.durationMinutesSeconds(Math.floor(seconds / 60), seconds % 60)
  return text.durationHoursMinutes(Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60))
}
