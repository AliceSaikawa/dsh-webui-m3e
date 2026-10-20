import { useRef } from 'react'
import { M3eButton } from '@m3e/react/button'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useMessages } from '../../i18n/index.ts'
import { useGoalPresence } from './goal-presence.ts'
import { sessionToolsMessages } from './messages.ts'

export function GoalStrip({ sessionId }: { readonly sessionId: string }) {
  const text = useMessages(sessionToolsMessages)
  const presence = useGoalPresence(sessionId)
  const editDialog = useRef<(() => void) | undefined>(undefined)
  if (presence.strip.kind === 'hidden') return null
  const model = presence.strip.model

  function openEdit() {
    if (!model.canEdit) return
    editDialog.current?.()
    editDialog.current = openDialog(close => <TextPromptDialog
      title={text.editGoalDialogTitle}
      label={text.editGoalField}
      initialValue={model.objective}
      multiline
      confirmLabel={text.editGoalConfirm}
      onCancel={close}
      onConfirm={async value => { await presence.editObjective(value); close() }}
    />, { label: text.editGoalDialogLabel })
  }

  return <div className="goal-strip" data-testid="goal-strip" aria-label={text.goalStripLabel}>
    <button type="button" className="goal-strip-body" aria-label={text.goalStripOpen}
      onClick={() => navigate(`/s/${encodeURIComponent(sessionId)}/goal`)}>
      <span className="goal-strip-objective">{model.objective}</span>
      <span className="goal-strip-status">{model.statusLine}</span>
      {model.blockedMessage && <span className="goal-strip-blocked">{model.blockedMessage}</span>}
    </button>
    {!presence.readOnly && <div className="goal-strip-actions">
      {model.primary && <M3eButton variant="outlined" disabled={!model.canMutate || !!model.exhausted}
        onClick={() => { void presence.runPrimary() }}>
        {model.primary === 'pause' ? text.pauseGoal : text.resumeGoal}
      </M3eButton>}
      {model.canEdit && <M3eButton variant="text" disabled={!model.canMutate}
        onClick={openEdit}>{text.editGoal}</M3eButton>}
    </div>}
    {model.inlineError && <p className="goal-strip-error" role="alert">{model.inlineError}</p>}
  </div>
}
