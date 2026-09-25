import type { ContentBlock, JsonValue, SessionSummary, SessionWireEvent, TokenUsage, WorkspaceView } from '../../dsh/services.ts'
import { imageAttachment } from '../../dsh/mock/fixtures.ts'

export const TRACE_EXAMPLE_SESSION_ID = 'trace-example'
export const TRACE_EXAMPLE_WORKSPACE_ID = 'ws-trace-example'
export const TRACE_FAILURE_SESSION_ID = 'trace-failure-example'
const origin = Date.parse('2026-09-25T10:00:00+09:00')
const workspacePath = '/mock/trace-example'
const modelSource = { kind: 'model', provider: 'mock', model: 'mock-model' }
const text = (value: string): ContentBlock => ({ type: 'text', text: value })

/** Timed compact records preserve delta boundaries, as the durable DSH stream does. */
function outputStream(content: readonly ContentBlock[], start: number, end: number, usage: TokenUsage): unknown[] {
  const result: unknown[] = []
  const blockSpan = Math.floor((end - start) / Math.max(1, content.length))
  for (const [index, block] of content.entries()) {
    const time0 = start + index * blockSpan + Math.min(120, Math.floor(blockSpan / 4))
    result.push({ type: 'chunk', time: time0 - 1, chunk: { type: 'block-start', index, blockType: block.type } })
    if (block.type === 'text' || block.type === 'reasoning') {
      result.push({ type: block.type === 'text' ? 'text-chunks' : 'reasoning-chunks', time0, index, dt: [25], texts: ['', block.text] })
    } else if (block.type === 'tool-call') {
      result.push({ type: 'tool-call-chunks', time0, index, id: block.id, name: block.name, dt: [25], args: ['', block.arguments] })
    }
    result.push({ type: 'chunk', time: start + (index + 1) * blockSpan - 1, chunk: { type: 'block-end', index, block } })
  }
  result.push({ type: 'chunk', time: end, chunk: { type: 'usage', usage } })
  result.push({ type: 'chunk', time: end, chunk: { type: 'finish', reason: { kind: content.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } } })
  return result
}

