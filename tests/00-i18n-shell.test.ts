import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { bootMessages, errorMessages, markdownMessages, overlayMessages, shellMessages } from '../web/src/app/messages.ts'
import { interactionErrorMessages, navigationErrorMessages, permissionPresetMessages, remoteErrorMessages, serviceErrorMessages } from '../web/src/dsh/messages.ts'
import { conversationMessages } from '../web/src/features/conversation/messages.ts'
import { conversationChoices } from '../web/src/features/conversation/conversation-choices.ts'

test('every shell catalog has English and Chinese', () => {
  for (const catalog of [bootMessages, errorMessages, shellMessages, overlayMessages, markdownMessages,
    remoteErrorMessages, permissionPresetMessages, navigationErrorMessages, interactionErrorMessages,
    serviceErrorMessages, conversationMessages]) {
    assert.deepEqual(untranslatedLocales(catalog), [])
  }
})

test('shell texts come from the page language', () => {
  const en = messagesOf(shellMessages, 'en')
  const zh = messagesOf(shellMessages, 'zh')
  assert.equal(en.homeTab, 'Sessions')
  assert.equal(zh.homeTab, '会话')
  assert.equal(en.inboxTabWithCount(1), 'Inbox, 1 pending item')
  assert.equal(en.inboxTabWithCount(3), 'Inbox, 3 pending items')
  assert.equal(en.staleMinutes(1), 'Showing data from 1 minute ago')
  assert.equal(zh.staleMinutes(5), '正在显示 5 分钟前的数据')
  assert.equal(messagesOf(bootMessages, 'en').classic, 'Return to the standard screen')
  assert.equal(messagesOf(bootMessages, 'zh').classic, '返回标准界面')
  assert.equal(messagesOf(bootMessages, 'zh').incompatible('1.2.3'), '启动失败。此版本的 DSH 可能不支持 M3E 页面。M3E 页面已在 DSH 1.2.3 上验证。')
})

test('error and markdown texts come from the page language', () => {
  const en = messagesOf(errorMessages, 'en')
  assert.equal(en.offlineTitle, 'You are offline')
  assert.equal(en.home, 'Back to sessions')
  assert.equal(messagesOf(errorMessages, 'zh').retryOpen, '重新打开')
  assert.equal(messagesOf(markdownMessages, 'en').imageNamed('diagram'), 'Image: diagram')
  assert.equal(messagesOf(markdownMessages, 'zh').imageNamed('diagram'), '图片：diagram')
  assert.equal(messagesOf(overlayMessages, 'zh').saveFailed, '无法保存，请重试。')
})

test('host failures and permission presets come from the page language', () => {
  const en = messagesOf(remoteErrorMessages, 'en')
  assert.equal(en.sessionModelUnavailable, 'The selected model is unavailable. Choose a different model.')
  assert.equal(messagesOf(remoteErrorMessages, 'zh').writerHeld, '此对话正被其他操作占用，请等待操作结束后重试。')
  assert.equal(messagesOf(permissionPresetMessages, 'en').dangerFullAccess, 'Full access')
  assert.equal(messagesOf(permissionPresetMessages, 'zh').readOnly, '仅可查看')
  assert.equal(messagesOf(navigationErrorMessages, 'en').sessionMissing, 'The conversation was not found.')
  assert.equal(messagesOf(interactionErrorMessages, 'zh').requestFinished, '此请求已结束，无法再回答。')
  assert.equal(messagesOf(serviceErrorMessages, 'en').connectionMissing, 'No DSH connection is configured.')
})

test('the conversation screen and picker come from the page language', () => {
  const en = messagesOf(conversationMessages, 'en')
  const zh = messagesOf(conversationMessages, 'zh')
  assert.equal(en.traceTab, 'Trajectory')
  assert.equal(zh.chatTab, '对话')
  assert.equal(en.limitNotice(80, 50), 'Showing the first 50 of 80 conversations. Search by conversation name to narrow the list.')
  assert.equal(zh.limitNotice(80, 50), '共 80 个对话，正在显示前 50 个。可按对话名筛选。')
  assert.equal(en.rowDescription('Repo', true, true, false), 'Repo · Child conversation · Running')
  assert.equal(zh.rowDescription('仓库', false, false, true), '仓库 · 当前对话')
})

test('conversation choices label an unknown workspace in the chosen language', () => {
  const row = { id: 's1', displayTitle: 'A', running: false, blank: false, updatedAt: 0 }
  const list = { ids: ['s1'], byId: { s1: row } } as never
  const workspaces = { items: [], archivedSessionIds: [] } as never
  const title = (locale: 'ja' | 'en' | 'zh') => conversationChoices(list, workspaces, 's1', '', messagesOf(conversationMessages, locale)).items[0]!.workspaceTitle
  assert.equal(title('ja'), 'ワークスペース未登録')
  assert.equal(title('en'), 'Unregistered workspace')
  assert.equal(title('zh'), '未登记工作区')
})
