import { useEffect, useMemo, useRef, useState } from 'react'
import { showSnackbar } from '../../app/overlay/index.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { useMessages } from '../../i18n/index.ts'
import { goalActivationFor, updateGoalActivation, watchGoalActivation } from './goal-activation.ts'
import { sessionToolsMessages } from './messages.ts'
import {
  goalPresenceModel,
  type GoalPresenceModel,
} from './goal-presence-model.ts'
import {
  currentGoalProjection, goalProjectionOf, goalsEditOf, goalsRemoteOf,
  performGoalEdit, performGoalOperation,
  type GoalAction, type GoalActivation, type GoalActivationRef, type GoalDisplayState, type GoalObservation,
  type GoalProjection, type GoalRef,
} from './operations.ts'

export {
  GOAL_STRIP_MIN_VIEWPORT_HEIGHT, goalStripFits,
  type GoalPresenceInput, type GoalStripAction, type GoalStripActionKind, type GoalStripMessage,
  type GoalStripModel, type GoalStripVisibility,
} from './goal-presence-model.ts'

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
  readonly goalsSupported: boolean
  readonly connected: boolean
}

export interface GoalPresence extends GoalPresenceState, GoalPresenceModel {
  refresh(): Promise<void>
  retryActivation(): void
  runPrimary(): Promise<void>
  complete(): Promise<void>
  clear(): Promise<void>
  /**
   * Saves against `ref`, the goal the dialog was opened on, so the Host's
   * revision check rejects input written from an older or replaced goal.
   * No-op when unmounted or the trimmed objective is unchanged. Throws
   * text.mutateFailed / text.mutateRefreshed so the prompt dialog stays open
   * with its inline error. Uses GoalsEditRemote.edit then the same observation
   * merge path as pause/resume.
   */
  editObjective(edit: { readonly ref: GoalRef; readonly objective: string }): Promise<void>
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
  const editor = useMemo(() => goals && goalsEditOf(goals), [goals])
  const current = currentGoalProjection(projected, observed)
  const goal = current?.goal
  const activation = goalActivationFor(goal, liveActivation)
  const readOnly = snapshot.subagent !== null
  const goalsSupported = Boolean(goals)
  const editSupported = Boolean(editor)

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

  const state: GoalPresenceState = {
    sessionId, current, activation, activationReady, activationError, readOnly, busy, error, needsRefresh,
    goalsSupported, connected,
  }
  const model = goalPresenceModel({ ...state, editSupported }, text)
  const { canMutate, canEdit } = model

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

  async function editObjective({ ref, objective }: { readonly ref: GoalRef; readonly objective: string }) {
    const trimmed = objective.trim()
    if (!alive.current) return
    if (goal && trimmed === goal.objective) return
    if (!editor || !trimmed || lock.current || !canMutate || !canEdit || !goal) {
      throw new Error(text.mutateFailed)
    }
    lock.current = true
    setBusy(true)
    setError('')
    const result = await performGoalEdit(editor, sessionId, ref, { objective: trimmed })
    lock.current = false
    if (!alive.current) return
    setBusy(false)
    setActivationRefresh(value => value + 1)
    if (result.ok) {
      setObserved({ baseline: projected, value: result.value, ref: result.ref })
      showSnackbar(text.goalEditedNotice)
      return
    }
    const message = result.refreshed ? text.mutateRefreshed : text.mutateFailed
    if (result.refreshed) {
      setObserved({ baseline: projected, value: result.value })
    } else {
      setNeedsRefresh(true)
    }
    setError(message)
    throw new Error(message)
  }

  const latestEdit = useRef(editObjective)
  latestEdit.current = editObjective

  return {
    ...state, ...model,
    refresh,
    retryActivation() { setActivationRefresh(value => value + 1) },
    async runPrimary() {
      if (!goal || !model.primary || (model.primary === 'resume' && model.exhausted)) return
      await mutate(model.primary, { id: goal.id, revision: goal.revision })
    },
    async complete() {
      if (!goal || goal.phase === 'complete') return
      await mutate('complete', { id: goal.id, revision: goal.revision })
    },
    async clear() {
      if (!goal) return
      await mutate('clear', { id: goal.id, revision: goal.revision })
    },
    editObjective: edit => latestEdit.current(edit),
  }
}
