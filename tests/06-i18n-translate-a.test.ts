import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ISessions } from '../web/src/dsh/services.ts'
import type { PendingInteraction } from '../web/src/dsh/interactions-store.ts'
import { catalogProblems, messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { inboxMessages } from '../web/src/features/inbox/messages.ts'
import { describePending, relativeTime } from '../web/src/features/inbox/model.ts'
import { searchMessages } from '../web/src/features/search/messages.ts'
import { createSearchController, searchControllerFor } from '../web/src/features/search/search-controller.ts'
import { interactionMessages } from '../web/src/features/interactions/messages.ts'
import { questionPresentation } from '../web/src/features/interactions/presentation.ts'
import { pluginMessages } from '../web/src/features/plugins/messages.ts'
import { bundleErrorLabel, phaseLabel } from '../web/src/features/plugins/model.ts'

const catalogs = {
  inboxMessages,
  searchMessages,
  interactionMessages,
  pluginMessages,
} as const

/** A rejection without a Host code reaches the controller's own fallback text. */
const failure = new Error('Unexpected failure')

test('every catalog of this job has English and Chinese with the Japanese keys', () => {
  for (const [name, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(untranslatedLocales(catalog), [], `${name} still has an untranslated language`)
    assert.deepEqual(catalogProblems(catalog), [], `${name} has a key or kind mismatch`)
  }
  assert.equal(Object.keys(catalogs.inboxMessages.en!).length, 35)
  assert.equal(Object.keys(catalogs.pluginMessages.zh!).length, 40)
})

test('対応待ちの説明と相対時刻は渡した言語で組み立てる', () => {
  const approval = { kind: 'approval', toolName: 'read_file' } as unknown as PendingInteraction
  assert.equal(describePending(approval, messagesOf(inboxMessages, 'en')).description, 'Tool approval: about to run read_file')
  assert.equal(describePending(approval, messagesOf(inboxMessages, 'zh')).description, '工具审批：即将运行 read_file')
  assert.equal(relativeTime(1000, 1000, messagesOf(inboxMessages, 'en')), 'Just now')
  assert.equal(relativeTime(1000, 1000 + 60_000, messagesOf(inboxMessages, 'zh')), '1 分钟前')
  assert.equal(relativeTime(1000, 1000 + 3_600_000, messagesOf(inboxMessages, 'en')), '1 hour ago')
  assert.equal(relativeTime(1000, 1000 + 172_800_000, messagesOf(inboxMessages, 'en')), '2 days ago')
})

test('質問シートの進捗は渡した言語で組み立てる', () => {
  const items = [{ id: '1', question: '続けますか', options: [{ label: 'はい' }] }]
  assert.equal(questionPresentation(items, 0, messagesOf(interactionMessages, 'en')).progress, 'Question 1 / 1')
  assert.equal(questionPresentation(items, 0, messagesOf(interactionMessages, 'zh')).progress, '问题 1 / 1')
  assert.equal(messagesOf(interactionMessages, 'en').allowOnce, 'Allow once')
  assert.equal(messagesOf(interactionMessages, 'zh').allowOnce, '允许（一次）')
})

test('プラグインの状態と失敗コードは渡した言語の語を返す', () => {
  assert.equal(phaseLabel('unloading', true, messagesOf(pluginMessages, 'en')), 'Stopping')
  assert.equal(phaseLabel('failed', true, messagesOf(pluginMessages, 'zh')), '加载失败')
  assert.equal(bundleErrorLabel('not-bundle', messagesOf(pluginMessages, 'en')), 'This package does not declare a bundle')
  assert.equal(bundleErrorLabel('stale-approval', messagesOf(pluginMessages, 'zh')), '审批信息已过期')
})

test('プラグインの失敗の文は日本語の意味と用語表の語で訳す', () => {
  const en = messagesOf(pluginMessages, 'en')
  const zh = messagesOf(pluginMessages, 'zh')
  assert.equal(en.errorAmbiguousInstall, 'Could not determine where to install')
  assert.equal(zh.errorAmbiguousInstall, '无法确定安装位置')
  // DSH's Chinese keeps "profile" in Latin letters; 配置 means configuration.
  assert.equal(zh.errorStopProfile, 'profile 已停止时无法操作')
  // 承認 is approval／审批 (docs/i18n/terms/inbox-search-interactions-plugins.md).
  assert.equal(en.errorStaleApproval, 'The approval information is out of date')
  assert.equal(zh.errorStaleApproval, '审批信息已过期')
})

test('検索の失敗文は作成後に渡した言語へ切り替わる', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: { query: string; resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = []
  const sessions = {
    search(query: string) {
      return new Promise((resolve, reject) => { calls.push({ query, resolve, reject }) })
    },
  } as unknown as Pick<ISessions, 'search'>

  const controller = createSearchController(sessions, messagesOf(searchMessages, 'ja'))
  controller.setText(messagesOf(searchMessages, 'en'))
  controller.setInput('承認')
  t.mock.timers.tick(300)
  calls[0]!.reject(failure)
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'error')
  assert.equal(controller.getSnapshot().error, 'Could not get results from the search service. Wait a moment and try again.')

  controller.setText(messagesOf(searchMessages, 'zh'))
  controller.retry()
  t.mock.timers.tick(300)
  calls[1]!.reject(failure)
  await Promise.resolve()
  assert.equal(controller.getSnapshot().error, '无法从搜索服务获取结果。请稍后重试。')
})

test('エラーを表示している間に言語を切り替えると、表示中の文も新しい言語になる', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: { reject: (reason: unknown) => void }[] = []
  const sessions = {
    search() {
      return new Promise((_resolve, reject) => { calls.push({ reject }) })
    },
  } as unknown as Pick<ISessions, 'search'>

  const controller = createSearchController(sessions, messagesOf(searchMessages, 'ja'))
  controller.setInput('承認')
  t.mock.timers.tick(300)
  calls[0]!.reject(failure)
  await Promise.resolve()
  assert.equal(controller.getSnapshot().error, messagesOf(searchMessages, 'ja').serviceFailed)
  controller.setText(messagesOf(searchMessages, 'en'))
  assert.equal(controller.getSnapshot().error, 'Could not get results from the search service. Wait a moment and try again.')
  assert.equal(controller.getSnapshot().retryable, true)

  // An input error is worded again too.
  controller.setInput('語'.repeat(501))
  assert.equal(controller.getSnapshot().error, messagesOf(searchMessages, 'en').queryTooLong)
  controller.setText(messagesOf(searchMessages, 'zh'))
  assert.equal(controller.getSnapshot().error, messagesOf(searchMessages, 'zh').queryTooLong)
  assert.equal(controller.getSnapshot().retryable, false)
})

test('キャッシュした検索コントローラは画面が渡す最新の言語を使う', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: { reject: (reason: unknown) => void }[] = []
  const sessions = {
    search() {
      return new Promise((_resolve, reject) => { calls.push({ reject }) })
    },
  } as unknown as ISessions

  const ja = messagesOf(searchMessages, 'ja')
  const first = searchControllerFor(sessions, ja)
  first.setInput('承認')
  t.mock.timers.tick(300)

  // A language change re-renders the screen with the new texts but keeps the controller.
  const zh = searchControllerFor(sessions, messagesOf(searchMessages, 'zh'))
  assert.equal(zh, first)
  calls[0]!.reject(failure)
  await Promise.resolve()
  assert.equal(first.getSnapshot().error, '无法从搜索服务获取结果。请稍后重试。')

  first.setInput('語'.repeat(501))
  assert.match(first.getSnapshot().error!, /500 个字符以内/)
})
