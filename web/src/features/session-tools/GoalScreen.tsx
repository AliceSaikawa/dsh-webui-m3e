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

export function GoalScreen({ sessionId }: { sessionId: string }) {
  return <GoalContent key={sessionId} sessionId={sessionId} />
}

function GoalContent({ sessionId }: { sessionId: string }) {
  const { remote } = useDsh()
  const { connected } = useConnection()
  const { projection, snapshot } = useSession(sessionId)
  const projected = projection<GoalProjection | null>('goal')
  const [observed, setObserved] = useState<GoalObservation>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [liveActivation, setLiveActivation] = useState<GoalActivationRef>()
  const [activationError, setActivationError] = useState(false)
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
  const mutationDisabled = disabled || readOnly || needsRefresh

  useEffect(() => {
    setActivationError(false)
    if (!goals || !connected || !goal) return
    const watcher = watchGoalActivation(remote, goals, sessionId, value => {
      setLiveActivation(previous => updateGoalActivation(goal, previous, value))
      setActivationError(false)
    }, () => setActivationError(true))
    void watcher.refresh()
    return () => watcher.dispose()
  }, [remote, goals, sessionId, goal?.id, goal?.revision, connected, snapshot.running, activationRefresh])

  async function refresh() {
    if (!goals || lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const result = await goals.get(sessionId)
      if (!alive.current) return
      if (!result.ok) { setError('ゴールを読み直せませんでした。もう一度お試しください。'); return }
      setObserved({ baseline: projected, value: goalProjectionOf(result.value) })
      setError('')
      setNeedsRefresh(false)
      setActivationRefresh(value => value + 1)
    } catch {
      if (alive.current) setError('ゴールを読み直せませんでした。もう一度お試しください。')
    } finally {
      lock.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function mutate(action: GoalAction, ref: GoalRef) {
    if (!alive.current || !goals || lock.current || !connected || readOnly || needsRefresh) return
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
      showSnackbar({ pause: 'ゴールを一時停止しました', resume: 'ゴールを再開しました', complete: 'ゴールを完了にしました', clear: 'ゴールを消しました' }[action])
    } else if (result.refreshed) {
      setObserved({ baseline: projected, value: result.value })
      setError('変更できませんでした。最新のゴールを読み直しました。内容を確かめて、もう一度操作してください。')
    } else {
      setNeedsRefresh(true)
      setError('変更できませんでした。最新のゴールを読み直してから、もう一度操作してください。')
    }
  }

  function confirmClear() {
    if (!goal || mutationDisabled) return
    const ref = { id: goal.id, revision: goal.revision }
    clearDialog.current = openDialog(close => <div className="st-content">
      <h2>ゴールを消しますか？</h2>
      <p>「{goal.objective}」をこの会話から消します。</p>
      <div className="st-actions">
        <M3eButton onClick={close}>キャンセル</M3eButton>
        <M3eButton variant="filled" onClick={() => { close(); void mutate('clear', ref) }}>ゴールを消す</M3eButton>
      </div>
    </div>, { label: 'ゴールを消す確認' })
  }

  return <PageScaffold title="ゴール"><div className="st-content" aria-busy={busy}>
    {error && <div className="st-error" role="alert"><p>{error}</p>
      <M3eButton disabled={disabled} onClick={() => { void refresh() }}>読み直す</M3eButton>
    </div>}
    {!goal ? <p className="st-muted">ゴールはありません。</p> : <>
      <section className="st-card" aria-label="現在のゴール">
        <span className="st-badge">{goalPhaseLabel(goal.phase, activation)}</span>
        <h2 className="st-title">{goal.objective}</h2>
        <p className="st-muted">ラウンド {current!.roundsStarted} / {goal.maxGoalRounds}</p>
        {goal.phase === 'blocked' && goal.blockedReason && <p>{goal.blockedReason.message}</p>}
      </section>
      {!goals && <p className="st-muted">この接続先ではゴールを操作できません。</p>}
      {activationError && <div className="st-error" role="alert"><p>ゴールの実行状態を確認できませんでした。</p>
        <M3eButton disabled={disabled} onClick={() => setActivationRefresh(value => value + 1)}>状態を読み直す</M3eButton>
      </div>}
      {readOnly && <p className="st-muted">子の会話のゴールは読むだけです。</p>}
      {exhausted && <p className="st-muted">ラウンド数の上限に達したため、再開できません。</p>}
      <div className="st-actions">
        {primary && <M3eButton variant="tonal" disabled={mutationDisabled || !!exhausted}
          onClick={() => { void mutate(primary, { id: goal.id, revision: goal.revision }) }}>
          {primary === 'pause' ? '一時停止' : '再開'}
        </M3eButton>}
        {goal.phase !== 'complete' && <M3eButton variant="filled" disabled={mutationDisabled}
          onClick={() => { void mutate('complete', { id: goal.id, revision: goal.revision }) }}>完了にする</M3eButton>}
        <M3eButton disabled={mutationDisabled} onClick={confirmClear}>ゴールを消す</M3eButton>
      </div>
    </>}
  </div></PageScaffold>
}
