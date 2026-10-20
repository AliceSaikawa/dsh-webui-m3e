import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogProblems, messagesOf } from '../web/src/i18n/catalog.ts'
import { LOCALES } from '../web/src/i18n/locale.ts'
import { messageActionMessages } from '../web/src/features/chat/messages.ts'

test('メッセージの操作の辞書は日本語・英語・中国語がそろい、訳が入っている', () => {
  assert.deepEqual(catalogProblems(messageActionMessages), [])
  for (const locale of LOCALES) assert.notEqual(messageActionMessages[locale], null, locale)
  assert.deepEqual(
    LOCALES.map(locale => messagesOf(messageActionMessages, locale).selectText),
    ['テキストを選択', 'Select text', '选择文本'])
})

test('コピーに失敗したときの案内は、実際にあるボタン名「テキストを選択」を指す', () => {
  for (const locale of LOCALES) {
    const text = messagesOf(messageActionMessages, locale)
    assert.ok(text.copyFailed.includes(text.selectText), `${locale}: ${text.copyFailed}`)
  }
})

test('英語と中国語の文言は日本語のままではない', () => {
  const ja = messagesOf(messageActionMessages, 'ja')
  for (const locale of ['en', 'zh'] as const) {
    const text = messagesOf(messageActionMessages, locale)
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) assert.notEqual(text[key], ja[key], `${locale}.${key}`)
  }
})
