/** How a message is shown when the reader picks part of it. */
export type MessageBody = 'plain' | 'markdown'

export interface MessageTextState {
  readonly text: string
  readonly streaming: boolean
}

/** The open actions sheet reads this. The row keeps writing the latest text into it. */
export interface MessageTextSource {
  getSnapshot(): MessageTextState
  subscribe(listener: () => void): () => void
  set(next: MessageTextState): void
}

export function createMessageTextSource(initial: MessageTextState): MessageTextSource {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (next.text === state.text && next.streaming === state.streaming) return
      state = next
      for (const listener of listeners) listener()
    },
  }
}

/** A user's bubble is the characters they sent. An assistant reply is rendered Markdown. */
export function messageBody(kind: 'user' | 'assistant'): MessageBody {
  return kind === 'user' ? 'plain' : 'markdown'
}

/**
 * A fenced block's rendered text ends with a newline the fence does not show as a command.
 * Drop that one newline. Keep a newline the command itself contains.
 */
export function codeBlockCopyText(visible: string): string {
  return visible.endsWith('\n') ? visible.slice(0, -1) : visible
}
