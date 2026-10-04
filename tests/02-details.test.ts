import assert from 'node:assert/strict'
import test from 'node:test'
import { clipToolResult, toolErrorMessage } from '../web/src/features/chat/tool-output.ts'
import type { ChatContentBlock } from '../web/src/features/chat/model.ts'

test('ツール結果は全ブロックの合計200行で切り、元の結果を変えない', () => {
  const blocks: ChatContentBlock[] = [
    { type: 'text', text: Array.from({ length: 199 }, (_, i) => `前半${i}`).join('\n') },
    { type: 'text', text: '200行目\n201行目' },
    { type: 'text', text: '202行目' },
    { type: 'unsupported', originalType: '音声' },
  ]
  const previous = structuredClone(blocks)
  const clipped = clipToolResult(blocks)
  assert.equal(clipped.truncated, true)
  assert.deepEqual(clipped.blocks[1], { type: 'text', text: '200行目' })
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

test('HTML・JSX・Markdownに見える文字列と空行・CRLFをそのまま保持する', () => {
  const text = '<div class="sample">\r\n\r\n  <Widget value={value} />\r\n</div>\r\n# 見出しにしない\r\n\r\n'
  const blocks: ChatContentBlock[] = [{ type: 'text', text }, { type: 'text', text: '' }]
  const clipped = clipToolResult(blocks)
  assert.deepEqual(clipped, { blocks, truncated: false })
  assert.equal(clipped.blocks[0], blocks[0])
})

test('行数制限で切った最初の空行と末尾の空行を消さない', () => {
  assert.deepEqual(clipToolResult([{ type: 'text', text: '\n次の行' }], 1), { blocks: [{ type: 'text', text: '' }], truncated: true })
  assert.deepEqual(clipToolResult([{ type: 'text', text: '最初\n\n続き' }], 2), { blocks: [{ type: 'text', text: '最初\n' }], truncated: true })
  assert.deepEqual(clipToolResult([{ type: 'text', text: '' }], 1, 0), { blocks: [{ type: 'text', text: '' }], truncated: false })
})

test('長い1行も既定の20,000文字で切り、結果を変更しない', () => {
  const original: ChatContentBlock = { type: 'text', text: 'x'.repeat(25_000) }
  const clipped = clipToolResult([original])
  assert.deepEqual(clipped, { blocks: [{ type: 'text', text: 'x'.repeat(20_000) }], truncated: true })
  assert.equal(original.text.length, 25_000)
  assert.deepEqual(clipToolResult([{ type: 'text', text: 'x'.repeat(20_000) }]), { blocks: [{ type: 'text', text: 'x'.repeat(20_000) }], truncated: false })
})

test('文字数予算は複数ブロックの全体で共有する', () => {
  const blocks: ChatContentBlock[] = [
    { type: 'text', text: '前半' },
    { type: 'text', text: '中盤' },
    { type: 'text', text: '後半の長い文' },
    { type: 'text', text: '予算を超えた本文' },
  ]
  const previous = structuredClone(blocks)
  assert.deepEqual(clipToolResult(blocks, 200, 6), {
    blocks: [
      { type: 'text', text: '前半' },
      { type: 'text', text: '中盤' },
      { type: 'text', text: '後半' },
    ], truncated: true,
  })
  assert.deepEqual(blocks, previous)
})

test('UnicodeサロゲートとCRLFの途中で切らない', () => {
  assert.deepEqual(clipToolResult([{ type: 'text', text: 'あ😀𠮷終' }], 200, 3), { blocks: [{ type: 'text', text: 'あ😀𠮷' }], truncated: true })
  assert.deepEqual(clipToolResult([{ type: 'text', text: '甲\r\n乙\r\n丙' }], 2), { blocks: [{ type: 'text', text: '甲\r\n乙' }], truncated: true })
  assert.deepEqual(clipToolResult([{ type: 'text', text: '甲\r\n乙' }, { type: 'text', text: '後ろ' }], 200, 2), { blocks: [{ type: 'text', text: '甲' }], truncated: true })
  assert.deepEqual(clipToolResult([{ type: 'text', text: '甲\r\n乙' }], 200, 3), { blocks: [{ type: 'text', text: '甲\r\n' }], truncated: true })
})

test('ツール失敗理由は文字列・message・DSHのname/codeを表示用に取り出す', () => {
  assert.equal(toolErrorMessage('ファイルを読めませんでした。'), 'ファイルを読めませんでした。')
  assert.equal(toolErrorMessage({ message: '<div> を読み取れません。\nもう一度実行してください。', name: 'Error', code: 'READ_FAILED' }), '<div> を読み取れません。\nもう一度実行してください。')
  assert.equal(toolErrorMessage({ name: 'Error', code: 'EXIT_1' }), 'エラー種別：Error\nエラーコード：EXIT_1')
  assert.equal(toolErrorMessage({ code: 'EXIT_1' }), 'エラーコード：EXIT_1')
  for (const value of [undefined, null, '', '   ', false, 42, [], {}, { message: 1 }, { name: ' ', code: '' }]) {
    assert.equal(toolErrorMessage(value), undefined)
  }
})
