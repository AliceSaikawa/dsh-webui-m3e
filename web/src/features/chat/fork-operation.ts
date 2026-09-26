import type { ISessions } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'

export type ForkState =
  | { readonly status: 'idle' | 'pending' }
  | { readonly status: 'success'; readonly sessionId: string }
  | { readonly status: 'error'; readonly message: string }

/** The operation outlives an interrupted sheet, including its completed result. */
export function createForkOperation(fork: () => Promise<string>) {
  let state: ForkState = { status: 'idle' }
  let flight: Promise<void> | undefined
  let navigationClaimed = false
  const listeners = new Set<() => void>()
  const update = (next: ForkState) => { state = next; listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    start: (): Promise<void> => {
      if (flight) return flight
      if (state.status === 'success') return Promise.resolve()
      // Start on a microtask so even a synchronous callback cannot reenter first.
      flight = Promise.resolve().then(fork).then(
        sessionId => update({ status: 'success', sessionId }),
        cause => update({ status: 'error', message: remoteErrorMessage(cause, '会話を分岐できませんでした。') }),
      ).finally(() => { flight = undefined })
      update({ status: 'pending' })
      return flight
    },
    claimNavigation: (): string | undefined => {
      if (state.status !== 'success' || navigationClaimed) return undefined
      navigationClaimed = true
      return state.sessionId
    },
  }
}

export type ForkOperation = ReturnType<typeof createForkOperation>
const operations = new WeakMap<Pick<ISessions, 'fork'>, Map<string, ForkOperation>>()

export function messageForkOperation(sessions: Pick<ISessions, 'fork'>, sessionId: string, atSeq: number): ForkOperation {
  let messages = operations.get(sessions)
  if (!messages) { messages = new Map(); operations.set(sessions, messages) }
  const key = JSON.stringify([sessionId, atSeq])
  let operation = messages.get(key)
  if (!operation) {
    operation = createForkOperation(() => sessions.fork({ sessionId, atSeq }))
    messages.set(key, operation)
  }
  return operation
}
