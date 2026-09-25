import type { DshRemote } from '../../dsh/services.ts'
import type { GoalActivation, GoalActivationRef, GoalRef, GoalsRemote } from './operations.ts'

export interface GoalActivationChanged { readonly sessionId: string; readonly goal?: GoalActivationRef }
type SubscribeActivation = (event: 'goal/activation-changed', listener: (event: GoalActivationChanged) => void) => (() => void) | void

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
  const on = typeof remote.$on === 'function' ? remote.$on as SubscribeActivation : undefined
  const off = on?.call(remote, 'goal/activation-changed', event => {
    if (disposed || event.sessionId !== sessionId) return
    generation++
    publish(event.goal)
  })
  return {
    async refresh() {
      const read = ++generation
      try {
        const result = await goals.get(sessionId)
        if (disposed || read !== generation) return
        if (!result.ok) { failed(); return }
        const goal = result.value
        publish(goal ? { id: goal.id, revision: goal.revision, activation: goal.activation } : undefined)
      } catch { if (!disposed && read === generation) failed() }
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      if (typeof off === 'function') off()
    },
  }
}
