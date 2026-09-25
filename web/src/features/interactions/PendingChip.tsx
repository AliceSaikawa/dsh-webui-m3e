import { useLayoutEffect } from 'react'
import { M3eAssistChip } from '@m3e/react/chips'
import { Icon } from '../../app/icons/Icon.tsx'
import { usePendingInteractions } from '../../dsh/interactions.ts'
import { presentInteraction, pruneInteractionDrafts } from './InteractionSheet.tsx'
import { hasPlanReview } from './answers.ts'

export function PendingChip({ sessionId }: { sessionId: string }) {
  const pending = usePendingInteractions()
  useLayoutEffect(() => { pruneInteractionDrafts(new Set(pending.map(item => item.key))) }, [pending])
  const deferred = pending.filter(item => item.sessionId === sessionId && item.deferred)
  if (!deferred.length) return null
  return <div className="interaction-pending-chips">{deferred.map(item => <M3eAssistChip key={item.key}
    onClick={() => presentInteraction(item, { from: 'conversation' })}>
    <Icon slot="icon" name="front_hand" />
    {item.kind === 'approval' ? '返事待ちの承認があります' : hasPlanReview(item.items) ? '返事待ちのプランがあります' : '返事待ちの質問があります'}
  </M3eAssistChip>)}</div>
}
