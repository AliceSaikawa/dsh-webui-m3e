import type { InboxMessage, InboxState, QueuedMessage } from './services.ts'

/** Match stock conversation/chat: next-turn, plus human next-step messages. */
export function queueFromInbox(inbox: InboxState | undefined): QueuedMessage[] {
  const row = (message: InboxMessage, placement: QueuedMessage['placement']): QueuedMessage => {
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    return { id: message.id, messageId: message.id, placement, rpcId: message.source.kind === 'user' ? message.source.rpcId : undefined, content: message.content, preview: text, text }
  }
  return [...(inbox?.['next-turn'] ?? []).map(message => row(message, 'queued')),
    ...(inbox?.['next-step'] ?? []).filter(message => message.source.kind === 'user').map(message => row(message, 'steering'))]
}
