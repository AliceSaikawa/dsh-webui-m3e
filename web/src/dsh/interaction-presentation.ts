import type { PendingInteraction } from './interactions-store.ts'

type PendingState = Pick<PendingInteraction, 'sessionId' | 'kind' | 'deferred'>
interface InteractionOverlay { sessionId?: string; interactionKey?: string }

/** Deferring an approval changes its presentation, not the requirement to answer. */
export function shouldHideComposer(
  sessionId: string,
  pending: readonly PendingState[],
  overlays: readonly InteractionOverlay[],
): boolean {
  return pending.some((item) => item.sessionId === sessionId && (item.kind === 'approval' || !item.deferred))
    || overlays.some((entry) => entry.sessionId === sessionId && !!entry.interactionKey)
}
