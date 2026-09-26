import type { MockKit } from '../../dsh/mock/kit.ts'
import { MOCK_IDS, sharedWorkspaces } from '../../dsh/mock/fixtures.ts'
import type { SessionSummary, SessionWireEvent } from '../../dsh/services.ts'
import { createDirectoryMock } from './directory-mock.ts'

export const HOME_MOCK_IDS = {
  completed: 'home-mobile-layout',
  waiting: 'home-workspace-question',
  child: 'home-review-child',
  idle: 'home-list-menu',
  harness: 'home-harness-tests',
} as const

const start = Date.parse('2026-09-25T09:30:00+09:00')

const rows: readonly SessionSummary[] = [
  { id: HOME_MOCK_IDS.completed, displayTitle: 'スマートフォンの余白を調整', cwd: '/mock/dsh-webui-m3e', completed: false, running: false, blank: false, updatedAt: start, projectionValues: { modelSelection: { lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } } } },
  { id: HOME_MOCK_IDS.waiting, displayTitle: 'ワークスペースの確認', cwd: '/mock/dsh-webui-m3e', running: true, blank: false, updatedAt: start - 60_000, projectionValues: { modelSelection: { lastUsed: { provider: 'local', model: 'Qwen' } } } },
  { id: HOME_MOCK_IDS.child, displayTitle: '一覧の表示をレビュー', cwd: '/mock/dsh-webui-m3e', parentId: MOCK_IDS.sessions.readme, origin: 'subagent', running: false, blank: false, updatedAt: start - 120_000 },
  { id: HOME_MOCK_IDS.idle, displayTitle: '一覧のメニューを検討', cwd: '/mock/dsh-webui-m3e', running: false, blank: false, updatedAt: start - 86_400_000 },
  { id: HOME_MOCK_IDS.harness, displayTitle: '接続のテストを整理', cwd: '/mock/deepseek-harness', running: false, blank: false, updatedAt: start - 172_800_000, projectionValues: { modelSelection: { lastUsed: { provider: 'deepseek', model: 'deepseek-reasoner' } } } },
]

function recordsFor(row: SessionSummary): SessionWireEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: row.updatedAt, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: row.updatedAt, surfaceOp: 'append', data: { id: `${row.id}-request`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${row.displayTitle}をお願いします。` }] } },
    { type: 'step/start', seq: 2, time: row.updatedAt, data: { turn: 1, step: 1 } },
    ...(row.running ? [] : [
      { type: 'assistant/message', seq: 3, time: row.updatedAt + 1000, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: `${row.id}-reply`, role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock-model' }, content: [{ type: 'text', text: '確認できました。次の作業に進めます。' }] }, stream: [] } } as SessionWireEvent,
      { type: 'step/end', seq: 4, time: row.updatedAt + 1000, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: row.updatedAt + 1000, data: { turn: 1, reason: { kind: 'completed' } } },
    ]),
  ]
}

function removeAllSessions(kit: MockKit): void {
  let sessionIds: string[] = []
  kit.updateList((state) => { sessionIds = [...state.ids] })
  for (const sessionId of sessionIds) kit.removeSession(sessionId)
}

export function extendMock(kit: MockKit): void {
  for (const row of rows) kit.addSession(row, recordsFor(row))
  const workspaceSessions: readonly [string, readonly string[]][] = [
    [MOCK_IDS.workspaces.m3e, [HOME_MOCK_IDS.completed, HOME_MOCK_IDS.waiting, HOME_MOCK_IDS.child, HOME_MOCK_IDS.idle]],
    [MOCK_IDS.workspaces.harness, [HOME_MOCK_IDS.harness]],
  ]
  for (const [workspaceId, additions] of workspaceSessions) {
    kit.updateWorkspace(workspaceId, (workspace) => ({
      sessionIds: [...workspace.sessionIds, ...additions.filter((sessionId) => !workspace.sessionIds.includes(sessionId))],
    }))
  }
  let parentAvailable = true
  kit.updateList((state) => {
    const previous = state.subagentsByParent[MOCK_IDS.sessions.readme]
    parentAvailable = previous?.parentAvailable ?? true
    state.subagentsByParent = {
      ...state.subagentsByParent,
      [MOCK_IDS.sessions.readme]: {
        ...previous,
        state: 'ready', error: null, parentAvailable,
        entries: [
          ...(Array.isArray(previous?.entries) ? previous.entries : []),
          { kind: 'child', id: HOME_MOCK_IDS.child, mode: 'one-shot', label: '一覧の表示をレビュー', activity: 'inactive', hasChildren: false },
        ],
      },
    }
  })
  kit.setSessionState(HOME_MOCK_IDS.child, { subagent: {
    address: { parentSessionId: MOCK_IDS.sessions.readme, childSessionId: HOME_MOCK_IDS.child, mode: 'one-shot' }, parentAvailable,
  } })
  kit.setProjection(MOCK_IDS.sessions.readme, 'modelSelection', { lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } })
  kit.setProjection(MOCK_IDS.sessions.approval, 'modelSelection', { lastUsed: { provider: 'deepseek', model: 'deepseek-reasoner' } })
  kit.addRemote('directoryPicker', createDirectoryMock())

  kit.scenario('home', (home) => {
    home.updateList((state) => {
      const completed = state.byId[HOME_MOCK_IDS.completed]
      if (completed) state.byId[completed.id] = { ...completed, completed: true }
    })
    // Keep demo inbox items local to this scenario; handlers register before delivery.
    void home.emit('user-questions/request', {
      agent: HOME_MOCK_IDS.waiting,
      questions: [{ id: 'home-workspace-choice', header: '作業場所', question: 'どのフォルダで作業を続けますか？', options: [{ label: '今のワークスペース' }, { label: '別のワークスペース' }] }],
    }, { afterMs: 500 }).catch(() => { /* Disposing an unanswered fixture ends its request. */ })
  })

  kit.scenario('empty', () => removeAllSessions(kit))
  kit.scenario('no-workspace', () => {
    removeAllSessions(kit)
    // MockKit cannot enumerate workspaces yet; include the other default fixtures.
    const workspaceIds = [...sharedWorkspaces.map((workspace) => workspace.workspaceId), 'ws-chat-check', 'ws-trace-example']
    for (const workspaceId of workspaceIds) kit.removeWorkspace(workspaceId)
  })
  kit.scenario('home-pending', () => kit.updateList((state) => { state.phase = 'pending' }))
  kit.scenario('native-browse', () => kit.patch('remote.directoryPicker', createDirectoryMock()))
  kit.scenario('native-unavailable', () => kit.patch('remote.directoryPicker', createDirectoryMock({ unavailable: 'native' })))
  kit.scenario('picker-unavailable', () => kit.patch('remote.directoryPicker', createDirectoryMock({ unavailable: 'none' })))
  kit.scenario('picker-truncated', () => kit.patch('remote.directoryPicker', createDirectoryMock({ truncated: true })))
}
