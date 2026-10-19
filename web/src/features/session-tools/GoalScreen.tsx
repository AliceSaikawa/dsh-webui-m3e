import { useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { openDialog, showSnackbar } from '../../app/overlay/index.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import {
  currentGoalProjection, goalPhaseLabel, goalPrimaryAction, goalProjectionOf, goalsRemoteOf, performGoalOperation,
  type GoalAction, type GoalActivationRef, type GoalObservation, type GoalProjection, type GoalRef,
} from './operations.ts'
import { goalActivationFor, updateGoalActivation, watchGoalActivation } from './goal-activation.ts'
import { useMessages } from '../../i18n/index.ts'
import { sessionToolsMessages } from './messages.ts'

export function GoalScreen({ sessionId }: { sessionId: string }) {
  return <GoalContent key={sessionId} sessionId={sessionId} />
}

function GoalContent({ sessionId }: { sessionId: string }) {
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
  const clearDialog = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearDialog.current?.() }
  }, [])
  const goals = useMemo(() => goalsRemoteOf(remote.goals), [remote])
  const current = currentGoalProjection(projected, observed)
  const goal = current?.goal
  const activation = goalActivationFor(goal, liveActivation)
  const primary = goal ? goalPrimaryAction(goal, activation) : undefined
  const exhausted = primary === 'resume' && current && current.roundsStarted >= current.goal.maxGoalRounds
  const disabled = busy || !connected || !goals
  const readOnly = snapshot.subagent !== null
  const mutationDisabled = disabled || readOnly || needsRefresh || !activationReady || activation === undefined

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
    if (!alive.current || !goals || lock.current || mutationDisabled) return
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
      showSnackbar({ pause: text.goalPausedNotice, resume: text.goalResumedNotice, complete: text.goalCompletedNotice, clear: text.goalClearedNotice }[action])
    } else if (result.refreshed) {
      setObserved({ baseline: projected, value: result.value })
      setError(text.mutateRefreshed)
    } else {
      setNeedsRefresh(true)
      setError(text.mutateFailed)
    }
  }

  function confirmClear() {
    if (!goal || mutationDisabled) return
    const ref = { id: goal.id, revision: goal.revision }
    clearDialog.current = openDialog(close => <div className="st-content">
      <h2>{text.clearGoalDialogTitle}</h2>
      <p>{text.clearGoalDialogBody(goal.objective)}</p>
      <div className="st-actions">
        <M3eButton onClick={close}>{text.cancel}</M3eButton>
        <M3eButton variant="filled" onClick={() => { close(); void mutate('clear', ref) }}>{text.clearGoal}</M3eButton>
      </div>
    </div>, { label: text.clearGoalDialogLabel })
  }

  return <PageScaffold title={text.goal}><div className="st-content" aria-busy={busy}>
    {error && <div className="st-error" role="alert"><p>{error}</p>
      <M3eButton disabled={disabled} onClick={() => { void refresh() }}>{text.goalReload}</M3eButton>
    </div>}
    {!goal ? <p className="st-muted">{text.noGoal}</p> : <>
      <section className="st-card st-goal-card" aria-label={text.currentGoalLabel}>
        <h2 className="st-title">{goal.objective}</h2>
        <p className="st-goal-status">{text.goalStatusLine(goalPhaseLabel(goal.phase, activation, text), current!.roundsStarted, goal.maxGoalRounds)}</p>
        {goal.phase === 'blocked' && goal.blockedReason && <p>{goal.blockedReason.message}</p>}
      </section>
      {!goals && <p className="st-muted">{text.goalsUnsupported}</p>}
      {activationError && <div className="st-error" role="alert"><p>{text.activationFailed}</p>
        <M3eButton disabled={disabled} onClick={() => setActivationRefresh(value => value + 1)}>{text.activationReload}</M3eButton>
      </div>}
      {readOnly && <p className="st-muted">{text.childGoalReadOnly}</p>}
      {exhausted && <p className="st-muted">{text.roundsExhausted}</p>}
      <div className="st-goal-actions">
        {primary && <M3eButton variant="outlined" disabled={mutationDisabled || !!exhausted}
          onClick={() => { void mutate(primary, { id: goal.id, revision: goal.revision }) }}>
          {primary === 'pause' ? text.pauseGoal : text.resumeGoal}
        </M3eButton>}
        {goal.phase !== 'complete' && <M3eButton variant="filled" disabled={mutationDisabled}
          onClick={() => { void mutate('complete', { id: goal.id, revision: goal.revision }) }}>{text.completeGoal}</M3eButton>}
        <M3eButton className="st-goal-clear" disabled={mutationDisabled} onClick={confirmClear}>{text.clearGoal}</M3eButton>
      </div>
    </>}
  </div></PageScaffold>
}
