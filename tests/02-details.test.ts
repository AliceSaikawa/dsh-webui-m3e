import assert from 'node:assert/strict'
import test from 'node:test'
import { clipToolResult } from '../web/src/features/chat/tool-result.ts'
import type { ChatContentBlock } from '../web/src/features/chat/model.ts'

test('ツール結果は入れ子を含めた合計200行で切り、元の結果を変えない', () => {
  const blocks: ChatContentBlock[] = [
    { type: 'text', text: Array.from({ length: 199 }, (_, i) => `前半${i}`).join('\n') },
    { type: 'tool-result', toolCallId: 'nested', content: [{ type: 'text', text: '200行目\n201行目' }] },
    { type: 'text', text: '202行目' },
    { type: 'unsupported', originalType: '音声' },
  ]
  const previous = structuredClone(blocks)
  const clipped = clipToolResult(blocks)
  assert.equal(clipped.truncated, true)
  assert.deepEqual(clipped.blocks[1], { type: 'tool-result', toolCallId: 'nested', content: [{ type: 'text', text: '200行目' }] })
  assert.deepEqual(clipped.blocks[2], { type: 'unsupported', originalType: '音声' })
  assert.equal(clipped.blocks.length, 3)
  assert.deepEqual(blocks, previous)
})

test('200行ちょうどの結果と画像は切り詰め不要', () => {
  const blocks: ChatContentBlock[] = [{ type: 'text', text: Array.from({ length: 200 }, () => '確認').join('\n') },
    { type: 'image', attachment: { attachmentId: 'image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }]
  assert.deepEqual(clipToolResult(blocks), { blocks, truncated: false })
  assert.deepEqual(clipToolResult([]), { blocks: [], truncated: false })
})
