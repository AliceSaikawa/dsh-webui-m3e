import { test, expect, visit } from './helpers'
import type { Page } from '@playwright/test'

async function inset(page: Page, bottom: number) {
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom } })
}
async function show(page: Page) {
  await page.evaluate(async () => {
    const path = '/m3e/src/app/overlay/index.ts'
    const { showSnackbar } = await import(path)
    showSnackbar('位置確認の通知')
  })
  const snackbar = page.locator('m3e-snackbar:popover-open')
  await expect(snackbar).toBeVisible()
  await snackbar.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)) })
  return snackbar
}
async function clearance(page: Page, bottom: number, hasNavigation: boolean) {
  const snackbar = page.locator('m3e-snackbar:popover-open')
  const bounds = await snackbar.boundingBox()
  expect(bounds).not.toBeNull()
  const navigation = page.getByRole('navigation', { name: 'メインナビゲーション' })
  if (hasNavigation) {
    await expect(navigation).toBeVisible()
    const nav = await navigation.boundingBox()
    expect(nav).not.toBeNull()
    expect(Math.abs(nav!.y - (bounds!.y + bounds!.height) - 16)).toBeLessThanOrEqual(1)
  } else {
    await expect(navigation).toHaveCount(0)
    expect(Math.abs(page.viewportSize()!.height - (bounds!.y + bounds!.height) - bottom - 16)).toBeLessThanOrEqual(1)
  }
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
}

for (const route of ['/', '/search', '/inbox', '/settings', '/settings/models', '/s/readme-review']) {
  test(`通知は${route}のナビゲーションと34pxの下端領域を一度だけ避ける`, async ({ page }) => {
    await inset(page, 34)
    await visit(page, route)
    await show(page)
    await clearance(page, 34, ['/', '/search', '/inbox', '/settings'].includes(route))
  })
}

test('下端領域なしでも通知がナビゲーションの上に出る', async ({ page }) => {
  await visit(page)
  await show(page)
  await clearance(page, 0, true)
})

test('横向きへの変更とルート往復で表示中の通知位置が更新される', async ({ page }) => {
  await inset(page, 21)
  await visit(page)
  await show(page)
  await page.setViewportSize({ width: 568, height: 320 })
  await expect.poll(async () => {
    const snack = await page.locator('m3e-snackbar:popover-open').boundingBox()
    const nav = await page.locator('.bottom-navigation').boundingBox()
    return Math.abs(nav!.y - (snack!.y + snack!.height) - 16)
  }).toBeLessThanOrEqual(1)
  await clearance(page, 21, true)
  await page.evaluate(() => { location.hash = '#/settings/models' })
  await expect(page.locator('.bottom-navigation')).toHaveCount(0)
  await clearance(page, 21, false)
  await page.evaluate(() => { location.hash = '#/settings' })
  await expect(page.locator('.bottom-navigation')).toBeVisible()
  await clearance(page, 21, true)
})
