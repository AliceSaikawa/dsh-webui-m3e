import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import { goalProjectionOf, type GoalAction, type GoalRef, type GoalsRemote, type GoalView } from './operations.ts'

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })

export function installGoalMock(kit: MockKit, parent: string, now: number) {
  const unavailable = new Set<string>()
  const goals = new Map<string, GoalView>()
  const exists = (id: string) => {
    let found = false
    kit.updateList(state => { found = Object.hasOwn(state.byId, id) })
    return found
  }
  const live = (id: string) => exists(id) && !unavailable.has(id)
  const lookupFailure = () => failure('gateway/lookup-not-found', '会話の準備ができていません。')
  const setAvailable = kit.setAgentAvailable.bind(kit)
  kit.setAgentAvailable = (id, available) => {
    setAvailable(id, available)
    if (available) unavailable.delete(id)
    else {
      unavailable.add(id)
      const goal = goals.get(id)
      if (goal) publish(id, { ...goal, activation: 'disarmed' })
    }
  }
  const addSession = kit.addSession.bind(kit)
  kit.addSession = (summary, records, options) => {
    addSession(summary, records, options)
    if (options?.agentAvailable === false) unavailable.add(summary.id)
    else unavailable.delete(summary.id)
  }
  const removeSession = kit.removeSession.bind(kit)
  kit.removeSession = id => {
    goals.delete(id)
    unavailable.delete(id)
    removeSession(id)
  }

  function publish(sessionId: string, goal: GoalView | undefined, notify = true) {
    const previousActivation = goals.get(sessionId)?.activation ?? 'disarmed'
    if (goal) goals.set(sessionId, goal)
    else goals.delete(sessionId)
    const view = goalProjectionOf(goal)
    if (view) {
      const { activation: _activation, ...durable } = view
      kit.setProjection(sessionId, 'goal', durable)
    } else kit.setProjection(sessionId, 'goal', null)
    if (notify && previousActivation !== (goal?.activation ?? 'disarmed')) void kit.emit('goal/activation-changed', { sessionId,
      ...(goal ? { goal: { id: goal.id, revision: goal.revision, activation: goal.activation } } : {}),
    })
  }
  publish(parent, {
    id: 'session-tools-goal', revision: 1, objective: '承認シートを作り、テストで操作を確かめる',
    phase: 'active', maxGoalRounds: 8, roundsStarted: 3, createdAt: now - 240000, updatedAt: now, activation: 'armed',
  }, false)

  function current(sessionId: string, ref: GoalRef): RemoteResult<GoalView> {
    if (!live(sessionId)) return lookupFailure()
    const goal = goals.get(sessionId)
    // GoalError is mapped by the gateway, unlike a RemoteError.
    if (!goal) return failure('gateway/internal', 'ゴールはありません。')
    if (goal.id !== ref.id || goal.revision !== ref.revision) return failure('gateway/internal', 'ゴールが更新されています。読み直してください。')
    return success(goal)
  }
  async function update(sessionId: string, ref: GoalRef, action: Exclude<GoalAction, 'clear'>): Promise<RemoteResult<GoalView>> {
    const result = current(sessionId, ref)
    if (!result.ok) return result
    const goal = result.value
    if ((action === 'pause' && goal.phase !== 'active')
      || (action === 'resume' && (goal.phase === 'complete' || (goal.phase === 'active' && goal.activation === 'armed') || goal.roundsStarted >= goal.maxGoalRounds))
      || (action === 'complete' && goal.phase === 'complete')) return failure('gateway/internal', '今の状態ではこの操作はできません。')
    const { blockedReason: _reason, ...rest } = goal
    const value: GoalView = {
      ...rest, revision: goal.revision + 1, updatedAt: Math.max(Date.now(), goal.updatedAt),
      phase: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'complete',
      activation: action === 'resume' ? 'armed' : 'disarmed',
    }
    publish(sessionId, value)
    return success(value)
  }
  const remote: GoalsRemote = {
    async get(sessionId) { return live(sessionId) ? success(goals.get(sessionId)) : lookupFailure() },
    pause: (sessionId, ref) => update(sessionId, ref, 'pause'),
    resume: (sessionId, ref) => update(sessionId, ref, 'resume'),
    complete: (sessionId, ref) => update(sessionId, ref, 'complete'),
    async clear(sessionId, ref) {
      const result = current(sessionId, ref)
      if (!result.ok) return result
      const tombstone = { id: result.value.id, revision: result.value.revision + 1 }
      publish(sessionId, undefined)
      return success(tombstone)
    },
  }
  kit.addRemote('goals', remote)
  kit.scenario('goal-blocked', () => {
    const goal = goals.get(parent)!
    publish(parent, { ...goal, revision: goal.revision + 1, phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'verification-failed', message: '承認シートのテストに失敗しました。原因の確認が必要です。' } }, false)
  })
  kit.scenario('goal-disarmed', () => {
    publish(parent, { ...goals.get(parent)!, activation: 'disarmed' }, false)
  })
  // Preparation stays under test control; it causes no activation notification.
  kit.scenario('goal-preparing', () => {
    publish(parent, { ...goals.get(parent)!, activation: 'disarmed' }, false)
    unavailable.add(parent)
    kit.setAgentAvailable(parent, false)
  })
}
