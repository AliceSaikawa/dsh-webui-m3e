import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__permissionReview = ctx; return ctx;') })
  })
  await visit(page, '/s/readme-review')
  await expect(page.locator('.composer-permission-label')).toHaveText('ワークスペース書込')
}

test('FR1 権限の再取得中も移行前と同じ候補・説明・選択印を表示し、失敗とは扱わない', async ({ page }) => {
  await expose(page)
  const expected = await page.evaluate(async () => {
    const state = window as any, api = state.__permissionReview.remote.permissionPresets
    const catalog = await api.catalog()
    if (!catalog.ok) throw new Error('カタログの準備に失敗')
    const original = api.catalog.bind(api)
    api.catalog = () => new Promise(resolve => { state.__finishPermissionRead = async () => resolve(await original()) })
    return catalog.value.options.filter((option: any) => option.value !== 'custom')
      .map((option: any) => ({ name: option.name, description: option.description ?? '', selected: String(option.value === 'workspace-write') }))
  })
  await button(page, 'ワークスペース書込').click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishPermissionRead)).toBe('function')
  const sheet = page.locator('.composer-sheet').filter({ has: page.getByRole('heading', { name: '権限の選び直し' }) })
  // 413a857 の PermissionSheet は h2、候補の button、操作失敗時の alert だけ。
  await expect(sheet.locator(':scope > *')).toHaveCount(1 + expected.length)
  await expect(sheet.getByRole('status')).toHaveCount(0)
  await expect(sheet.getByRole('alert')).toHaveCount(0)
  await expect(sheet.locator('.composer-sheet-row')).toHaveCount(expected.length)
  for (const [index, option] of expected.entries()) {
    const row = sheet.locator('.composer-sheet-row').nth(index)
    await expect(row).toHaveAccessibleName(`${option.name}${option.description ? ` ${option.description}` : ''}`)
    await expect(row).toHaveAttribute('aria-pressed', option.selected)
    await expect(row.locator('small')).toHaveText(option.description)
    await expect(row).toBeEnabled()
  }
  const before = await sheet.innerHTML()
  await page.evaluate(() => (window as any).__finishPermissionRead())
  await expect.poll(() => sheet.innerHTML()).toBe(before)
})

test('FR1 権限の取得失敗は既存のエラー欄と日本語の案内へ渡す', async ({ page }) => {
  await expose(page)
  await page.evaluate(() => {
    (window as any).__permissionReview.remote.permissionPresets.catalog = async () => ({
      ok: false, error: { code: 'gateway/internal', message: 'injected catalog failure', details: {} },
    })
  })
  await button(page, 'ワークスペース書込').click()
  const sheet = page.locator('.composer-sheet')
  await expect(sheet.getByRole('alert')).toHaveText('サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。')
  await expect(sheet.getByRole('status')).toHaveCount(0)
  await expect(sheet.locator('.composer-sheet-row')).toHaveCount(0)
})

test('FR1 初回の権限取得中に押しても失敗表示を出さず、取得後に候補を開く', async ({ page }) => {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const original = ctx.remote.permissionPresets.catalog.bind(ctx.remote.permissionPresets);
      const pending = new Promise(resolve => { globalThis.__finishInitialPermission = resolve; });
      ctx.remote.permissionPresets.catalog = async () => { await pending; return original(); };
      return ctx;`) })
  })
  await visit(page, '/s/readme-review')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await button(page, '権限').click()
  await expect(page.locator('.composer-notice')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '権限の選び直し' })).toHaveCount(0)
  await page.evaluate(() => (window as any).__finishInitialPermission())
  await expect(page.getByRole('heading', { name: '権限の選び直し' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^フル アクセス/ })).toBeEnabled()
  await expect(page.locator('.composer-notice')).toHaveCount(0)
})
