import type { ImageAttachmentRef, JsonValue, SessionSummary, SessionWireEvent, WorkspaceView } from '../services.ts'

export const MOCK_IDS = {
  workspaces: { m3e: 'ws-m3e', harness: 'ws-harness', notes: 'ws-notes' },
  sessions: { readme: 'readme-review', approval: 'approval-sheet' },
} as const

const origin = Date.parse('2026-09-25T09:00:00+09:00')
const time = new Date(origin).toISOString()

export const sharedWorkspaces: readonly WorkspaceView[] = [
  { workspaceId: MOCK_IDS.workspaces.m3e, path: '/mock/dsh-webui-m3e', title: 'dsh-webui-m3e', sessionIds: [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval], createdAt: time, updatedAt: time },
  { workspaceId: MOCK_IDS.workspaces.harness, path: '/mock/deepseek-harness', title: 'deepseek-harness', sessionIds: [], createdAt: time, updatedAt: time },
  { workspaceId: MOCK_IDS.workspaces.notes, path: '/mock/notes', title: 'notes', sessionIds: [], createdAt: time, updatedAt: time },
]

/** Small embedded PNG, never loaded from an external origin. */
export const imageAttachment: ImageAttachmentRef = {
  attachmentId: 'mock-readme-image', mediaType: 'image/png', bytes: 67,
  width: 1, height: 1, name: '手順の画像.png',
}
export const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5AAAAABJRU5ErkJggg=='

function events(rows: readonly [number, string, Record<string, unknown>][]): SessionWireEvent[] {
  return rows.map(([offset, type, input], seq) => {
    let data = input
    const id = `mock-${type}-${offset}`
    if (type === 'user/message') data = { ...input, id, source: { kind: 'user' } }
    if (type === 'assistant/message') data = { ...input, message: { ...(input.message as object), id, source: { kind: 'model', provider: 'mock', model: 'mock-model' } }, stream: (input.stream as object[]).map((record) => ({ type: 'chunk', ...record })) }
    if (type === 'turn/end') data = { ...input, reason: { kind: input.reason } }
    if (type === 'tool/result') {
      const message = input.message as { toolCallId: string; content: unknown[]; isError?: boolean }
      data = { ...input, message: { id, role: 'user', source: { kind: 'tool', callId: message.toolCallId }, content: [{ type: 'tool-result', toolCallId: message.toolCallId, content: message.content, isError: message.isError ?? false }] } }
    }
    const surface = ['user/message', 'assistant/message', 'tool/result'].includes(type)
    return { type, seq, time: origin + offset, data: JSON.parse(JSON.stringify(data)) as JsonValue, ...(surface ? { surfaceOp: 'append' } : {}) }
  })
}

/** Shared by the chat and trace implementations; based on Canvas chatDetail. */
export const readmeRecords: readonly SessionWireEvent[] = events([
  [0, 'turn/start', { turn: 1 }],
  [0, 'user/message', { role: 'user', content: [{ type: 'text', text: 'README の手順を見直して' }, { type: 'image', attachment: imageAttachment }] }],
  [0, 'step/start', { turn: 1, step: 1 }],
  [12000, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'README の手順と実際の設定を照らし合わせ、PWA の追加手順を確認します。' }, { type: 'tool-call', id: 'readme-read', name: 'read_file', arguments: '{"path":"README.md"}' }] }, stream: [{ time: origin, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } }, { time: origin + 12000, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'README の手順と実際の設定を照らし合わせ、PWA の追加手順を確認します。' } } }] }],
  [12000, 'tool/call', { turn: 1, step: 1, callId: 'readme-read', name: 'read_file', arguments: '{"path":"README.md"}' }],
  [12100, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'readme-read', content: [{ type: 'text', text: '# DSH M3E\n\nスマートフォン向けの画面です。' }] } }],
  [12100, 'step/end', { turn: 1, step: 1 }],
  [12100, 'step/start', { turn: 1, step: 2 }],
  [12200, 'assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'readme-test', name: 'bash', arguments: '{"command":"pnpm test"}' }] }, stream: [] }],
  [12200, 'tool/call', { turn: 1, step: 2, callId: 'readme-test', name: 'bash', arguments: '{"command":"pnpm test"}' }],
  [13400, 'tool/result', { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'readme-test', content: [{ type: 'text', text: 'テストが 1 件失敗しています。\nホーム画面への追加手順が見つかりません。' }], isError: true }, error: { name: 'Error', code: 'EXIT_1' } }],
  [13400, 'step/end', { turn: 1, step: 2 }],
  [13400, 'step/start', { turn: 1, step: 3 }],
  [14000, 'assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: 'PWA の手順を README に足しました。\n\nテストが 1 件失敗しています。' }] }, stream: [] }],
  [14000, 'step/end', { turn: 1, step: 3 }],
  [14000, 'turn/end', { turn: 1, reason: 'completed' }],
  [15000, 'command/run', { commandId: 'readme-permission', name: 'permission', source: 'user' }],
  [15010, 'command/done', { commandId: 'readme-permission', kind: 'success', text: '/permission を実行しました', sourceEventSeq: 16 }],
])

/** Canvas trace: turn 2 complete, turn 3 still running. */
export const approvalRecords: readonly SessionWireEvent[] = events([
  [0, 'turn/start', { turn: 2 }],
  [0, 'user/message', { role: 'user', content: [{ type: 'text', text: '承認シートを作って' }] }],
  [0, 'step/start', { turn: 2, step: 1 }],
  [4100, 'assistant/message', { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'ツール名と理由を示す承認シートを作ります。' }, { type: 'tool-call', id: 'approval-bash', name: 'bash', arguments: '{"command":"pnpm test"}' }] }, stream: [{ time: origin, chunk: { type: 'block-start', index: 0, blockType: 'text' } }, { time: origin + 4100, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }], usage: { inputTokens: 11668, outputTokens: 812, totalTokens: 12480, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
  [4100, 'tool/call', { turn: 2, step: 1, callId: 'approval-bash', name: 'bash', arguments: '{"command":"pnpm test"}' }],
  [5300, 'tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'approval-bash', content: [{ type: 'text', text: '承認シートのテストが見つかりません。' }], isError: true }, error: { name: 'Error', code: 'EXIT_1' } }],
  [5300, 'tool/call', { turn: 2, step: 1, callId: 'approval-read', name: 'read_file', arguments: '{"path":"web/src/features/interactions/InteractionSheet.tsx"}' }],
  [5400, 'tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'approval-read', content: [{ type: 'text', text: '承認シートの実装を確認しました。' }] } }],
  [18400, 'step/end', { turn: 2, step: 1 }],
  [18400, 'turn/end', { turn: 2, reason: 'completed' }],
  [20000, 'turn/start', { turn: 3 }],
  [20000, 'user/message', { role: 'user', content: [{ type: 'text', text: 'テストも追加して' }] }],
  [20000, 'step/start', { turn: 3, step: 1 }],
])

export const sharedSessions: readonly { summary: SessionSummary; records: readonly SessionWireEvent[] }[] = [
  { summary: { retainedBy: {}, id: MOCK_IDS.sessions.readme, title: 'README の見直し', displayTitle: 'README の見直し', cwd: '/mock/dsh-webui-m3e', running: false, blank: false, updatedAt: origin + 15010 }, records: readmeRecords },
  { summary: { retainedBy: {}, id: MOCK_IDS.sessions.approval, title: '承認シートの実装', displayTitle: '承認シートの実装', cwd: '/mock/dsh-webui-m3e', running: true, blank: false, updatedAt: origin + 20000 }, records: approvalRecords },
]
