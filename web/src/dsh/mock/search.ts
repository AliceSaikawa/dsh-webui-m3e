import type { ContentBlock, SessionWireEvent } from '../services.ts'

/** The Host searches visible user/assistant content, never metadata or titles. */
export function mockMessageTexts(records: readonly SessionWireEvent[]): string[] {
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
    return [(data.message?.content ?? data.content ?? []).flatMap(block => block.type === 'text' ? [block.text] : block.type === 'tool-call' ? [block.name, block.arguments] : []).map(text => text.trim()).filter(Boolean).join('\n')]
  }).filter(Boolean)
}

export function mockMessageText(records: readonly SessionWireEvent[]): string { return mockMessageTexts(records).join('\n') }

/** Event-level best match. The provider's SQLite/FTS ranking is not emulated. */
export function mockSearchMatch(records: readonly SessionWireEvent[], query: string) {
  const needle = query.toLocaleLowerCase()
  return mockMessageTexts(records).flatMap(text => {
    const folded = text.toLocaleLowerCase(), index = folded.indexOf(needle)
    if (index < 0) return []
    const score = folded.split(needle).length - 1
    const points = Array.from(text), start = Math.max(0, Array.from(text.slice(0, index)).length - 15)
    return [{ score, snippet: points.slice(start, start + 240).join('') }]
  }).sort((a, b) => b.score - a.score)[0]
}

export function validMockSearchQuery(query: string): boolean {
  return query.length > 0 && query.length <= 500 && !query.includes('\0')
}
