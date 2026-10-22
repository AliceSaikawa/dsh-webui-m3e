import assert from 'node:assert/strict'
import test from 'node:test'
import { messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import type { SessionFace } from '../web/src/dsh/services.ts'
import { composerMessages } from '../web/src/features/composer/messages.ts'
import { queueEditPrompt } from '../web/src/features/composer/queue-edit.ts'

const en = messagesOf(composerMessages, 'en')
const zh = messagesOf(composerMessages, 'zh')
const ja = messagesOf(composerMessages, 'ja')

const face = {
  async updateQueue() { return { ok: true as const, value: { accepted: true } } },
} as Pick<SessionFace, 'updateQueue'>

const item = { id: 'queued-one', text: '本文', content: [] as const }
const imageItem = {
  id: 'queued-two',
  text: null,
  content: [{ type: 'image' as const, attachment: { attachmentId: 'image-one', mediaType: 'image/png' as const, bytes: 10, width: 1, height: 1 } }],
}

test('composer の辞書は日本語・英語・中国語がそろっている', () => {
  assert.deepEqual(untranslatedLocales(composerMessages), [])
  assert.equal(ja.inputPlaceholder, 'メッセージを入力')
  assert.equal(en.inputPlaceholder, 'Type a message')
  assert.equal(zh.inputPlaceholder, '输入消息')
})

test('キューの編集は渡した言語の題名と入力欄の説明を使う', () => {
  const enPrompt = queueEditPrompt(face, item, () => {}, en)
  assert.equal(enPrompt.title, 'Edit the queued message')
  assert.equal(enPrompt.label, 'Message')
  assert.equal(imageEditLabel(en, imageItem), 'Message (editing removes attached images)')

  const zhPrompt = queueEditPrompt(face, item, () => {}, zh)
  assert.equal(zhPrompt.title, '编辑排队中的消息')
  assert.equal(zhPrompt.label, '消息')
  assert.equal(imageEditLabel(zh, imageItem), '消息（编辑后将移除附件图片）')

  // The default stays Japanese, so existing callers keep their text.
  assert.equal(queueEditPrompt(face, item, () => {}).title, '順番待ちのメッセージを編集')
})

function imageEditLabel(text: typeof en, message: typeof imageItem): string {
  const prompt = queueEditPrompt(face, message, () => {}, text)
  return prompt.label ?? ''
}

test('数や値を差し込む文言は言語ごとに文全体を組み立てる', () => {
  assert.equal(en.queueChip(1), '1 queued message')
  assert.equal(en.queueChip(3), '3 queued messages')
  assert.equal(zh.queueChip(3), '排队消息 3 条')
  assert.equal(ja.queueChip(3), '順番待ち 3 件')

  assert.equal(en.cacheStaleWithAge(75), 'Cache expired (75 min since the last response). Sending now will be blocked.')
  assert.equal(zh.cacheStaleWithAge(75), '缓存已过期（距上次响应 75 分钟）。现在发送会被阻止。')
  assert.equal(en.cacheStale, 'Cache expired. Sending now will be blocked.')
  assert.equal(zh.cacheUnlockedRemaining(9), '已允许下一次发送（将按无缓存计费）。还剩 9 分钟')
  assert.equal(en.cacheUnlocked, 'The next send is allowed (it will be charged at the uncached rate).')
  assert.equal(ja.cacheUnlocked, '次の送信を許可中(キャッシュなしの料金になります)。')

  assert.equal(en.permissionLabel('Read Only'), 'Permission: Read Only')
  assert.equal(zh.permissionLabel('仅可查看'), '权限：仅可查看')
  assert.equal(en.permissionWithdrawn('Read Only', undefined), 'The permission “Read Only” is no longer available, so it was changed back to the default.')
  assert.equal(zh.permissionWithdrawn('仅可查看', '工作区内修改'), '权限“仅可查看”已不可用，已改回“工作区内修改”。')
})

test('入力欄の失敗の文は、M3E が書いた文だけをそのまま出し、提供元の生の文は出さない', async () => {
  const { errorText, LocalizedError } = await import('../web/src/features/composer/localized-error.ts')
  const { RemoteCallError } = await import('../web/src/dsh/remote-result.ts')
  // A provider's raw English message must not reach a Japanese, English or Chinese page.
  const raw = new Error('401 Unauthorized: invalid x-api-key')
  assert.equal(errorText(raw, ja.modelListFailed, ja), ja.modelListFailed)
  assert.equal(errorText(raw, en.modelListFailed, en), en.modelListFailed)
  assert.equal(errorText(raw, undefined, zh), zh.errorFailed)
  // M3E's own messages are already in the page language.
  assert.equal(errorText(new LocalizedError(en.modelConnectFirst), en.modelListFailed, en), en.modelConnectFirst)
  // Host failures go through the shared translator.
  assert.equal(errorText(new RemoteCallError({ code: 'session/not-found', message: 'Session abc not found', details: {} }), ja.modelListFailed, ja), '会話が見つかりません。')
})
