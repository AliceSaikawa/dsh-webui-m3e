import type { DshRemote } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import type { GoalActivation, GoalActivationRef, GoalRef, GoalsRemote } from './operations.ts'

export interface GoalActivationChanged { readonly sessionId: string; readonly goal?: GoalActivationRef }

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
  publish: (value: GoalActivationRef | undefined) => void, failed: () => void) {
  let disposed = false
  let generation = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  const cancelRetry = () => { clearTimeout(retry); retry = undefined }
  const off = onRemoteEvent(remote, 'goal/activation-changed', event => {
    if (disposed || event.sessionId !== sessionId) return
    generation++
    cancelRetry()
    publish(event.goal)
  })
  async function refresh() {
    if (disposed) return
    cancelRetry()
    const read = ++generation
    try {
      const result = await goals.get(sessionId)
      if (disposed || read !== generation) return
      if (!result.ok) {
        failed()
        // A persisted snapshot precedes background Agent preparation. That
        // preparation need not emit an activation edge (disarmed -> disarmed).
        if (result.error.code === 'gateway/lookup-not-found' && attempts++ < 10) retry = setTimeout(() => { void refresh() }, 250)
        return
      }
      attempts = 0
      const goal = result.value
      publish(goal ? { id: goal.id, revision: goal.revision, activation: goal.activation } : undefined)
    } catch { if (!disposed && read === generation) failed() }
  }
  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      cancelRetry()
      off()
    },
  }
}
