import type { JsonValue, SessionWireEvent } from '../services.ts'

const object = (value: JsonValue | undefined): Record<string, JsonValue> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined

/** Supply identity for isolated parser tests, including intentionally incomplete records. */
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

/** Normal fixtures must supply V4 coordinates and durable payloads explicitly. */
export function mockFixtureRecord(seq: number, type: string, time: number, input: JsonValue): SessionWireEvent {
  const data = object(input)
  if (['system/message', 'developer/message', 'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result'].includes(type)) {
    for (const field of ['turn', 'step']) if (!Number.isSafeInteger(data?.[field]) || Number(data?.[field]) < 1) {
      throw new TypeError(`${type} requires ${field}`)
    }
  }
  if (['assistant/message', 'assistant/attempt'].includes(type) && !Array.isArray(data?.stream)) throw new TypeError(`${type} requires stream`)
  if (type === 'tool/call' && typeof data?.arguments !== 'string') throw new TypeError('tool/call requires arguments')
  return mockRecord(seq, type, time, input)
}
