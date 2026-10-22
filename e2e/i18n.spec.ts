import type { Page } from '@playwright/test'
import { test, expect, visit, nav } from './helpers'
import type { MockContext } from '../web/src/dsh/mock/context.ts'
import { bootMessages } from '../web/src/app/messages.ts'

declare global { interface Window {
  __i18nProbe: { ctx: MockContext; describes: number }
} }

// Issue #78: the page follows DSH's locale.preference, then the browser
// language, and shows Japanese, English or Simplified Chinese. Everything else,
// Traditional Chinese included, is English.

const TABS = {
  ja: ['一覧', '検索', '対応待ち', '設定'],
  en: ['Sessions', 'Search', 'Inbox', 'Settings'],
  zh: ['会话', '搜索', '待处理', '设置'],
} as const

async function probe(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch()
    const body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const probe = globalThis.__i18nProbe = { ctx, describes: 0 };
      const describe = ctx.remote.settings.describe.bind(ctx.remote.settings);
      ctx.remote.settings.describe = (...args) => { probe.describes++; return describe(...args); };
      return ctx;`) })
  })
}

/** What the stock screen does when it saves or clears the language. */
const setPreference = (page: Page, preference: string | undefined) => page.evaluate(async preference => {
  const settings = window.__i18nProbe.ctx.remote.settings as {
    describe(): Promise<any>
    update(ns: string, patch: object, revision: number): Promise<any>
    mutate(ns: string, ops: object[], revision: number): Promise<any>
  }
  const row = (await settings.describe()).value.namespaces.find((item: { ns: string }) => item.ns === 'locale')
  const result = preference === undefined
    ? await settings.mutate('locale', [{ op: 'unset', path: ['preference'] }], row.revision)
    : await settings.update('locale', { preference }, row.revision)
  if (!result.ok) throw new Error(result.error.message)
}, preference)

async function expectPage(page: Page, lang: string, tabs: readonly string[]) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang)
  for (const tab of tabs) await expect(nav(page, tab)).toBeVisible()
}

test('DSH の locale.preference を起動時と変更の通知で読み、再読み込みなしで画面の言語を切り替える', async ({ page }) => {
  await probe(page)
  await visit(page, '/')
  await expectPage(page, 'ja', TABS.ja)
  await expect.poll(() => page.evaluate(() => window.__i18nProbe.describes)).toBe(1)
  const emitAndCount = (ns: string) => page.evaluate(async ns => {
    const probe = window.__i18nProbe
    const before = probe.describes
    await probe.ctx.mock.emit('settings/document-updated', ns, { additionalArgs: [99] })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return probe.describes - before
  }, ns)
  expect(await emitAndCount('shell')).toBe(0)
  expect(await emitAndCount('locale')).toBe(1)

  const url = page.url()
  await setPreference(page, 'en')
  await expectPage(page, 'en', TABS.en)
  await setPreference(page, 'zh')
  await expectPage(page, 'zh-CN', TABS.zh)
  // A language the stock screen does not ship (and M3E does) is still honoured.
  await setPreference(page, 'ja')
  await expectPage(page, 'ja', TABS.ja)
  // An explicit unsupported language is English, not the browser's Japanese.
  await setPreference(page, 'fr')
  await expectPage(page, 'en', TABS.en)
  // Clearing the preference returns to the browser language.
  await setPreference(page, undefined)
  await expectPage(page, 'ja', TABS.ja)
  expect(page.url()).toBe(url)
})

test('言語の設定はブラウザの言語より優先する（ブラウザが English でも設定が日本語なら日本語）', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await probe(page)
  await visit(page, '/')
  await expectPage(page, 'en', TABS.en)
  await setPreference(page, 'ja')
  await expectPage(page, 'ja', TABS.ja)
  await context.close()
})

for (const [locale, lang, tabs, boot] of [
  ['en-US', 'en', TABS.en, bootMessages.en!],
  ['zh-CN', 'zh-CN', TABS.zh, bootMessages.zh!],
  ['zh-SG', 'zh-CN', TABS.zh, bootMessages.zh!],
  // Traditional Chinese and unsupported languages are English.
  ['zh-TW', 'en', TABS.en, bootMessages.en!],
  ['fr-FR', 'en', TABS.en, bootMessages.en!],
] as const) {
  test.describe(`ブラウザの言語が ${locale}`, () => {
    test.use({ locale })

    test(`画面と lang がブラウザの言語に従う（${locale}）`, async ({ page }) => {
      expect(await page.evaluate(() => navigator.language)).toBe(locale)
      await visit(page, '/')
      await expectPage(page, lang, tabs)
    })

    test.describe('起動失敗', () => {
      // Without ?mock in development the page is not a Host page and logs why.
      test.use({ expectedErrors: [/no boot graph/] })

      test(`起動失敗の文言もブラウザの言語で出る（${locale}）`, async ({ page }) => {
        await page.goto('/m3e/')
        await expect(page.locator('#app')).toContainText(boot.notHost)
        await expect(page.getByRole('button', { name: boot.reload, exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', lang)
      })
    })
  })
}