/** A complete page pair: the default 100-record window needs exactly one loadOlder. */
export function createTraceExampleRecords(): SessionWireEvent[] {
  const records: SessionWireEvent[] = []
  let clock = origin
  const append = (type: string, data: unknown, advance = 0, surface?: Pick<SessionWireEvent, 'surfaceOp' | 'sourceEventSeqs'>): SessionWireEvent => {
    clock += advance
    const isSurface = ['user/message', 'assistant/message', 'tool/result'].includes(type)
    const event: SessionWireEvent = {
      type, seq: records.length, time: clock,
      data: JSON.parse(JSON.stringify(data)) as JsonValue,
      ...(isSurface ? { surfaceOp: 'append' } : {}),
      ...surface,
    }
    records.push(event)
    return event
  }
  const user = (content: readonly ContentBlock[]) => append('user/message', {
    id: `trace-user-${records.length}`, role: 'user', source: { kind: 'user' }, content,
  }, 10)
  const assistant = (turn: number, step: number, start: number, content: readonly ContentBlock[], advance = 400) => {
    const usage: TokenUsage = { inputTokens: 120 + step, outputTokens: 40 + step, cacheReadTokens: 60, cacheWriteTokens: 20, reasoningTokens: 10 }
    return append('assistant/message', {
      turn, step,
      message: { id: `trace-assistant-${turn}-${step}`, role: 'assistant', source: modelSource, content },
      stream: outputStream(content, start, clock + advance, usage), usage,
    }, advance)
  }
  const toolResult = (turn: number, step: number, callId: string, result: string, advance: number, isError = false) => append('tool/result', {
    turn, step,
    message: {
      id: `trace-result-${callId}`, role: 'user', source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, content: [text(result)], isError }],
    },
    ...(isError ? { error: { name: 'Error', code: 'EXIT_1' } } : {}),
  }, advance)

  append('turn/start', { turn: 1 })
  for (let step = 1; step <= 18; step += 1) {
    const started = append('step/start', { turn: 1, step }, 500)
    if (step === 1) user([text('長い履歴の見本です。前の記録を読み込み、各ファイルの確認結果を調べてください。')])
    const callId = `trace-history-${step}`
    const args = JSON.stringify({ path: `docs/確認-${step}.md` })
    assistant(1, step, started.time, [text(`資料 ${step} の確認を進めます。`), { type: 'tool-call', id: callId, name: 'read_file', arguments: args }])
    append('tool/call', { turn: 1, step, callId, name: 'read_file', arguments: args }, 20)
    toolResult(1, step, callId, `資料 ${step}：検索・表示・操作の確認が完了しました。`, 80)
    append('step/end', { turn: 1, step })
  }
  append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  append('turn/start', { turn: 2 }, 1000)
  append('step/start', { turn: 2, step: 1 }, 100)
  const request = user([
    text('再試行、入れ子のツール、要約、失敗した処理を確認してください。添付も参考にしてください。'),
    { type: 'image', attachment: imageAttachment },
    { type: 'file', attachment: { attachmentId: 'trace-checklist', name: '確認項目.txt', bytes: 128 } },
  ])
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const failure = { code: 'NETWORK', message: `接続を確認して、${attempt} 回目の再試行を行います。` }
    const attemptTime = clock + 100
    append('assistant/attempt', {
      turn: 2, step: 1,
      stream: [
        { type: 'reasoning-chunks', time0: attemptTime, index: 0, dt: [20], texts: ['', '接続状態を確認します。'] },
        { type: 'chunk', time: attemptTime + 200, chunk: { type: 'finish', reason: { kind: 'error', failure } } },
      ],
    }, 300)
    append('llm/retry', { turn: 2, step: 1, retry: attempt, maxRetries: 3, mode: 'normal', delayMs: 100, failure }, 100)
  }
  const rootCallId = 'trace-root'
  const rootArgs = JSON.stringify({ code: '確認対象のファイルを順番に調べる' })
  const response = assistant(2, 1, clock, [
    { type: 'reasoning', text: '再試行後に、親ツールから確認用の子ツールを実行します。' },
    text('入れ子の記録を確認します。'),
    { type: 'tool-call', id: rootCallId, name: 'run_code', arguments: rootArgs },
  ], 600)
  append('tool/call', { turn: 2, step: 1, callId: rootCallId, name: 'run_code', arguments: rootArgs }, 10)
  const child = { rootCallId, parentCallId: rootCallId, subCallId: 'trace-child', name: 'inspect_files', arguments: { paths: ['docs/確認項目.md'] } }
  const grandchild = { rootCallId, parentCallId: 'trace-child', subCallId: 'trace-grandchild', name: 'read_file', arguments: { path: 'docs/確認項目.md' } }
  append('tool/ptc-dispatch-start', child, 20)
  append('tool/ptc-dispatch-start', grandchild, 20)
  append('tool/ptc-dispatch', { ...grandchild, content: [text('孫ツール：確認項目を読み込みました。')], isError: false }, 80)
  append('tool/ptc-dispatch', { ...child, content: [text('子ツール：ファイルの確認が完了しました。')], isError: false }, 30)
  const rootResult = toolResult(2, 1, rootCallId, '入れ子のツールはすべて完了しました。', 50)
  append('step/end', { turn: 2, step: 1 })

  const compactionId = 'trace-compaction'
  const summary = [text('確認対象のファイルを読み込みました。残りは失敗した検証と最終確認です。')]
  append('compaction/start', { compactionId, turn: 2 }, 100)
  append('compaction/summary', {
    compactionId, turn: 2, summary,
    rawOutput: [{ type: 'reasoning', text: '確認済みの作業と残りの作業を分けて要約します。' }, ...summary],
    provider: 'mock', model: 'mock-model', maxTokens: 1024,
    usage: { inputTokens: 600, outputTokens: 80, cacheReadTokens: 120, cacheWriteTokens: 0 },
  }, 700)
  append('user/message', {
    id: 'trace-checkpoint', role: 'user', source: { kind: 'plugin', plugin: 'compact', compactionId }, content: summary,
  }, 0, { surfaceOp: { op: 'replace', startSeq: request.seq, endSeq: rootResult.seq }, sourceEventSeqs: [request.seq, response.seq, rootResult.seq] })
  append('compaction/end', { compactionId, turn: 2 }, 10)

  const failedStart = append('step/start', { turn: 2, step: 2 }, 100)
  const failedCallId = 'trace-failed-check'
  const failedArgs = JSON.stringify({ command: 'pnpm test', cwd: workspacePath })
  assistant(2, 2, failedStart.time, [text('検証を実行します。'), { type: 'tool-call', id: failedCallId, name: 'bash', arguments: failedArgs }])
  append('tool/call', { turn: 2, step: 2, callId: failedCallId, name: 'bash', arguments: failedArgs }, 10)
  toolResult(2, 2, failedCallId, '検証に失敗しました。検索バーの文言を確認してください。', 250, true)
  append('step/end', { turn: 2, step: 2 })
  const finalStart = append('step/start', { turn: 2, step: 3 }, 100)
  assistant(2, 3, finalStart.time, [text('検索バーの文言が検証で一致しませんでした。失敗した記録の詳細から、引数と結果を確認できます。')])
  append('step/end', { turn: 2, step: 3 })
  append('turn/end', { turn: 2, reason: { kind: 'completed' } })

  append('turn/start', { turn: 3 }, 1000)
  append('step/start', { turn: 3, step: 1 }, 100)
  user([text('最後の確認を続けてください。このターンは実行中の表示を確かめるための見本です。')])
  return records
}

