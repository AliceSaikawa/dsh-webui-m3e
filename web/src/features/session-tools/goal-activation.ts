import type { ConnectionState, DshRemote, ObservableSnapshot, SessionSnapshot } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import type { GoalActivation, GoalActivationRef, GoalRef, GoalsRemote } from './operations.ts'

export interface GoalActivationChanged { readonly sessionId: string; readonly goal?: GoalActivationRef }
export interface GoalActivationLifecycle {
  readonly connection: ObservableSnapshot<ConnectionState>
  readonly session: ObservableSnapshot<Pick<SessionSnapshot, 'removed' | 'openState' | 'lastAgentError' | 'running'>>
}

export function goalActivationFor(ref: GoalRef | undefined, live: GoalActivationRef | undefined): GoalActivation | undefined {
  return ref && live?.id === ref.id && live.revision === ref.revision ? live.activation : undefined
}
/** Keep the last matching value until this exact goal has a fresh observation. */
export function updateGoalActivation(ref: GoalRef, previous: GoalActivationRef | undefined, received: GoalActivationRef | undefined): GoalActivationRef | undefined {
  if (goalActivationFor(ref, received) !== undefined) return received
  return goalActivationFor(ref, previous) !== undefined ? previous : undefined
}

/** Subscribe before reading. A later event always wins over an in-flight RPC. */
export function watchGoalActivation(remote: DshRemote, goals: GoalsRemote, sessionId: string,
  publish: (value: GoalActivationRef | undefined) => void, failed: () => void, lifecycle?: GoalActivationLifecycle) {
  let disposed = false
  let generation = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const cancelRetry = () => { clearTimeout(retry); retry = undefined }
  const canRead = () => !lifecycle || (lifecycle.connection.getSnapshot() === 'connected'
    && !lifecycle.session.getSnapshot().removed && lifecycle.session.getSnapshot().openState === 'open')
  const off = onRemoteEvent(remote, 'goal/activation-changed', event => {
    if (disposed || event.sessionId !== sessionId || !canRead()) return
    generation++
    cancelRetry()
    publish(event.goal)
  })
  async function refresh() {
    if (disposed) return
    cancelRetry()
    const read = ++generation
    if (!canRead()) { failed(); return }
    try {
      const result = await goals.get(sessionId)
      if (disposed || read !== generation) return
      if (!result.ok) {
        failed()
        // A persisted snapshot precedes background Agent preparation. That
        // preparation need not emit an activation edge (disarmed -> disarmed).
        // lastAgentError survives reconnect and successful Agent preparation;
        // it is not evidence that this read's preparation has failed. A new
        // failure observed by changed() invalidates the read and cancels polling.
        // Reconnect or manual refresh can therefore start a new wait even while
        // that historical diagnostic remains. Preparation has no deadline.
        if (result.error.code === 'gateway/lookup-not-found') {
          retry = setTimeout(() => { void refresh() }, 250)
        }
        return
      }
      const goal = result.value
      publish(goal ? { id: goal.id, revision: goal.revision, activation: goal.activation } : undefined)
    } catch { if (!disposed && read === generation) failed() }
  }
  let previousConnection = lifecycle?.connection.getSnapshot()
  let previousSession = lifecycle?.session.getSnapshot()
  const changed = () => {
    if (disposed || !lifecycle) return
    const connection = lifecycle.connection.getSnapshot(), session = lifecycle.session.getSnapshot()
    const previous = previousSession!
    if (connection === previousConnection && session.removed === previous.removed && session.openState === previous.openState
      && session.lastAgentError === previous.lastAgentError && session.running === previous.running) return
    const newError = session.lastAgentError !== previous.lastAgentError && session.lastAgentError !== null
    previousConnection = connection
    previousSession = session
    generation++
    cancelRetry()
    if (!canRead() || newError) { failed(); return }
    void refresh()
  }
  const disposers = lifecycle ? [lifecycle.connection.subscribe(changed), lifecycle.session.subscribe(changed)] : []
  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      cancelRetry()
      off()
      for (const dispose of disposers) dispose()
    },
  }
}
