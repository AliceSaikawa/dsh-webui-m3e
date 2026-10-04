import type { ContentBlock, SessionWireEvent } from '../services.ts'

/** The Host searches visible user/assistant content, never metadata or titles. */
export function mockMessageText(records: readonly SessionWireEvent[]): string {
  return records.filter(event => event.type === 'user/message' || event.type === 'assistant/message').flatMap(event => {
    if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) return []
    const data = event.data as { content?: ContentBlock[]; message?: { content?: ContentBlock[] } }
    return (data.message?.content ?? data.content ?? []).flatMap(block => block.type === 'text' ? [block.text] : [])
  }).join('\n')
}

export function validMockSearchQuery(query: string): boolean {
  return query.length > 0 && query.length <= 500 && !query.includes('\0')
}
