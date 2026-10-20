import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogProblems, messagesOf } from '../web/src/i18n/catalog.ts'
import { chatActionMessages } from '../web/src/features/chat/messages.ts'
import { codeBlockCopyText, createMessageTextSource, messageBody } from '../web/src/features/chat/text-selection.ts'

test('自分の吹き出しは送った文字のまま、AI の本文は Markdown として選ぶ', () => {
  assert.equal(messageBody('user'), 'plain')
  assert.equal(messageBody('assistant'), 'markdown')
})

test('操作シートを開いたあとに届いた本文を、選択を開く時点のスナップショットとして読める', () => {
  const source = createMessageTextSource({ text: '先頭', streaming: true })
  let notices = 0
  const stop = source.subscribe(() => { notices += 1 })
  source.set({ text: '先頭', streaming: true })
  assert.equal(notices, 0)
  source.set({ text: '先頭の続き SELECT-END', streaming: true })
  assert.equal(notices, 1)
  assert.deepEqual(source.getSnapshot(), { text: '先頭の続き SELECT-END', streaming: true })
  stop()
  source.set({ text: '確定した本文', streaming: false })
  assert.equal(notices, 1)
  assert.deepEqual(source.getSnapshot(), { text: '確定した本文', streaming: false })
})

test('コードブロックのコピーは末尾の改行だけを外し、コマンド中の改行は残す', () => {
  assert.equal(codeBlockCopyText('pnpm test --reporter=dot\n'), 'pnpm test --reporter=dot')
  assert.equal(codeBlockCopyText('echo a\necho b\n'), 'echo a\necho b')
  assert.equal(codeBlockCopyText('echo a'), 'echo a')
})

test('コピー失敗の案内は、選択シートを開く操作を三言語で指す', () => {
  assert.deepEqual(catalogProblems(chatActionMessages), [])
  const ja = messagesOf(chatActionMessages, 'ja').copyFailed
  const en = messagesOf(chatActionMessages, 'en').copyFailed
  const zh = messagesOf(chatActionMessages, 'zh').copyFailed
  assert.match(ja, /「テキストを選択」を開いて/)
  assert.match(en, /Open Select text/)
  assert.match(zh, /「选择文本」/)
  assert.equal(messagesOf(chatActionMessages, 'ja').selectText, 'テキストを選択')
  assert.equal(messagesOf(chatActionMessages, 'ja').copy, 'コピー')
  assert.equal(messagesOf(chatActionMessages, 'ja').fork, 'ここから分岐')
})
