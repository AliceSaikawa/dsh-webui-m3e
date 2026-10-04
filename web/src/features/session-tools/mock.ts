import type { MockKit } from '../../dsh/mock/kit.ts'
import { MOCK_IDS } from '../../dsh/mock/fixtures.ts'
import type { RemoteResult, SessionWireEvent } from '../../dsh/services.ts'
import { goalProjectionOf, type GoalAction, type GoalRef, type GoalsRemote, type GoalView } from './operations.ts'
import { createWorkspaceFilesMock } from './mock-files.ts'

export const SESSION_TOOLS_MOCK_IDS = {
  parent: MOCK_IDS.sessions.approval,
  children: { review: 'session-tools-review', tests: 'session-tools-tests' },
  jobs: { running: 'session-tools-check', complete: 'session-tools-child', failed: 'session-tools-failure' },
} as const

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })

function childRecords(id: string, label: string, running: boolean, now: number): SessionWireEvent[] {
  const rows: SessionWireEvent[] = [
    { seq: 0, time: now, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: now, type: 'user/message', surfaceOp: 'append', data: { id: `${id}-request`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${label}をお願いします。` }] } },
    { seq: 2, time: now + 1000, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: { id: `${id}-answer`, role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock-model' }, content: [{ type: 'text', text: running ? '承認シートの画面と操作を確認しています。' : '補助画面のテストを確認しました。' }] } } },
  ]
  if (!running) rows.push({ seq: 3, time: now + 2000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return rows
}

export function extendMock(kit: MockKit): void {
  const parent = SESSION_TOOLS_MOCK_IDS.parent
  const now = Date.now()
  kit.setProjection(parent, 'tokenUsage', { uncachedInputTokens: 11668, outputTokens: 812, cacheReadTokens: 15400, cacheWriteTokens: 2048 })
  kit.setProjection(parent, 'contextPressure', { pressureTokens: 79360, projectedTokens: 80100, contextWindow: 128000 })
  kit.setProjection(parent, 'modelSelection', { next: { provider: 'mock', model: '偽のモデル', reasoningEffort: 'high' }, lastUsed: { provider: 'mock', model: '偽のモデル', reasoningEffort: 'high' } })

  const children = [
    { id: SESSION_TOOLS_MOCK_IDS.children.review, label: '承認シートの見直し', mode: 'continuable' as const, createdAt: now - 30000 },
    { id: SESSION_TOOLS_MOCK_IDS.children.tests, label: 'テストの確認', mode: 'one-shot' as const, createdAt: now - 30000 },
  ]
  for (const child of children) {
    const running = child.id === SESSION_TOOLS_MOCK_IDS.children.review
    kit.addSession({ id: child.id, parentId: parent, origin: 'subagent', title: child.label, displayTitle: child.label, cwd: '/mock/dsh-webui-m3e', running: true, blank: false, updatedAt: now }, childRecords(child.id, child.label, running, now - 30000))
    if (!running) kit.setSessionState(child.id, { running: false })
    const address = { parentSessionId: parent, childSessionId: child.id, mode: child.mode }
    kit.setSessionState(child.id, { subagent: { address, parentAvailable: true } })
  }
  kit.setJobs(parent, [
    { output: { total: 0, earliest: 0 }, id: SESSION_TOOLS_MOCK_IDS.jobs.running, kind: 'bash', label: '型を確認しています', status: 'running', startedAt: now - 65000 },
    { output: { total: 0, earliest: 0 }, id: SESSION_TOOLS_MOCK_IDS.jobs.complete, kind: 'subagent', label: 'テストの確認', status: 'completed', startedAt: now - 130000, finishedAt: now - 80000 },
    { output: { total: 0, earliest: 0 }, id: SESSION_TOOLS_MOCK_IDS.jobs.failed, kind: 'bash', label: '承認シートのテスト', status: 'failed', startedAt: now - 200000, finishedAt: now - 185000 },
  ])
  kit.setProjection(parent, 'subagentCatalog', children)
  kit.scenario('subagents-unloaded', () => {
    for (const child of children) kit.setSessionState(child.id, { subagent: null })
    kit.updateList(state => {
      const catalogs = { ...state.projectionsBySession }
      delete catalogs[parent]
      state.projectionsBySession = catalogs
    })
    kit.patch('sessions.refreshProjections', async (parentSessionId: string) => {
      kit.updateList(state => {
        if (parentSessionId === parent) {
          state.projectionsBySession = { ...state.projectionsBySession, [parent]: { values: { subagentCatalog: children }, state: 'ready', error: null } }
        }
      })
    })
  })

  const goals = new Map<string, GoalView>()
  function publish(sessionId: string, goal: GoalView | undefined) {
    if (goal) goals.set(sessionId, goal)
    else goals.delete(sessionId)
    const view = goalProjectionOf(goal)
    if (view) {
      const { activation: _activation, ...durable } = view
      kit.setProjection(sessionId, 'goal', durable)
    } else kit.setProjection(sessionId, 'goal', null)
    void kit.emit('goal/activation-changed', { sessionId,
      ...(goal ? { goal: { id: goal.id, revision: goal.revision, activation: goal.activation } } : {}),
    })
  }
  publish(parent, {
    id: 'session-tools-goal', revision: 1, objective: '承認シートを作り、テストで操作を確かめる',
    phase: 'active', maxGoalRounds: 8, roundsStarted: 3, createdAt: now - 240000, updatedAt: now,
    activation: 'armed',
  })

  function current(sessionId: string, ref: GoalRef): RemoteResult<GoalView> {
    const goal = goals.get(sessionId)
    if (!goal) return failure('GOAL_NOT_FOUND', 'ゴールはありません。')
    if (goal.id !== ref.id || goal.revision !== ref.revision) return failure('GOAL_STALE_REVISION', 'ゴールが更新されています。読み直してください。')
    return success(goal)
  }
  async function update(sessionId: string, ref: GoalRef, action: Exclude<GoalAction, 'clear'>): Promise<RemoteResult<GoalView>> {
    const result = current(sessionId, ref)
    if (!result.ok) return result
    const goal = result.value
    if ((action === 'pause' && goal.phase !== 'active')
      || (action === 'resume' && (goal.phase === 'complete' || (goal.phase === 'active' && goal.activation === 'armed') || goal.roundsStarted >= goal.maxGoalRounds))
      || (action === 'complete' && goal.phase === 'complete')) return failure('GOAL_INVALID_STATE', '今の状態ではこの操作はできません。')
    const { blockedReason: _reason, ...rest } = goal
    const value: GoalView = {
      ...rest, revision: goal.revision + 1, updatedAt: Date.now(),
      phase: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'complete',
      activation: action === 'resume' ? 'armed' : 'disarmed',
    }
    publish(sessionId, value)
    return success(structuredClone(value))
  }
  const remote: GoalsRemote = {
    async get(sessionId) { return success(structuredClone(goals.get(sessionId))) },
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
  kit.addRemote('workspaceFiles', createWorkspaceFilesMock().remote)
  kit.scenario('goal-blocked', () => {
    const goal = goals.get(parent)!
    publish(parent, { ...goal, revision: goal.revision + 1, phase: 'blocked', activation: 'disarmed', blockedReason: { code: 'verification-failed', message: '承認シートのテストに失敗しました。原因の確認が必要です。' } })
  })
  kit.scenario('goal-disarmed', () => {
    const goal = goals.get(parent)!
    publish(parent, { ...goal, activation: 'disarmed' })
  })
}
