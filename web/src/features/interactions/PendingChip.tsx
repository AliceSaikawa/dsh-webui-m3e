import { useLayoutEffect } from 'react'
import { M3eAssistChip } from '@m3e/react/chips'
import { Icon } from '../../app/icons/Icon.tsx'
import { usePendingInteractions } from '../../dsh/interactions.ts'
import { useMessages } from '../../i18n/index.ts'
import { presentInteraction, pruneInteractionDrafts } from './InteractionSheet.tsx'
import { hasPlanReview } from './answers.ts'
import { interactionMessages } from './messages.ts'
import { deferredInteractions } from './presentation.ts'

export function PendingChip({ sessionId }: { sessionId: string }) {
  const text = useMessages(interactionMessages)
  const pending = usePendingInteractions()
  useLayoutEffect(() => { pruneInteractionDrafts(new Set(pending.map(item => item.key))) }, [pending])
  const deferred = deferredInteractions(pending, sessionId)
  if (!deferred.length) return null
  return <div className="interaction-pending-chips">{deferred.map(item => <M3eAssistChip key={item.key}
    onClick={() => presentInteraction(item, { from: 'conversation' })}>
    <Icon slot="icon" name="front_hand" />
    {item.kind === 'approval' ? text.pendingApproval : hasPlanReview(item.items) ? text.pendingPlan : text.pendingQuestion}
  </M3eAssistChip>)}</div>
}
