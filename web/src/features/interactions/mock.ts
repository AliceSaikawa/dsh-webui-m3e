import type { MockKit } from '../../dsh/mock/kit.ts'
import { MOCK_IDS } from '../../dsh/mock/fixtures.ts'
import type { AskUserQuestionItem } from '../../dsh/interactions.ts'
import type { AskUserQuestionRequestEvent, UserQuestionProjection } from '../../dsh/interactions-store.ts'
import type { InboxState, SessionWireEvent } from '../../dsh/services.ts'

const initialDelay = 100
const approvalDelay = 3_000
const origin = Date.parse('2026-09-25T09:00:00+09:00')
const workspacePath = '/mock/dsh-webui-m3e'
const databaseSessionId = '05-db-choice'
const planSessionId = '05-auth-redesign'
const planApproval = 'このプランで進める'

const databaseQuestions: AskUserQuestionItem[] = [
  {
    id: 'database',
    header: 'データベースの選択',
    question: 'どちらのデータベースにしますか',
    detail: '今のデータは 3 万件ほどです',
    options: [
      { label: 'PostgreSQL', description: '複数人で使う前提' },
      { label: 'SQLite', description: '1 台で完結' },
    ],
  },
  {
    id: 'migration-checks',
    header: '移行前の確認',
    question: '移行前に確かめたいことを選んでください',
    detail: '複数選べます。ほかにあれば自由に書いてください。',
    multiSelect: true,
    options: [
      { label: 'データの移行', description: '今のデータを失わずに移せるか確かめます' },
      { label: '検索の速さ', description: 'よく使う検索にかかる時間を比べます' },
      { label: 'バックアップ', description: '保存と復元の手順を確かめます' },
    ],
  },
]

/** Shared input for the timed transport fixture owned by the controller mock. */
export function timedQuestionRequest(signal?: AbortSignal): AskUserQuestionRequestEvent {
  return { agent: databaseSessionId, questions: structuredClone(databaseQuestions), signal,
    wait: { callId: '05-timed-question', timed: true } }
}

export const continuedQuestionProjection: UserQuestionProjection = {
  active: [{ callId: '05-timed-question', questions: databaseQuestions, state: 'continued' }], settled: [],
}

const planQuestion: AskUserQuestionItem = {
  id: 'auth-plan',
  question: '認証の作り直し',
  detail: [
    '# 認証の作り直し',
    '',
    '1. ログインの Cookie を HttpOnly にする',
    '2. トークンの期限を 1 日にする',
    '3. 期限切れのときはログイン画面に戻す',
    '4. テストを 6 件足す',
  ].join('\n'),
  options: [{ label: planApproval }],
  intent: { kind: 'plan-review', approve: planApproval },
}

function addConversation(kit: MockKit, id: string, title: string, message: string): void {
  const records: SessionWireEvent[] = [{
    type: 'user/message', seq: 0, time: origin, surfaceOp: 'append',
    data: { id: `${id}-message`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: message }] },
  }]
  kit.addSession({ id, title, displayTitle: title, cwd: workspacePath, running: false, blank: false, updatedAt: origin }, records)
}

async function reportReply(reply: Promise<unknown>, label: string): Promise<void> {
  try {
    const answer = await reply
    if (answer === undefined) {
      console.warn(`偽の DSH：${label}の回答は届きませんでした。`)
      return
    }
    console.info(`偽の DSH が${label}の回答を受け取りました。`, answer)
  } catch {
    console.info(`偽の DSH：${label}の要求は取り消されました。`)
  }
}

