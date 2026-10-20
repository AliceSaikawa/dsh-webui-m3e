import { useEffect, useRef } from 'react'
import { M3eButton } from '@m3e/react/button'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useMessages } from '../../i18n/index.ts'
import { useGoalPresence } from './goal-presence.ts'
import { sessionToolsMessages } from './messages.ts'

export function GoalScreen({ sessionId }: { sessionId: string }) {
  return <GoalContent key={sessionId} sessionId={sessionId} />
}

function GoalContent({ sessionId }: { sessionId: string }) {
  const text = useMessages(sessionToolsMessages)
  const presence = useGoalPresence(sessionId)
  const clearDialog = useRef<(() => void) | undefined>(undefined)
  const editDialog = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => { clearDialog.current?.(); editDialog.current?.() }, [])

  const goal = presence.current?.goal
  const disabled = presence.busy || !presence.connected || !presence.goalsSupported

  function confirmClear() {
    if (!goal || !presence.canMutate) return
    clearDialog.current = openDialog(close => <div className="st-content">
      <h2>{text.clearGoalDialogTitle}</h2>
      <p>{text.clearGoalDialogBody(goal.objective)}</p>
      <div className="st-actions">
        <M3eButton onClick={close}>{text.cancel}</M3eButton>
        <M3eButton variant="filled" onClick={() => { close(); void presence.clear() }}>{text.clearGoal}</M3eButton>
      </div>
    </div>, { label: text.clearGoalDialogLabel })
  }

  function openEdit() {
    if (!goal || !presence.canEdit || !presence.canMutate) return
    editDialog.current = openDialog(close => <TextPromptDialog
      title={text.editGoalDialogTitle}
      label={text.editGoalField}
      initialValue={goal.objective}
      multiline
      confirmLabel={text.editGoalConfirm}
      onCancel={close}
      onConfirm={async value => { await presence.editObjective(value); close() }}
    />, { label: text.editGoalDialogLabel })
  }

  return <PageScaffold title={text.goal}><div className="st-content" aria-busy={presence.busy}>
    {presence.error && <div className="st-error" role="alert"><p>{presence.error}</p>
      <M3eButton disabled={disabled} onClick={() => { void presence.refresh() }}>{text.goalReload}</M3eButton>
    </div>}
    {!goal ? <p className="st-muted">{text.noGoal}</p> : <>
      <section className="st-card st-goal-card" aria-label={text.currentGoalLabel}>
        <h2 className="st-title">{goal.objective}</h2>
        <p className="st-goal-status">{presence.statusLine}</p>
        {goal.phase === 'blocked' && goal.blockedReason && <p>{goal.blockedReason.message}</p>}
      </section>
      {!presence.goalsSupported && <p className="st-muted">{text.goalsUnsupported}</p>}
      {presence.activationError && <div className="st-error" role="alert"><p>{text.activationFailed}</p>
        <M3eButton disabled={disabled} onClick={() => presence.retryActivation()}>{text.activationReload}</M3eButton>
      </div>}
      {presence.readOnly && <p className="st-muted">{text.childGoalReadOnly}</p>}
      {presence.exhausted && <p className="st-muted">{text.roundsExhausted}</p>}
      <div className="st-goal-actions">
        {presence.primary && <M3eButton variant="outlined" disabled={!presence.canMutate || !!presence.exhausted}
          onClick={() => { void presence.runPrimary() }}>
          {presence.primary === 'pause' ? text.pauseGoal : text.resumeGoal}
        </M3eButton>}
        {presence.canEdit && !presence.readOnly && <M3eButton variant="outlined" disabled={!presence.canMutate}
          onClick={openEdit}>{text.editGoal}</M3eButton>}
        {goal.phase !== 'complete' && <M3eButton variant="filled" disabled={!presence.canMutate}
          onClick={() => { void presence.complete() }}>{text.completeGoal}</M3eButton>}
        <M3eButton className="st-goal-clear" disabled={!presence.canMutate} onClick={confirmClear}>{text.clearGoal}</M3eButton>
      </div>
    </>}
  </div></PageScaffold>
}
