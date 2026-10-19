import { useMemo, useSyncExternalStore } from 'react'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type PendingInteraction } from './interactions-store.ts'

export type {
  ApprovalDisplayReason,
  ApprovalOutcome,
  ApprovalRequestEvent,
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionIntent,
  AskUserQuestionItem,
  AskUserQuestionOption,
  AskUserQuestionRequestEvent,
  PendingApproval,
  PendingInteraction,
  PendingQuestion,
} from './interactions-store.ts'
export { isPlanReview } from './interactions-store.ts'

const store = new InteractionStore()

/** Call after boot/mock creation and before rendering the application. */
export function initializeInteractions(ctx: InteractionContext): () => void {
  try {
    return registerInteractionHandlers(ctx, store)
  } catch (error) {
    // This module owns the store. A failed start shows the boot failure
    // screen, so end anything the store still holds before rethrowing.
    store.dispose()
    throw error
  }
}

export function usePendingInteractions(sessionId?: string): PendingInteraction[] {
  const pending = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return useMemo(() => sessionId === undefined ? pending : pending.filter((item) => item.sessionId === sessionId), [pending, sessionId])
}

export function defer(key: string): void {
  store.defer(key)
}

export function presentQuestion(key: string): () => void {
  return store.presentQuestion(key)
}

export function resetDeferred(sessionId: string): void {
  store.resetDeferred(sessionId)
}
