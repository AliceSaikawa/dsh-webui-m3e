import type { MockKit } from '../../dsh/mock/kit.ts'
import { MOCK_IDS } from '../../dsh/mock/fixtures.ts'
import type { AskUserQuestionItem } from '../../dsh/interactions.ts'
import type { SessionWireEvent } from '../../dsh/services.ts'

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
  kit.scenario('plan', () => {
    void reportReply(kit.emit('user-questions/request', {
      agent: planSessionId, questions: [structuredClone(planQuestion)],
    }, { afterMs: initialDelay }), 'プランの確認')
  })
}
