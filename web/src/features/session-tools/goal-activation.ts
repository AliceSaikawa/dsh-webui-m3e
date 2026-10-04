import type { ConnectionState, DshRemote, ObservableSnapshot, SessionSnapshot } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import type { GoalActivation, GoalActivationRef, GoalRef, GoalsRemote } from './operations.ts'

export interface GoalActivationChanged { readonly sessionId: string; readonly goal?: GoalActivationRef }
export interface GoalActivationLifecycle {
  readonly connection: ObservableSnapshot<ConnectionState>
  readonly session: ObservableSnapshot<Pick<SessionSnapshot, 'removed' | 'openState' | 'running'>>
  readonly projection?: ObservableSnapshot<unknown>
}

export function goalActivationFor(ref: GoalRef | undefined, live: GoalActivationRef | undefined): GoalActivation | undefined {
  return ref && live?.id === ref.id && live.revision === ref.revision ? live.activation : undefined
}
/** Keep the last matching value until this exact goal has a fresh observation. */
export function updateGoalActivation(ref: GoalRef, previous: GoalActivationRef | undefined, received: GoalActivationRef | undefined): GoalActivationRef | undefined {
  if (goalActivationFor(ref, received) !== undefined) return received
  return goalActivationFor(ref, previous) !== undefined ? previous : undefined
}

/**
 * Subscribe before reading, like the stock goal activation source. Failed reads
 * wait for a state edge or an explicit refresh, never a timer. Agent creation
 * emits api-session/added even when goal activation remains disarmed. Each
 * failure event invalidates in-flight reads, regardless of its diagnostic text.
 */
export function watchGoalActivation(remote: DshRemote, goals: GoalsRemote, sessionId: string,
  publish: (value: GoalActivationRef | undefined) => void, failed: () => void, lifecycle?: GoalActivationLifecycle) {
  let disposed = false
  let generation = 0
  const canRead = () => !lifecycle || (lifecycle.connection.getSnapshot() === 'connected'
    && !lifecycle.session.getSnapshot().removed && lifecycle.session.getSnapshot().openState === 'open')
  const offActivation = onRemoteEvent(remote, 'goal/activation-changed', event => {
    if (disposed || event.sessionId !== sessionId || !canRead()) return
    generation++
    publish(event.goal)
  })
  const offAvailability = onRemoteEvent(remote, 'api-session/added', summary => {
    if (disposed || summary.sessionId !== sessionId || !canRead()) return
    if (summary.agentAvailable) void refresh()
    else { generation++; failed() }
  })
  const offError = onRemoteEvent(remote, 'api-session/error', id => {
    if (disposed || id !== sessionId || !canRead()) return
    generation++
    failed()
  })
  async function refresh() {
    if (disposed) return
    const read = ++generation
    if (!canRead()) { failed(); return }
    try {
      const result = await goals.get(sessionId)
      if (disposed || read !== generation || !canRead()) return
      if (!result.ok) {
        failed()
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
      && session.running === previous.running) return
    previousConnection = connection
    previousSession = session
    generation++
    if (!canRead()) { failed(); return }
    void refresh()
  }
  const disposers = lifecycle ? [lifecycle.connection.subscribe(changed), lifecycle.session.subscribe(changed),
    ...(lifecycle.projection ? [lifecycle.projection.subscribe(() => { void refresh() })] : [])] : []
  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      offActivation()
      offAvailability()
      offError()
      for (const dispose of disposers) dispose()
    },
  }
}
