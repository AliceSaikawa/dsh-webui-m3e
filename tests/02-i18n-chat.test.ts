import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogProblems, messagesOf, untranslatedLocales, type Catalog, type Messages } from '../web/src/i18n/catalog.ts'
import { LOCALES } from '../web/src/i18n/locale.ts'
import {
  attachmentMessages, chatMessages, messageActionMessages, toolDetailMessages,
} from '../web/src/features/chat/messages.ts'
import { buildChatRows, commandPresentation, formatCommandPresentation, formatDuration } from '../web/src/features/chat/model.ts'
import { toolErrorMessage } from '../web/src/features/chat/tool-output.ts'

const catalogs = { chatMessages, attachmentMessages, toolDetailMessages, messageActionMessages } as const

test('チャットの辞書は日本語・英語・中国語がそろい、キーの欠け・余りがない', () => {
  for (const [name, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(catalogProblems(catalog), [], name)
    assert.deepEqual(untranslatedLocales(catalog), [], name)
    for (const locale of LOCALES) assert.notEqual(catalog[locale], null, `${name}.${locale}`)
  }
})

test('所要時間は言語ごとの単位と数で組み立てる（日本語は今までと同じ結果）', () => {
  assert.deepEqual(
    LOCALES.map(locale => formatDuration(0, messagesOf(chatMessages, locale), locale)),
    ['0 ミリ秒', '0 ms', '0 毫秒'])
  assert.deepEqual(
    LOCALES.map(locale => formatDuration(1250, messagesOf(chatMessages, locale), locale)),
    ['1.3 秒', '1.3 s', '1.3 秒'])
  assert.deepEqual(
    LOCALES.map(locale => formatDuration(62000, messagesOf(chatMessages, locale), locale)),
    ['1 分 2 秒', '1 min 2 s', '1 分 2 秒'])
  assert.deepEqual(
    LOCALES.map(locale => formatDuration(Number.NaN, messagesOf(chatMessages, locale), locale)),
    ['不明', 'Unknown', '未知'])
})

test('コマンドの結果は言語ごとの文で組み立て、日本語の既定は今までと同じ', () => {
  const failed = { name: 'permission', text: '', status: 'error' } as const
  assert.deepEqual(commandPresentation(failed), { label: '/permission の実行に失敗しました', icon: 'error', failureReason: '詳しい理由は記録されていません。' })
  assert.deepEqual(
    LOCALES.map(locale => formatCommandPresentation(failed, messagesOf(chatMessages, locale))),
    [
      { label: '/permission の実行に失敗しました', icon: 'error', failureReason: '詳しい理由は記録されていません。' },
      { label: '/permission failed', icon: 'error', failureReason: 'No detailed reason was recorded.' },
      { label: '/permission 执行失败', icon: 'error', failureReason: '没有记录详细原因。' },
    ])
})

test('コマンドの名前の有無で、言語ごとに区切りを付けて組み立てる', () => {
  const rows = [
    { name: 'permission', text: '', status: 'success' },
    { name: '', text: '', status: 'success' },
    { name: '', text: '', status: 'error' },
    { name: 'permission', text: '', status: 'unknown' },
    { name: '', text: '', status: 'unknown' },
  ] as const
  const labels = (locale: typeof LOCALES[number]) => rows.map(row => formatCommandPresentation(row, messagesOf(chatMessages, locale)).label)
  assert.deepEqual(labels('ja'), [
    '/permission を実行しました', 'コマンドを実行しました', 'コマンドの実行に失敗しました',
    '/permission の結果を受け取りました', 'コマンドの結果を受け取りました',
  ])
  assert.deepEqual(labels('en'), [
    'Ran /permission', 'Ran the command', 'Command failed',
    'Received the result of /permission', 'Received the command result',
  ])
  assert.deepEqual(labels('zh'), [
    '已执行 /permission', '已执行指令', '指令执行失败',
    '已收到 /permission 的结果', '已收到指令的结果',
  ])
})

test('名前のない添付ファイルは、モデルでは名前を決めず、表示の言語の既定名を使う', () => {
  const rows = buildChatRows([{
    seq: 1, time: 100, type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'file', attachment: { attachmentId: 'unnamed', bytes: 10 } }, { type: 'file', attachment: { attachmentId: 'named', name: 'a.txt', bytes: 1 } }] },
  }])
  const user = rows.find(row => row.kind === 'user')
  assert.ok(user?.kind === 'user')
  assert.deepEqual(user.content, [
    { type: 'file', attachment: { attachmentId: 'unnamed', bytes: 10 } },
    { type: 'file', attachment: { attachmentId: 'named', name: 'a.txt', bytes: 1 } },
  ])
  assert.deepEqual(LOCALES.map(locale => messagesOf(attachmentMessages, locale).defaultFileName), ['添付ファイル', 'Attached file', '附件文件'])
})

test('ツールの失敗理由は言語ごとの見出しで組み立てる', () => {
  const error = { name: 'Error', code: 'EXIT_1' }
  assert.deepEqual(
    LOCALES.map(locale => toolErrorMessage(error, messagesOf(toolDetailMessages, locale))),
    ['エラー種別：Error\nエラーコード：EXIT_1', 'Error type: Error\nError code: EXIT_1', '错误类型：Error\n错误代码：EXIT_1'])
})

test('添付の大きさは言語ごとの単位で組み立てる', () => {
  const text = (locale: 'ja' | 'en' | 'zh') => messagesOf(attachmentMessages, locale)
  assert.deepEqual(LOCALES.map(locale => text(locale).bytes('512')), ['512 バイト', '512 bytes', '512 字节'])
  assert.deepEqual(LOCALES.map(locale => text(locale).kilobytes('1.5')), ['1.5 KB', '1.5 KB', '1.5 KB'])
  assert.deepEqual(LOCALES.map(locale => text(locale).openFull('写真')), ['写真を全画面で表示', 'View 写真 full screen', '全屏查看写真'])
})

test('英語と中国語の文言は日本語のままではなく、中国語に DSH にない語を使わない', () => {
  const ja = messagesOf(chatMessages, 'ja')
  for (const locale of ['en', 'zh'] as const) {
    const translated = messagesOf(chatMessages, locale)
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
      assert.notEqual(translated[key], ja[key], `${locale}.${key}`)
    }
  }
  for (const catalog of [chatMessages, attachmentMessages, toolDetailMessages] as const) {
    const zh: Record<string, unknown> = messagesOf(catalog as Catalog<Messages>, 'zh')
    for (const [key, value] of Object.entries(zh)) {
      if (typeof value !== 'string') continue
      assert.ok(!value.includes('点按'), `zh.${key}`)
      assert.ok(!/[「」]/.test(value), `zh.${key}`)
    }
  }
})
