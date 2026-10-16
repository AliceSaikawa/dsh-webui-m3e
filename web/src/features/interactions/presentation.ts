import type { AskUserQuestionItem, PendingInteraction } from '../../dsh/interactions-store.ts'
import { messagesOf } from '../../i18n/catalog.ts'
import { interactionMessages, type InteractionText } from './messages.ts'

/** A single plan gets its heading from Markdown, not from question metadata. */
export function questionPresentation(items: readonly AskUserQuestionItem[], index: number, text: InteractionText = messagesOf(interactionMessages, 'ja')) {
  const item = items[index]
  const standalonePlan = items.length === 1 && item?.intent?.kind === 'plan-review'
  return {
    standalonePlan,
    progress: item && !standalonePlan ? text.progress(index + 1, items.length) : undefined,
    header: standalonePlan ? undefined : item?.header,
    title: standalonePlan ? undefined : item?.question,
  }
}

/** Reopening a deferred item does not clear its defer flag or send an answer. */
export function deferredInteractions(pending: readonly PendingInteraction[], sessionId: string): PendingInteraction[] {
  return pending.filter(item => item.sessionId === sessionId && item.deferred)
}