function requestApproval(kit: MockKit, cancel: boolean): void {
  const controller = new AbortController()
  // The request appears at three seconds; cancellation follows five seconds later.
  const timer = cancel ? setTimeout(() => controller.abort(), approvalDelay + 5_000) : undefined
  const reply = kit.emit('approval/request', {
    agent: 'approval-sheet',
    toolName: 'bash',
    callId: 'approval-bash',
    reason: '承認シートの動作をテストで確かめるためです。',
    signal: controller.signal,
  }, { afterMs: approvalDelay })
  void reportReply(reply, '承認').finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

export function extendMock(kit: MockKit): void {
  addConversation(kit, databaseSessionId, 'DB の選び直し', 'データベースの選び直しを相談したい')
  addConversation(kit, planSessionId, '認証の作り直し', '認証を作り直すプランを考えて')
  kit.updateWorkspace(MOCK_IDS.workspaces.m3e, workspace => ({
    sessionIds: [...workspace.sessionIds, databaseSessionId, planSessionId],
  }))

  kit.scenario('approval', () => requestApproval(kit, false))
  kit.scenario('approval-cancel', () => requestApproval(kit, true))
  // Keep the initial event after initializeInteractions on the current foundation.
  kit.scenario('question', () => {
    void reportReply(kit.emit('user-questions/request', {
      agent: databaseSessionId, questions: structuredClone(databaseQuestions),
    }, { afterMs: initialDelay }), '質問')
  })
  // Read-only receiving-side probe; the shared controller owns every RPC.
  ;(globalThis as typeof globalThis & { __m3eObserveQuestions?: (read: () => unknown) => void })
    .__m3eObserveQuestions?.(() => structuredClone(kit.getProjection(databaseSessionId, 'userQuestions')))
  ;(globalThis as typeof globalThis & { __m3eObserveQuestionRecords?: (read: () => unknown) => void })
    .__m3eObserveQuestionRecords?.(() => structuredClone(kit.getRecords(databaseSessionId)))
  ;(globalThis as typeof globalThis & { __m3eObserveQuestionQueue?: (read: () => unknown) => void })
    .__m3eObserveQuestionQueue?.(() => structuredClone(kit.getProjection<InboxState>(databaseSessionId, 'inbox')))
  const timed = (keepRunning: boolean) => {
    // Delivery is delayed until the feature's handlers have been installed.
    void kit.emit('mock/question-ready', undefined, { afterMs: initialDelay }).then(() => {
      const append = (type: string, data: unknown) => kit.appendEvent(databaseSessionId, type, data)
      const callId = '05-timed-question', args = JSON.stringify({ questions: databaseQuestions })
      append('turn/start', { turn: 1 }); append('step/start', { turn: 1, step: 1 })
      append('assistant/message', { turn: 1, step: 1, stream: [], message: { id: '05-ask', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4' }, content: [{ type: 'tool-call', id: callId, name: 'ask_user_question', arguments: args }] } })
      append('tool/call', { turn: 1, step: 1, callId, name: 'ask_user_question', arguments: args })
      kit.setSessionState(databaseSessionId, { running: true })
      void reportReply(kit.emitTimedQuestion(databaseSessionId, {
        callId, questions: structuredClone(databaseQuestions), timeoutMs: 2_000,
      }).then(result => {
        append('tool/result', { turn: 1, step: 1, message: { id: '05-answer', role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text: JSON.stringify(result) }] } })
        append('step/end', { turn: 1, step: 1 })
        if (keepRunning) append('step/start', { turn: 1, step: 2 })
        else { append('turn/end', { turn: 1, reason: { kind: 'completed' } }); kit.setSessionState(databaseSessionId, { running: false }) }
        return result
      }), '質問')
    })
  }
  kit.scenario('question-timed', () => timed(false))
  kit.scenario('question-timed-queue', () => timed(true))
  // Persisted continued state after reopening a conversation.
  kit.scenario('question-continued', () => {
    kit.setProjection(databaseSessionId, 'userQuestions', structuredClone(continuedQuestionProjection))
  })
  kit.scenario('plan', () => {
    void reportReply(kit.emit('user-questions/request', {
      agent: planSessionId, questions: [structuredClone(planQuestion)],
    }, { afterMs: initialDelay }), 'プランの確認')
  })
}
