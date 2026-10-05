import type { MockKit } from '../../dsh/mock/kit.ts'
import { mockFixtureRecord } from '../../dsh/mock/record.ts'
import type { JsonValue, SessionSummary, SessionWireEvent } from '../../dsh/services.ts'

const origin = Date.parse('2026-09-25T10:00:00+09:00')
const summary = (id: string, displayTitle: string): SessionSummary => ({ retainedBy: {}, id, displayTitle, cwd: '/mock/chat', running: false, blank: false, updatedAt: origin })
// Offsets set fixture time; history assigns dense sequences after adding boundaries.
const history = (rows: SessionWireEvent[]) => rows.map((row, seq) => ({ ...row, seq }))
const event = (seq: number, type: string, data: JsonValue): SessionWireEvent => mockFixtureRecord(seq, type, origin + seq * 1000, data)

export function extendMock(kit: MockKit): void {
  // 75 complete V4 turns, including each step's boundaries (450 records).
  const records: SessionWireEvent[] = []
  for (let turn = 1; turn <= 75; turn++) {
    // Preserve the original four-record turn's clock; boundaries take no time.
    const seq = (turn - 1) * 4
    records.push(...[
      event(seq, 'turn/start', { turn }),
      event(seq + 1, 'user/message', { id: `long-user-${turn}`, role: 'user', content: [{ type: 'text', text: `${turn} 回目の確認をお願いします。` }] }),
      event(seq + 2, 'step/start', { turn, step: 1 }),
      event(seq + 2, 'assistant/message', { turn, step: 1, stream: [], message: { id: `long-assistant-${turn}`, role: 'assistant', content: [{ type: 'text', text: `### ${turn} 回目の確認\n\n会話の表示と古い履歴の読み込みを確認しました。\n\n- メッセージの順序を保ちます。\n- 読んでいる位置を保ちます。` }] } }),
      event(seq + 3, 'step/end', { turn, step: 1 }),
      event(seq + 3, 'turn/end', { turn, reason: { kind: 'completed' } }),
    ].map((row, index) => ({ ...row, seq: records.length + index })))
  }
  kit.addSession(summary('chat-long', '長い会話'), records)
  kit.addSession(summary('chat-samples', '添付と長い結果'), history([
    event(0, 'turn/start', { turn: 1 }),
    event(0, 'step/start', { turn: 1, step: 1 }),
    event(1, 'system/message', { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'あなたはコーディングを手伝う AI です。\n\n添付とツール結果の表示を確認できます。' }] } }),
    event(2, 'user/message', { id: 'chat-samples-instructions', role: 'user', source: { kind: 'agent-instructions', form: 'instructions', changes: [{ action: 'set', scope: 'user-global\u0000AGENTS.md', path: '~/.dsh/AGENTS.md' }] }, content: [{ type: 'text', text: '<system-reminder>\nThe following workspace instructions may be relevant to your work.\n\nInstructions from: ~/.dsh/AGENTS.md\n\n# 個人共通の作業方針\n\n- 説明は日本語で、結論から書く。\n</system-reminder>' }] }),
    event(3, 'user/message', { role: 'user', // The same image used by the result below has a declared
    // first-party reference, as required by 0.2.0 session.attachment authorization.
    content: [{ type: 'text', text: '結果を確認して' }, { type: 'image', attachment: { attachmentId: 'mock-readme-image', mediaType: 'image/png', bytes: 67, width: 1, height: 1, name: '入力画像.png' } }, { type: 'file', attachment: { attachmentId: 'mock-file', name: '確認事項.txt', bytes: 2048 } }] }),
    event(4, 'assistant/message', { turn: 1, step: 1, stream: [], message: { role: 'assistant', content: [{ type: 'tool-call', id: 'chat-long-result', name: 'read_file', arguments: '{"path":"確認事項.txt"}' }] } }),
    event(5, 'tool/call', { turn: 1, step: 1, callId: 'chat-long-result', name: 'read_file', arguments: '{"path":"確認事項.txt"}' }),
    event(6, 'tool/result', { turn: 1, step: 1, message: { id: 'chat-long-output', role: 'tool', source: { kind: 'tool', callId: 'chat-long-result' }, toolCallId: 'chat-long-result', content: [
      { type: 'text', text: Array.from({ length: 210 }, (_, index) => `${index + 1} 行目の確認結果`).join('\n') },
      { type: 'text', text: '入れ子の最後の結果です。' },
      { type: 'image', attachment: { attachmentId: 'mock-readme-image', mediaType: 'image/png', bytes: 67, width: 1, height: 1, name: '手順の画像.png' } },
      { type: 'file', attachment: { attachmentId: 'mock-output', name: '結果.txt', bytes: 4096 } },
    ] } }),
    event(7, 'step/end', { turn: 1, step: 1 }),
    event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]))
  const reasoning = '記録の開始と終了から、考えた内容の所要時間を確認しました。'
  kit.addSession(summary('chat-spec-check', 'チャットの仕様確認'), history([
    event(0, 'turn/start', { turn: 1 }),
    event(0, 'step/start', { turn: 1, step: 1 }),
    event(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'ツールとコマンドの結果を確認して' }] }),
    event(14, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: reasoning }] }, stream: [
      { type: 'chunk', time: origin + 2000, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      { type: 'chunk', time: origin + 14_000, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } } },
    ] }),
    event(14, 'step/end', { turn: 1, step: 1 }),
    event(15, 'step/start', { turn: 1, step: 2 }),
    event(15, 'assistant/message', { turn: 1, step: 2, stream: [], message: { role: 'assistant', content: [{ type: 'tool-call', id: 'spec-read', name: 'read_file', arguments: '{"path":"README.md"}' }] } }),
    event(16, 'tool/call', { turn: 1, step: 2, callId: 'spec-read', name: 'read_file', arguments: '{"path":"README.md"}' }),
    event(17, 'tool/result', { turn: 1, step: 2, message: { id: 'spec-read-output', role: 'tool', source: { kind: 'tool', callId: 'spec-read' }, toolCallId: 'spec-read', content: [{ type: 'text', text: '# 確認用の原文\n<div>この行も表示します。</div>' }] } }),
    event(17, 'step/end', { turn: 1, step: 2 }),
    event(18, 'step/start', { turn: 1, step: 3 }),
    event(18, 'assistant/message', { turn: 1, step: 3, stream: [], message: { role: 'assistant', content: [{ type: 'tool-call', id: 'spec-bash', name: 'bash', arguments: '{"command":"pnpm test"}' }] } }),
    event(19, 'tool/call', { turn: 1, step: 3, callId: 'spec-bash', name: 'bash', arguments: '{"command":"pnpm test"}' }),
    event(20, 'tool/result', { turn: 1, step: 3, message: { id: 'spec-bash-output', role: 'tool', source: { kind: 'tool', callId: 'spec-bash' }, toolCallId: 'spec-bash', content: [], isError: true }, error: { name: '実行エラー', code: 'EXIT_1' } }),
    event(21, 'command/run', { commandId: 'spec-failed', name: 'check', source: { kind: 'user' } }),
    event(22, 'command/done', { commandId: 'spec-failed', kind: 'error', text: '確認に失敗しました。\n詳細を開くと理由を読めます。' }),
    event(23, 'command/run', { commandId: 'spec-success', name: 'status', source: { kind: 'user' } }),
    event(24, 'command/done', { commandId: 'spec-success', kind: 'success', text: '' }),
    event(25, 'step/end', { turn: 1, step: 3 }),
    event(25, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]))
  kit.addWorkspace({ workspaceId: 'ws-chat-check', path: '/mock/chat', title: 'チャットの確認', sessionIds: ['chat-long', 'chat-samples', 'chat-spec-check'], createdAt: new Date(origin).toISOString(), updatedAt: new Date(origin).toISOString() })
  kit.scenario('streaming', active => {
    void active.streamAssistant('approval-sheet', Array.from({ length: 8 }, (_, index) => `### 確認 ${index + 1}\n\n承認シートの表示とテストを確認しています。返事は少しずつ届きます。上へスクロールすると、読んでいる位置で止まります。\n\n`).join(''), { chunkMs: 35 })
  })
  kit.scenario('chat-long-streaming', active => {
    const sessionId = 'chat-long-streaming'
    active.addSession({ ...summary(sessionId, '長い会話（生成中）'), running: true }, history([...records,
      event(300, 'turn/start', { turn: 76 }),
      event(301, 'user/message', { role: 'user', content: [{ type: 'text', text: '長い会話の続きも確認して' }] }),
      event(302, 'step/start', { turn: 76, step: 1 }),
    ]))
    active.updateWorkspace('ws-chat-check', workspace => ({ sessionIds: [...workspace.sessionIds, sessionId] }))
    void active.streamAssistant(sessionId, Array.from({ length: 10 }, (_, index) => `### 続きの確認 ${index + 1}\n\n長い履歴を表示したまま返事を生成しています。トレースへ移り、戻ったときも表示前の追いかけ方を引き継ぎます。\n\n`).join(''), { chunkMs: 35 })
  })
  kit.scenario('chat-error', active => {
    active.addSession(summary('chat-error', '処理が止まった会話'), [event(0, 'user/message', { role: 'user', content: [{ type: 'text', text: 'README の手順を確認して' }] })])
    active.setSessionState('chat-error', { lastAgentError: '応答の生成中に接続が切れました。接続を確認してから、続きのメッセージを送ってください。', running: false })
    active.addWorkspace({ workspaceId: 'ws-chat-error', path: '/mock/chat-error', title: '処理エラーの確認', sessionIds: ['chat-error'], createdAt: new Date(origin).toISOString(), updatedAt: new Date(origin).toISOString() })
  })
  kit.scenario('chat-injected-context', active => {
    const sessionId = 'chat-injected-context'
    active.addSession(summary(sessionId, '追加された文脈の確認'), history([
      event(0, 'turn/start', { turn: 1 }),
      event(0, 'step/start', { turn: 1, step: 1 }),
      event(1, 'system/message', { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'システムの検証用原文\n<b>そのまま読む</b>' }] } }),
      event(2, 'user/message', { role: 'user', source: { kind: 'plugin:検証用プラグイン' }, content: [
        { type: 'text', text: '<system-reminder>\n# 追加された検証用原文\n<b>そのまま読む</b>\n</system-reminder>' },
        { type: 'image', attachment: { attachmentId: 'mock-readme-image', mediaType: 'image/png', bytes: 67, width: 1, height: 1, name: '文脈の画像.png' } },
        { type: 'file', attachment: { attachmentId: 'context-file', name: '文脈の資料.txt', bytes: 2048 } },
      ] }),
      event(3, 'user/message', { role: 'user', source: { kind: 'session-reference', form: 'recall', version: 1, references: [{ sessionId: 'readme-review', label: '検証用の参照会話', capturedFormatVersion: 4, capturedThroughSeq: 17, compacted: false, originalMessages: 6, retainedMessages: 6, omittedMessages: 0, omittedBytes: 0, truncated: false, inputIndex: 0 }] }, content: [{ type: 'text', text: '別の会話の検証用原文' }] }),
      event(4, 'user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '私が送った検証用メッセージ' }] }),
      event(5, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]))
    active.updateWorkspace('ws-chat-check', workspace => ({ sessionIds: [...workspace.sessionIds, sessionId] }))
  })
  kit.scenario('open-error', active => {
    active.addSession(summary('chat-open-error', '開けない会話'), [])
    active.setSessionState('chat-open-error', { openState: 'error', openError: { code: 'session/not-found', message: '会話が見つかりません。', details: { sessionId: 'chat-open-error' } } })
    active.addWorkspace({ workspaceId: 'ws-chat-open-error', path: '/mock/chat-open-error', title: '読込エラーの確認', sessionIds: ['chat-open-error'], createdAt: new Date(origin).toISOString(), updatedAt: new Date(origin).toISOString() })
  })
}
