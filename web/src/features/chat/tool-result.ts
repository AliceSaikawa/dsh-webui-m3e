import type { ChatContentBlock } from './model.ts'

/** Both budgets span the whole result tree; character counts use Unicode points. */
export function clipToolResult(blocks: readonly ChatContentBlock[], lineLimit = 200, characterLimit = 20_000): { blocks: ChatContentBlock[]; truncated: boolean } {
  let remainingLines = Number.isFinite(lineLimit) ? Math.max(0, Math.floor(lineLimit)) : 200
  let remainingCharacters = Number.isFinite(characterLimit) ? Math.max(0, Math.floor(characterLimit)) : 20_000
  let truncated = false
  const visit = (items: readonly ChatContentBlock[]): ChatContentBlock[] => items.flatMap((block): ChatContentBlock[] => {
    if (block.type === 'tool-result') return [{ ...block, content: visit(block.content) }]
    if (block.type !== 'text') return [block]
    if (remainingLines === 0 || (remainingCharacters === 0 && block.text.length > 0)) {
      truncated = true
      return []
    }
    let offset = 0
    let lines = 1
    let characters = 0
    let characterBudgetExhausted = false
    // Scan only the visible prefix rather than splitting a potentially huge line.
    while (offset < block.text.length) {
      const crlf = block.text[offset] === '\r' && block.text[offset + 1] === '\n'
      const newline = crlf || block.text[offset] === '\n'
      const width = crlf ? 2 : (block.text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1
      const cost = crlf ? 2 : 1
      if (characters + cost > remainingCharacters) { characterBudgetExhausted = true; break }
      if (newline && lines >= remainingLines) break
      if (newline) lines++
      characters += cost
      offset += width
    }
    remainingLines -= lines
    remainingCharacters = characterBudgetExhausted ? 0 : remainingCharacters - characters
    if (offset === block.text.length) return [block]
    truncated = true
    return [{ type: 'text', text: block.text.slice(0, offset) }]
  })
  return { blocks: visit(blocks), truncated }
}

/** DSH exposes name/code; some adapters additionally expose a human message. */
export function toolErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error.trim() ? error : undefined
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return undefined
  const detail = error as Record<string, unknown>
  if (typeof detail.message === 'string' && detail.message.trim()) return detail.message
  const parts: string[] = []
  if (typeof detail.name === 'string' && detail.name.trim()) parts.push(`エラー種別：${detail.name}`)
  if (typeof detail.code === 'string' && detail.code.trim()) parts.push(`エラーコード：${detail.code}`)
  return parts.length ? parts.join('\n') : undefined
}
