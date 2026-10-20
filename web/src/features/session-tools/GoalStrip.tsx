import { useEffect, useId, useRef } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useViewport } from '../../app/viewport.ts'
import { useMessages } from '../../i18n/index.ts'
import { goalStripFits, type GoalStripActionKind } from './goal-presence-model.ts'
import { useGoalPresence } from './goal-presence.ts'
import { sessionToolsMessages } from './messages.ts'

const actionPresentation = {
  pause: { label: 'pauseGoal', icon: 'pause' },
  resume: { label: 'resumeGoal', icon: 'play_arrow' },
  edit: { label: 'editGoal', icon: 'edit' },
  reload: { label: 'goalReload', icon: 'refresh' },
  'retry-activation': { label: 'activationReload', icon: 'refresh' },
} as const

export function GoalStrip({ sessionId }: { readonly sessionId: string }) {
  const text = useMessages(sessionToolsMessages)
  const presence = useGoalPresence(sessionId)
  const viewport = useViewport()
  const hintId = useId()
  const editDialog = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => { editDialog.current?.() }, [])

  if (presence.strip.kind === 'hidden' || !goalStripFits(viewport.height)) return null
  const model = presence.strip.model

  function openEdit() {
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

  function run(kind: GoalStripActionKind) {
    switch (kind) {
      case 'pause': case 'resume': void presence.runPrimary(); return
      case 'edit': openEdit(); return
      case 'reload': void presence.refresh(); return
      case 'retry-activation': presence.retryActivation(); return
    }
  }

  return <div className="goal-strip" role="group" aria-label={text.goalStripLabel} data-testid="goal-strip">
    <button type="button" className="goal-strip-body" aria-describedby={hintId}
      onClick={() => navigate(`/s/${encodeURIComponent(sessionId)}/goal`)}>
      <span className="goal-strip-objective">{model.objective}</span>
      <span className="goal-strip-status">{model.statusLine}</span>
    </button>
    <span id={hintId} hidden>{text.goalStripOpen}</span>
    {model.actions.length > 0 && <div className="goal-strip-actions">
      {model.actions.map(action => <M3eIconButton key={action.kind} aria-label={text[actionPresentation[action.kind].label]}
        disabled={!action.enabled} onClick={() => run(action.kind)}>
        <Icon name={actionPresentation[action.kind].icon} />
      </M3eIconButton>)}
    </div>}
    {model.message && <p className={`goal-strip-message${model.message.tone === 'error' ? ' goal-strip-message-error' : ''}`}
      role={model.message.tone === 'error' ? 'alert' : undefined}>{model.message.text}</p>}
  </div>
}
