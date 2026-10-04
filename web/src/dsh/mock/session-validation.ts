import type { SessionWireEvent } from '../services.ts'

const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}

// Host session.attachment reads declared fields only. In particular, unknown
// payloads and nested legacy tool-result blocks are not authorization evidence.
export function referencesImage(events: readonly SessionWireEvent[], attachmentId: string): boolean {
  const contains = (content: unknown) => Array.isArray(content) && content.some(value => {
    const block = object(value)
    return block.type === 'image' && String(object(block.attachment).attachmentId) === attachmentId
  })
  return events.some(event => {
    const data = object(event.data)
    switch (event.type) {
      case 'user/message': case 'tool/ptc-dispatch': return contains(data.content)
      case 'system/message': case 'developer/message': case 'tool/result': case 'team/message/queued': return contains(object(data.message).content)
      case 'agent/inbox/spliced': return Array.isArray(data.inserted) && data.inserted.some(message => contains(object(message).content))
      case 'compaction/summary': return contains(data.summary) || contains(data.rawOutput)
      case 'assistant/message': if (contains(object(data.message).content)) return true; break
      case 'assistant/attempt': break
      default: return false
    }
    return Array.isArray(data.stream) && data.stream.some(value => {
      const entry = object(value), chunk = object(entry.chunk)
      return entry.type === 'chunk' && chunk.type === 'block-end' && contains([chunk.block])
    })
  })
}

// Same sanitization as dsh-session-title; the fixture provider chooses a
// 120-byte title budget (the real service's budget is profile configurable).
export function normalizeMockTitle(input: string): string {
  const cleaned = input
    .replace(/(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu, '')
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\u001B[@-_]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ').trim()
  let bytes = 0, result = ''
  for (const character of cleaned) {
    bytes += new TextEncoder().encode(character).length
    if (bytes > 120) break
    result += character
  }
  return result.trimEnd()
}
