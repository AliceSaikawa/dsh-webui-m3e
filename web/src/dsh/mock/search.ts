import type { ContentBlock, SessionWireEvent } from '../services.ts'

/** The Host searches visible user/assistant content, never metadata or titles. */
export function mockMessageText(records: readonly SessionWireEvent[]): string {
  const current: SessionWireEvent[] = []
  for (const event of records) {
    if (event.surfaceOp === 'append') current.push(event)
    else if (event.surfaceOp && typeof event.surfaceOp === 'object' && 'op' in event.surfaceOp && event.surfaceOp.op === 'replace') {
      const op = event.surfaceOp
      const start = current.findIndex(row => row.seq === op.startSeq)
      const end = current.findIndex(row => row.seq === op.endSeq)
      if (start < 0 || end < start) throw new Error('検索用の表示範囲が不正です。')
      current.splice(start, end - start + 1, event)
    }
  }
  return current.filter(event => event.type === 'user/message' || event.type === 'assistant/message').flatMap(event => {
    if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) return []
    const data = event.data as { content?: ContentBlock[]; message?: { content?: ContentBlock[] } }
    return (data.message?.content ?? data.content ?? []).flatMap(block => block.type === 'text' ? [block.text] : block.type === 'tool-call' ? [block.name, block.arguments] : [])
  }).map(text => text.trim()).filter(Boolean).join('\n')
}

export function validMockSearchQuery(query: string): boolean {
  return query.length > 0 && query.length <= 500 && !query.includes('\0')
}
