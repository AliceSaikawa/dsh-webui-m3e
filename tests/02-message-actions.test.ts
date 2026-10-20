import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
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

test('コピー失敗の案内は、言語ごとの引用符でボタン名を囲む（日本語「」、英語と中国語 “”）', () => {
  const quoted = (locale: 'ja' | 'en' | 'zh') => {
    const text = messagesOf(messageActionMessages, locale)
    return text.copyFailed.includes(locale === 'ja' ? `「${text.selectText}」` : `“${text.selectText}”`)
  }
  assert.deepEqual([quoted('ja'), quoted('en'), quoted('zh')], [true, true, true])
})

test('中国語の文言は DSH の語（复制成功・点击）に合わせ、DSH にない語（点按）と「」を使わない', () => {
  const zh = messagesOf(messageActionMessages, 'zh')
  assert.equal(zh.copy, '复制')
  assert.equal(zh.copied, '复制成功。')
  assert.equal(zh.close, '关闭')
  for (const [key, value] of Object.entries(zh)) {
    assert.ok(!value.includes('点按'), `zh.${key}`)
    assert.ok(!/[「」]/.test(value), `zh.${key}`)
  }
})

test('用語の対応表 docs/i18n/glossary.md に、この辞書の主な用語が日本語・英語・中国語の組で載っている', () => {
  const glossary = readFileSync(new URL('../docs/i18n/glossary.md', import.meta.url), 'utf8')
  const rows = glossary.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith('|---')).map(line => line.split('|').slice(1, 4).map(cell => cell.trim()))
  const ja = messagesOf(messageActionMessages, 'ja')
  const en = messagesOf(messageActionMessages, 'en')
  const zh = messagesOf(messageActionMessages, 'zh')
  for (const key of ['copy', 'copied', 'close', 'fork', 'selectText'] as const) {
    assert.ok(rows.some(row => row[0] === ja[key] && row[1] === en[key] && row[2] === zh[key]), `glossary row for ${key}: ${ja[key]} / ${en[key]} / ${zh[key]}`)
  }
})
