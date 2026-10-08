import type { Locator } from '@playwright/test'
import { test, expect, visit, button } from './helpers'

async function fullHeight(sheet: Locator) {
  await expect(sheet).toBeVisible()
  await expect.poll(async () => sheet.evaluate(node => {
    const box = node.getBoundingClientRect()
    return Math.max(Math.abs(box.top), Math.abs(innerHeight - box.height))
  })).toBeLessThan(2)
  await expect(sheet).not.toHaveAttribute('inert', '')
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`#28 プランの確認は${viewport.width}x${viewport.height}で全高に開く`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await visit(page, '/s/05-auth-redesign', 'plan')
    const sheet = page.locator('m3e-bottom-sheet.full-sheet').filter({ has: page.locator('.interaction-sheet--plan') })
    await fullHeight(sheet)
    await expect(sheet.getByRole('button', { name: 'このプランで進める', exact: true })).toBeInViewport()
    const rotated = { width: viewport.height, height: viewport.width }
    await page.setViewportSize(rotated)
    await fullHeight(sheet)
  })

  test(`#28 画像の全画面表示は${viewport.width}x${viewport.height}で全高に開く`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await visit(page, '/s/chat-samples')
    await page.locator('.chat-tool').click()
    await button(page, '続きを表示').click()
    await page.getByRole('button', { name: '手順の画像.pngを全画面で表示', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '画像の表示', exact: true })
    await fullHeight(sheet)
    await expect(sheet.locator('.chat-image-full img')).toBeVisible()
    await page.setViewportSize({ width: viewport.height, height: viewport.width })
    await fullHeight(sheet)
    await button(page, '閉じる').click()
    await expect(sheet).toHaveCount(0)
  })
}

test('#28 カスタム提供元の全画面シートも全高を保つ', async ({ page }) => {
  await visit(page, '/settings/providers')
  await button(page, 'カスタムプロバイダーを追加').click()
  const sheet = page.locator('m3e-bottom-sheet.full-sheet').filter({ has: page.locator('.custom-provider-form') })
  await fullHeight(sheet)
  await page.setViewportSize({ width: 844, height: 390 })
  await fullHeight(sheet)
})

for (const motion of ['reduce', 'no-preference'] as const) {
  test.describe(`全画面シートの復元 (${motion})`, () => {
    test.use({ reducedMotion: motion })
    test('確認ダイアログと別の全画面シートを閉じると元のプランが全高で戻る', async ({ page }) => {
      await visit(page, '/s/05-auth-redesign', 'plan')
      const plan = page.locator('m3e-bottom-sheet.full-sheet').filter({ has: page.locator('.interaction-sheet--plan') })
      await fullHeight(plan)
      const original = await plan.elementHandle()
      // Exercise the real overlay stack without introducing a product-only trigger.
      await page.evaluate(async () => {
        const path = '/m3e/src/app/overlay/store.ts'
        const overlays = await import(path)
        overlays.openDialog('中断の確認', { label: '全画面の中断テスト' })
      })
      const dialog = page.locator('m3e-dialog[aria-label="全画面の中断テスト"]')
      await expect(dialog).toBeVisible()
      await expect(plan).toBeHidden()
      await page.evaluate(async () => {
        const path = '/m3e/src/app/overlay/store.ts'
        const overlays = await import(path)
        overlays.openFullSheet('入れ子の内容', { label: '入れ子の全画面テスト' })
      })
      const nested = page.getByRole('dialog', { name: '入れ子の全画面テスト', exact: true })
      await fullHeight(nested)
      await expect(dialog).toBeHidden()
      await page.setViewportSize({ width: 844, height: 390 })
      await fullHeight(nested)
      const closeTop = () => page.evaluate(async () => {
        const path = '/m3e/src/app/overlay/store.ts'
        const overlays = await import(path)
        overlays.getOverlays().at(-1).close()
      })
      await closeTop()
      await expect(nested).toHaveCount(0)
      await expect(dialog).toBeVisible()
      await closeTop()
      await expect(dialog).toHaveCount(0)
      await fullHeight(plan)
      expect(await plan.evaluate((node, previous) => node === previous, original)).toBe(true)
      await button(page, 'このプランで進める').click()
      await expect(plan).toHaveCount(0)
      await expect(page.locator('[data-scroll-area]').first()).not.toHaveCSS('overflow', 'hidden')
    })
  })
}
