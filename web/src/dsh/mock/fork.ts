import type { JsonValue, SessionWireEvent } from '../services.ts'

/** dsh-session/fork + repair: close only the open tail after the inherited cut. */
export function mockForkSeed(events: readonly SessionWireEvent[], boundary: number): SessionWireEvent[] {
  const prefix = structuredClone(events.slice(0, boundary + 1))
  const time = prefix.at(-1)!.time
  prefix.push({ type: 'session/end-seed', seq: boundary + 1, time, data: { inherited: true } })
  let turn: number | undefined, step: number | undefined
  const pending = new Map<string, { turn: number; step: number; callSeq?: number }>()
  for (const event of prefix) {
    const data = event.data as Record<string, JsonValue>
    switch (event.type) {
      case 'turn/start': turn = Number(data.turn); step = undefined; pending.clear(); break
      case 'turn/end': turn = step = undefined; pending.clear(); break
      case 'step/start': step = Number(data.step); break
      case 'step/end': step = undefined; pending.clear(); break
      case 'assistant/message': {
        const message = data.message as { content: { type: string; id: string }[] }
        for (const block of message.content) if (block.type === 'tool-call') pending.set(block.id, { turn: Number(data.turn), step: Number(data.step) })
        break
      }
      case 'tool/call': { const entry = pending.get(String(data.callId)); if (entry) entry.callSeq = event.seq; break }
      case 'tool/result': {
        const callId = (data.message as { source: { callId: string } }).source.callId
        const entry = pending.get(callId)
        if (event.surfaceOp === 'append' && entry && entry.turn === data.turn && entry.step === data.step) pending.delete(callId)
        break
      }
    }
  }
  if (turn === undefined) return prefix
  for (const [callId, entry] of pending) {
    const started = entry.callSeq !== undefined
    prefix.push({ type: 'tool/result', seq: prefix.length, time, surfaceOp: 'append', ...(started ? { sourceEventSeqs: [entry.callSeq!] } : {}), data: {
      turn: entry.turn, step: entry.step,
      message: { id: `forked-tool-result-${callId}-${prefix.length}`, role: 'tool', toolCallId: callId, isError: true, source: { kind: 'tool', callId }, content: [{ type: 'text', text: started ? '分岐点までにツールの開始は記録されていますが、結果は含まれていません。再試行の前に外部の状態を確認してください。' : '分岐点までにツールの開始は記録されていません。親の会話で実行された可能性があるため、再試行の前に外部の状態を確認してください。' }] },
      error: started ? { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' } : { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' },
    } })
  }
  if (step !== undefined) prefix.push({ type: 'step/end', seq: prefix.length, time, data: { turn, step } })
  prefix.push({ type: 'turn/end', seq: prefix.length, time, data: { turn, reason: { kind: 'forked' } } })
  return prefix
}
