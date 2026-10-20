import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

// Issue #142: a new-conversation draft chose a preset that the catalog then withdrew.
// A real Host answers `/permission <unknown>` with `matched: true` and keeps the old
// permission, so the draft must not send it.

/** Add a Host preset `team-review` that a test can withdraw and announce. */
async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__withdrawn = ctx;
      globalThis.__teamReview = true;
      const original = ctx.remote.permissionPresets.catalog.bind(ctx.remote.permissionPresets);
      ctx.remote.permissionPresets.catalog = async () => {
        const result = await original();
        if (!result.ok || !globalThis.__teamReview) return result;
        const extra = { value: 'team-review', name: 'チームの確認' };
        return { ok: true, value: { ...result.value, options: [...result.value.options, extra], defaultOptions: [...result.value.defaultOptions, extra] } };
      };
      return ctx;`) })
  })
}

const chip = (page: Page) => page.locator('.composer-permission')
const withdraw = (page: Page) => page.evaluate(async () => {
  (globalThis as any).__teamReview = false
  await (globalThis as any).__withdrawn.mock.emit('permission-presets/catalog-changed')
})
const permissionCommands = (page: Page, id: string) => page.evaluate(id => (globalThis as any).__withdrawn.mock.getRecords(id)
  .filter((record: any) => record.type === 'command/run' && record.data.name === 'permission').map((record: any) => record.data.args), id)
async function pick(page: Page, name: RegExp) {
  await chip(page).click()
  await page.getByRole('button', { name }).click()
}
async function sendAndGetId(page: Page, text: string) {
  await page.getByLabel('メッセージ入力欄').fill(text)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  return page.url().match(/#\/s\/([^/?]+)/)![1]!
}

test('142 下書きで選んだ権限が候補から消えたら、既定に戻して知らせ、/permission を送らない', async ({ page }) => {
  await expose(page)
  await visit(page, '/new?ws=ws-m3e')
  await pick(page, /^チームの確認/)
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：チームの確認')
  await withdraw(page)
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：ワークスペース書込')
  await expect(page.locator('m3e-snackbar')).toContainText('権限「チームの確認」は使えなくなったため、「ワークスペース書込」に戻しました。')
  const id = await sendAndGetId(page, '候補から消えた権限で送る')
  await expect(page.getByText('候補から消えた権限で送る').first()).toBeVisible()
  expect(await permissionCommands(page, id)).toEqual([])
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：ワークスペース書込')
})

test('142 候補に残っている選択は保ち、知らせず、送るときに適用する', async ({ page }) => {
  await expose(page)
  await visit(page, '/new?ws=ws-m3e')
  await pick(page, /^フル アクセス/)
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：フル アクセス')
  await withdraw(page)
  await page.waitForTimeout(500)
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：フル アクセス')
  await expect(page.locator('m3e-snackbar')).toHaveCount(0)
  const id = await sendAndGetId(page, 'フル アクセスで送る')
  expect(await permissionCommands(page, id)).toEqual(['danger-full-access'])
})
