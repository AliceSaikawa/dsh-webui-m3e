import type { ChatContentBlock } from './model.ts'

/** The line budget spans all text blocks, including nested tool results. */
export function clipToolResult(blocks: readonly ChatContentBlock[], lineLimit = 200): { blocks: ChatContentBlock[]; truncated: boolean } {
  let remaining = Math.max(0, lineLimit)
  let truncated = false
  const visit = (items: readonly ChatContentBlock[]): ChatContentBlock[] => items.flatMap((block): ChatContentBlock[] => {
    if (block.type === 'tool-result') return [{ ...block, content: visit(block.content) }]
    if (block.type !== 'text') return [block]
    const lines = block.text.split('\n')
    if (lines.length <= remaining) { remaining -= lines.length; return [block] }
    truncated = true
    const text = lines.slice(0, remaining).join('\n')
    remaining = 0
    return text ? [{ type: 'text' as const, text }] : []
  })
  return { blocks: visit(blocks), truncated }
}