export const traceExampleRecords: readonly SessionWireEvent[] = createTraceExampleRecords()
export const traceExampleSession: SessionSummary = {
  id: TRACE_EXAMPLE_SESSION_ID, title: 'トレースの見本', displayTitle: 'トレースの見本',
  cwd: workspacePath, running: true, blank: false,
  updatedAt: traceExampleRecords.at(-1)!.time,
}

const failedOrigin = origin + 20 * 60 * 1000
const requestMessage = (id: string, value: string) => ({ id, role: 'user', source: { kind: 'user' }, content: [text(value)] })
const failedConnection = { code: 'NETWORK', message: '接続先に到達できませんでした。' }
const failureRows: readonly [number, string, unknown][] = [
  [0, 'turn/start', { turn: 1 }],
  [10, 'step/start', { turn: 1, step: 1 }],
  [20, 'user/message', requestMessage('trace-error-input', '接続失敗の原因を確認してください。')],
  [200, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: failedOrigin + 200, chunk: { type: 'finish', reason: { kind: 'error', failure: failedConnection } } }] }],
  [210, 'step/end', { turn: 1, step: 1 }],
  [220, 'turn/end', { turn: 1, reason: { kind: 'error', error: failedConnection } }],
  [1000, 'turn/start', { turn: 2 }],
  [1010, 'step/start', { turn: 2, step: 1 }],
  [1020, 'user/message', requestMessage('trace-aborted-input', '途中で停止した出力も残してください。')],
  [1300, 'assistant/message', {
    turn: 2, step: 1, interrupted: true,
    message: { id: 'trace-aborted-output', role: 'assistant', source: modelSource, content: [text('途中までの回答です。')] },
    stream: [{ type: 'text-chunks', time0: failedOrigin + 1100, index: 0, dt: [50], texts: ['途中までの', '回答です。'] }],
  }],
  [1310, 'step/end', { turn: 2, step: 1 }],
  [1320, 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }],
  [2000, 'turn/start', { turn: 3 }],
  [2010, 'turn/end', { turn: 3, reason: { kind: 'blocked' } }],
  [3000, 'turn/start', { turn: 4 }],
  [3010, 'step/start', { turn: 4, step: 1 }],
  [3020, 'user/message', requestMessage('trace-interrupted-input', '終了記録がない中断を確認してください。')],
  [3300, 'turn/end', { turn: 4, reason: { kind: 'interrupted' } }],
  [4000, 'turn/start', { turn: 5 }],
  [4010, 'step/start', { turn: 5, step: 1 }],
  [4020, 'user/message', requestMessage('trace-recovered-input', '過去の失敗を残したまま、次の確認を進めてください。')],
  [4300, 'assistant/message', {
    turn: 5, step: 1,
    message: { id: 'trace-recovered-output', role: 'assistant', source: modelSource, content: [text('このターンは正常に完了しました。')] },
    stream: [{ type: 'text-chunks', time0: failedOrigin + 4150, index: 0, dt: [], texts: ['このターンは正常に完了しました。'] },
      { type: 'chunk', time: failedOrigin + 4300, chunk: { type: 'finish', reason: { kind: 'stop' } } }],
  }],
  [4310, 'step/end', { turn: 5, step: 1 }],
  [4320, 'turn/end', { turn: 5, reason: { kind: 'completed' } }],
]
export const traceFailureRecords: readonly SessionWireEvent[] = failureRows.map(([offset, type, data], seq) => ({
  type, seq, time: failedOrigin + offset, data: JSON.parse(JSON.stringify(data)) as JsonValue,
  ...(['user/message', 'assistant/message'].includes(type) ? { surfaceOp: 'append' } : {}),
}))
export const traceFailureSession: SessionSummary = {
  id: TRACE_FAILURE_SESSION_ID, title: '失敗と中断の見本', displayTitle: '失敗と中断の見本',
  cwd: workspacePath, running: false, blank: false, updatedAt: traceFailureRecords.at(-1)!.time,
}
export const traceExampleWorkspace: WorkspaceView = {
  workspaceId: TRACE_EXAMPLE_WORKSPACE_ID, title: 'トレースの確認', path: workspacePath,
  sessionIds: [TRACE_EXAMPLE_SESSION_ID, TRACE_FAILURE_SESSION_ID],
  createdAt: new Date(origin).toISOString(), updatedAt: new Date(traceFailureSession.updatedAt).toISOString(),
}
