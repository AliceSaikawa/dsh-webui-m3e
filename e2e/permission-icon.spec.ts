import { test, expect, visit, shot } from './helpers'
import type { Page } from '@playwright/test'

/**
 * Expose the mock context, and give the catalog all four built-in presets plus
 * one the Host added (`team-review`), which the default mock does not have.
 */
async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__permissionIcon = ctx;
      const original = ctx.remote.permissionPresets.catalog.bind(ctx.remote.permissionPresets);
      const presetOptions = [
        { value: 'read-only', name: 'read-only' },
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
        { value: 'auto', name: 'auto' },
        { value: 'team-review', name: 'チームの確認' },
      ];
      ctx.remote.permissionPresets.catalog = async () => {
        const result = await original();
        return result.ok ? { ok: true, value: { ...result.value, options: presetOptions, defaultOptions: presetOptions } } : result;
      };
      return ctx;`) })
  })
}

const sheet = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="権限の選び直し"]')
const chip = (page: Page) => page.locator('.composer-permission')
const chipIcon = (page: Page) => chip(page).locator('.material-symbols-outlined')
const setPermission = (page: Page, currentValue: string) =>
  page.evaluate(value => (window as any).__permissionIcon.mock.setProjection('readme-review', 'permissions', { currentValue: value }), currentValue)

test('144 入力欄の権限のボタンは今の権限のアイコンを出し、権限が変わると再読み込みなしで変わる', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/readme-review')
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：ワークスペース書込')
  await expect(chipIcon(page)).toHaveText('edit_document')
  await shot(page, '144-permission-icon')

  // Re-picking in the sheet.
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  await sheet(page).locator('.composer-sheet-row', { hasText: 'フル アクセス' }).click()
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：フル アクセス')
  await expect(chipIcon(page)).toHaveText('warning')

  // A change that does not come from the sheet (/permission, another device).
  await setPermission(page, 'read-only')
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：読み取りのみ')
  await expect(chipIcon(page)).toHaveText('visibility')
  await setPermission(page, 'auto')
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：自動レビュー（実験的）')
  await expect(chipIcon(page)).toHaveText('gpp_maybe')
})

test('144 カスタム・Host が足したプリセットは盾のまま、名前の読み上げは変わらない', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/readme-review')
  await expect(chipIcon(page)).toHaveText('edit_document')
  await setPermission(page, 'team-review')
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：チームの確認')
  await expect(chip(page)).toHaveAttribute('title', '権限：チームの確認')
  await expect(chipIcon(page)).toHaveText('shield')
  await setPermission(page, 'something-not-offered')
  await expect(chip(page)).toHaveAttribute('aria-label', '権限：カスタム')
  await expect(chipIcon(page)).toHaveText('shield')
})

test('144 権限の選び直しのシートの行も、入力欄と同じアイコンを使う', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/readme-review')
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  const icons = await sheet(page).locator('.composer-sheet-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.composer-sheet-icon')?.textContent, label: row.getAttribute('aria-label') ?? row.textContent?.slice(0, 12) })))
  expect(icons.map(row => row.name)).toEqual(['visibility', 'edit_document', 'warning', 'gpp_maybe', 'shield'])
})

test('144 新しい会話の下書きで選んだ権限でも、入力欄のアイコンが変わる', async ({ page }) => {
  await expose(page)
  await visit(page, '/new?ws=ws-m3e')
  await expect(chip(page)).toBeVisible()
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  await sheet(page).locator('.composer-sheet-row', { hasText: '読み取りのみ' }).click()
  await expect(chipIcon(page)).toHaveText('visibility')
})
