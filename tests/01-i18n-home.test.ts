import assert from 'node:assert/strict'
import test from 'node:test'
import { messagesOf } from '../web/src/i18n/catalog.ts'
import { untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { homeMessages } from '../web/src/features/home/messages.ts'
import { folderName, formatUpdatedAt } from '../web/src/features/home/data.ts'

const ja = messagesOf(homeMessages, 'ja')
const en = messagesOf(homeMessages, 'en')
const zh = messagesOf(homeMessages, 'zh')

test('home catalog has English and Chinese for every key', () => {
  assert.deepEqual(untranslatedLocales(homeMessages), [])
  assert.deepEqual(Object.keys(en), Object.keys(ja))
  assert.deepEqual(Object.keys(zh), Object.keys(ja))
})

test('home counts and sentences build each language as one whole message', () => {
  assert.equal(ja.listCaption(2, false), '2 件のセッション')
  assert.equal(en.listCaption(1, false), '1 session')
  assert.equal(en.listCaption(2, false), '2 sessions')
  assert.equal(en.listCaption(2, true), '2 sessions · recently updated')
  assert.equal(zh.listCaption(2, false), '2 个会话')

  assert.equal(en.archiveSelected(1), 'Archive 1 session')
  assert.equal(en.archiveSelected(3), 'Archive 3 sessions')
  assert.equal(en.archiveDone(2), 'Archived 2 sessions')
  assert.equal(en.archiveDoneOne, 'Archived')
  assert.equal(zh.archiveSelected(3), '归档 3 个会话')

  assert.equal(en.selectedCount(2), '2 selected')
  assert.equal(zh.selectedCount(2), '已选择 2 个会话')
})

test('home sentences that quote a name keep the quotes of their own language', () => {
  assert.equal(ja.removeWorkspaceDescription('repo'), '「repo」の登録を解除します。フォルダの中身は消えません。')
  assert.equal(en.removeWorkspaceDescription('repo'), 'This removes “repo” from the workspace list. The folder contents will be kept.')
  assert.equal(zh.removeWorkspaceDescription('repo'), '将把“repo”从工作区列表中移除。文件夹内容会保留。')

  assert.equal(en.moveWorkspaceBefore('repo'), 'Before “repo”')
  assert.equal(zh.moveWorkspaceBefore('repo'), '移到“repo”之前')
})

test('the updated time uses the given locale and its own unknown text', () => {
  const now = new Date(2026, 8, 25, 12, 0)
  const today = new Date(2026, 8, 25, 9, 5)
  const older = new Date(2026, 0, 5, 9, 7)
  assert.equal(formatUpdatedAt(today.getTime(), now, 'ja', ja), '09:05')
  assert.equal(formatUpdatedAt(older.getTime(), now, 'ja', ja), '2026/01/05')
  assert.equal(formatUpdatedAt(older.getTime(), now, 'en', en), '01/05/2026')
  assert.equal(formatUpdatedAt(Number.NaN, now, 'en', en), en.updatedUnknown)
  assert.equal(formatUpdatedAt(Number.NaN, now, 'zh', zh), '时间未知')
  assert.equal(en.updatedUnknown, 'Date unknown')
})

test('the folder name falls back to the given language', () => {
  assert.equal(folderName(undefined, ja), '作業フォルダなし')
  assert.equal(folderName(undefined, en), 'No working folder')
  assert.equal(folderName(undefined, zh), '无工作文件夹')
  assert.equal(folderName('/home/test/project/', en), 'project')
})

test('no English or Chinese message keeps Japanese kana', () => {
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
  for (const [locale, text] of [['en', en], ['zh', zh]] as const) {
    for (const [key, value] of Object.entries(text)) {
      const rendered = typeof value === 'function' ? value(...(Array(value.length).fill('x') as [])) : value
      assert.ok(!kana.test(rendered), `${locale}.${key}: ${rendered}`)
    }
  }
})
