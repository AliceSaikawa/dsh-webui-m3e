import { useEffect, useMemo, useRef, useState } from 'react'
import { showSnackbar } from '../../app/overlay/index.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { useMessages } from '../../i18n/index.ts'
import { goalActivationFor, updateGoalActivation, watchGoalActivation } from './goal-activation.ts'
import { sessionToolsMessages } from './messages.ts'
import {
  goalStripVisible,
  type GoalStripVisibility,
} from './goal-strip-model.ts'
import {
  currentGoalProjection, goalPhaseLabel, goalPrimaryAction, goalProjectionOf, goalsEditOf, goalsRemoteOf,
  performGoalEdit, performGoalOperation,
  type GoalAction, type GoalActivation, type GoalActivationRef, type GoalDisplayState, type GoalObservation,
  type GoalProjection, type GoalRef, type GoalsRemoteWithEdit,
} from './operations.ts'

export {
  goalStripVisible,
  type GoalStripModel, type GoalStripVisibility, type GoalStripVisibleInput,
} from './goal-strip-model.ts'

export interface GoalPresenceState {
  readonly sessionId: string
  readonly current: GoalDisplayState | null | undefined
  readonly activation: GoalActivation | undefined
  readonly activationReady: boolean
  readonly activationError: boolean
  readonly readOnly: boolean
  readonly busy: boolean
  readonly error: string
  readonly needsRefresh: boolean
  readonly canEdit: boolean
  readonly goalsSupported: boolean
  readonly connected: boolean
}

export interface GoalPresence extends GoalPresenceState {
  readonly primary: 'pause' | 'resume' | undefined
  readonly statusLine: string
  readonly canMutate: boolean
  readonly exhausted: boolean
  readonly strip: GoalStripVisibility
  refresh(): Promise<void>
  retryActivation(): void
  runPrimary(): Promise<void>
  complete(): Promise<void>
  clear(): Promise<void>
  /**
   * No-op when !canEdit. Validates non-empty trimmed objective at the boundary.
   * Uses GoalsEditRemote.edit then the same observation merge path as pause/resume.
   */
  editObjective(objective: string): Promise<void>
}

/**
 * Owns watchGoalActivation + observed GoalObservation for this sessionId.
 * Only this hook (and tests) call watchGoalActivation / performGoalOperation / goalsEditOf for UI.
 */
export function useGoalPresence(sessionId: string): GoalPresence {
  const text = useMessages(sessionToolsMessages)
  const { remote, connection } = useDsh()
  const { connected } = useConnection()
  const { projection, snapshot, face } = useSession(sessionId)
  const projected = projection<GoalProjection | null>('goal')
  const [observed, setObserved] = useState<GoalObservation>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [liveActivation, setLiveActivation] = useState<GoalActivationRef>()
  const [activationError, setActivationError] = useState(false)
  const [activationReady, setActivationReady] = useState(false)
  const [activationRefresh, setActivationRefresh] = useState(0)
  const lock = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const goals = useMemo(() => goalsRemoteOf(remote.goals), [remote])
  const canEdit = Boolean(goals && goalsEditOf(goals))
  const current = currentGoalProjection(projected, observed)
  const goal = current?.goal
  const activation = goalActivationFor(goal, liveActivation)
  const primary = goal ? goalPrimaryAction(goal, activation) : undefined
  const exhausted = primary === 'resume' && !!current && current.roundsStarted >= current.goal.maxGoalRounds
  const readOnly = snapshot.subagent !== null
  const goalsSupported = Boolean(goals)
  const canMutate = !readOnly && goalsSupported && connected && activationReady
    && !busy && !needsRefresh && activation !== undefined
  const statusLine = goal
    ? text.goalStatusLine(goalPhaseLabel(goal.phase, activation, text), current!.roundsStarted, goal.maxGoalRounds)
    : ''

  useEffect(() => {
    setActivationError(false)
    setActivationReady(false)
    if (!goals || !goal || !face) return
    const watcher = watchGoalActivation(remote, goals, sessionId, value => {
      setLiveActivation(previous => updateGoalActivation(goal, previous, value))
      setActivationError(false)
      setActivationReady(true)
    }, () => { setActivationError(true); setActivationReady(false) }, {
      connection: connection.state, session: face, projection: face.projections.faceOf('goal'),
    })
    void watcher.refresh()
    return () => watcher.dispose()
  }, [remote, goals, sessionId, goal?.id, goal?.revision, connection, face, activationRefresh])

  async function refresh() {
    if (!goals || lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const result = await goals.get(sessionId)
      if (!alive.current) return
      if (!result.ok) { setError(text.goalReloadFailed); return }
      setObserved({ baseline: projected, value: goalProjectionOf(result.value) })
      setError('')
      setNeedsRefresh(false)
      setActivationRefresh(value => value + 1)
    } catch {
      if (alive.current) setError(text.goalReloadFailed)
    } finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function mutate(action: GoalAction, ref: GoalRef) {
    if (!alive.current || !goals || lock.current || !canMutate) return
    lock.current = true
    setBusy(true)
    setError('')
    const result = await performGoalOperation(goals, sessionId, action, ref)
    lock.current = false
    if (!alive.current) return
    setBusy(false)
    setActivationRefresh(value => value + 1)
    if (result.ok) {
      setObserved({ baseline: projected, value: result.value, ref: result.ref })
      showSnackbar({
        pause: text.goalPausedNotice, resume: text.goalResumedNotice,
        complete: text.goalCompletedNotice, clear: text.goalClearedNotice,
      }[action])
    } else if (result.refreshed) {
      setObserved({ baseline: projected, value: result.value })
      setError(text.mutateRefreshed)
    } else {
      setNeedsRefresh(true)
      setError(text.mutateFailed)
    }
  }

  async function editObjective(objective: string) {
    const trimmed = objective.trim()
    if (!alive.current || !goals || !canEdit || !trimmed || lock.current || !canMutate || !goal) return
    if (!goalsEditOf(goals)) return
    const ref = { id: goal.id, revision: goal.revision }
    lock.current = true
    setBusy(true)
    setError('')
    const result = await performGoalEdit(goals as GoalsRemoteWithEdit, sessionId, ref, { objective: trimmed })
    lock.current = false
    if (!alive.current) return
    setBusy(false)
    setActivationRefresh(value => value + 1)
    if (result.ok) {
      setObserved({ baseline: projected, value: result.value, ref: result.ref })
      showSnackbar(text.goalEditedNotice)
    } else if (result.refreshed) {
      setObserved({ baseline: projected, value: result.value })
      setError(text.mutateRefreshed)
    } else {
      setNeedsRefresh(true)
      setError(text.mutateFailed)
    }
  }

  const state: GoalPresenceState = {
    sessionId, current, activation, activationReady, activationError, readOnly, busy, error, needsRefresh,
    canEdit, goalsSupported, connected,
  }
  const strip = goalStripVisible({ ...state, statusLine })

  return {
    ...state, primary, statusLine, canMutate, exhausted, strip,
    refresh,
    retryActivation() { setActivationRefresh(value => value + 1) },
    async runPrimary() {
      if (!goal || !primary || (primary === 'resume' && exhausted)) return
      await mutate(primary, { id: goal.id, revision: goal.revision })
    },
    async complete() {
      if (!goal || goal.phase === 'complete') return
      await mutate('complete', { id: goal.id, revision: goal.revision })
    },
    async clear() {
      if (!goal) return
      await mutate('clear', { id: goal.id, revision: goal.revision })
    },
    editObjective,
  }
}
