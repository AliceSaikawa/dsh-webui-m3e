import type { JsonValue, SessionWireEvent } from '../services.ts'

const object = (value: JsonValue | undefined): Record<string, JsonValue> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined

/** Supply V4 identity and attribution for small mock/unit-test message payloads. */
export function mockRecord(seq: number, type: string, time: number, input: JsonValue): SessionWireEvent {
  let data = input
  const payload = object(input)
  const role = ({ 'user/message': 'user', 'assistant/message': 'assistant', 'tool/result': 'tool', 'system/message': 'system', 'developer/message': 'developer' } as Record<string, string>)[type]
  if (payload && role) {
    const message = role === 'user' ? payload : object(payload.message)
    if (message) {
      const source: JsonValue = role === 'assistant' ? { kind: 'model', provider: 'mock', model: 'mock-model' }
        : role === 'tool' ? { kind: 'tool', callId: message.toolCallId ?? '' }
        : { kind: role === 'system' ? 'system-prompt' : role === 'developer' ? 'tool-cordis' : 'user' }
      const identified = { id: `mock-${seq}`, role, source, ...message }
      data = role === 'user' ? identified : { ...payload, message: identified }
    }
  }
  return { seq, type, time, data, ...(role ? { surfaceOp: 'append' } : {}) }
}
