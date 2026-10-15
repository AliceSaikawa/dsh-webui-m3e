import { test, expect, visit, nav } from './helpers'
import type { MockContext } from '../web/src/dsh/mock/context.ts'

declare global { interface Window {
  __i18nProbe: { ctx: MockContext; describes: number }
} }

// Issue #78 foundation: the page language machinery runs, but until the
// translations land every reader still gets today's Japanese page.

test('日本語の環境では lang="ja" のまま、DSH の locale.preference を起動時と変更の通知で読む', async ({ page }) => {
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
  await visit(page, '/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
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
  // Choosing English in DSH does not switch the page yet (no translations).
  const saved = await page.evaluate(async () => {
    const settings = window.__i18nProbe.ctx.remote.settings as { describe(): Promise<any>; update(ns: string, patch: object, revision: number): Promise<any> }
    const described = await settings.describe()
    const row = described.value.namespaces.find((item: { ns: string }) => item.ns === 'locale')
    return (await settings.update('locale', { preference: 'en' }, row.revision)).ok
  })
  expect(saved).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(nav(page, '設定')).toBeVisible()
})

for (const locale of ['en-US', 'zh-CN', 'zh-TW']) {
  test.describe(`ブラウザの言語が ${locale}`, () => {
    test.use({ locale })

    test(`訳が入るまでは画面も lang も日本語のまま（${locale}）`, async ({ page }) => {
      expect(await page.evaluate(() => navigator.language)).toBe(locale)
      await visit(page, '/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
      await expect(nav(page, '一覧')).toBeVisible()
      await expect(nav(page, '設定')).toBeVisible()
    })

    test.describe('起動失敗', () => {
      // Without ?mock in development the page is not a Host page and logs why.
      test.use({ expectedErrors: [/no boot graph/] })

      test(`起動失敗の文言（辞書に移した例）も日本語のまま（${locale}）`, async ({ page }) => {
        await page.goto('/m3e/')
        await expect(page.locator('#app')).toContainText('起動に失敗しました。このページは DSH の Host が描いたページではありません。')
        await expect(page.getByRole('button', { name: '読み直す', exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
      })
    })
  })
}
