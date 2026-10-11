import { test, expect, visit } from './helpers'
import type { Locator } from '@playwright/test'

async function touchBounds(chip: Locator) {
  return chip.evaluate(node => {
    const target = node.shadowRoot?.querySelector('.touch')
    if (!target) throw new Error('chip touch target missing')
    const rect = target.getBoundingClientRect()
    const nav = node.closest('nav')!.getBoundingClientRect()
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      top: rect.top, bottom: rect.bottom, navTop: nav.top, navBottom: nav.bottom,
      navLeft: nav.left, navRight: nav.right }
  })
}

test('短い階層名 / と ~ も44px以上の幅を持ち、タッチ領域の上下が切れない', async ({ page }) => {
  await visit(page, '/workspaces/add')
  const nav = page.getByRole('navigation', { name: 'フォルダの階層' })
  for (const name of ['/', '~']) {
    const chip = nav.locator('m3e-assist-chip').filter({ hasText: new RegExp(`^${name}$`) })
    await expect(chip).toBeEnabled()
    const box = await touchBounds(chip)
    expect.soft(box.width, `${name} width`).toBeGreaterThanOrEqual(44)
    expect.soft(box.height, `${name} height`).toBeGreaterThanOrEqual(48)
    expect.soft(box.top, `${name} top`).toBeGreaterThanOrEqual(box.navTop)
    expect.soft(box.bottom, `${name} bottom`).toBeLessThanOrEqual(box.navBottom)
  }
  const root = nav.locator('m3e-assist-chip').filter({ hasText: /^\/$/ })
  const box = await touchBounds(root)
  await page.mouse.click((box.left + box.right) / 2, box.top + 2)
  await expect(page.locator('.home-current-path')).toHaveText('/')
})

test('狭い画面の長い階層は横へスクロールでき、端のチップ全体を押せる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await visit(page, '/workspaces/add')
  for (const name of ['dev', 'dsh-webui-m3e', 'docs']) {
    await page.locator('.home-folder-row').filter({ hasText: new RegExp(`^folder${name}chevron_right$`) }).click()
  }
  const nav = page.getByRole('navigation', { name: 'フォルダの階層' })
  await expect(page.locator('.home-current-path')).toHaveText('~/dev/dsh-webui-m3e/docs')
  expect(await nav.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
  const last = nav.locator('m3e-assist-chip').last()
  await last.scrollIntoViewIfNeeded()
  const box = await touchBounds(last)
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.left).toBeGreaterThanOrEqual(box.navLeft)
  expect(box.right).toBeLessThanOrEqual(box.navRight)
  expect(box.top).toBeGreaterThanOrEqual(box.navTop)
  expect(box.bottom).toBeLessThanOrEqual(box.navBottom)
  const parent = nav.locator('m3e-assist-chip').filter({ hasText: /^dsh-webui-m3e$/ })
  await parent.scrollIntoViewIfNeeded()
  const parentBox = await touchBounds(parent)
  await page.mouse.click(parentBox.right - 2, parentBox.top + 2)
  await expect(page.locator('.home-current-path')).toHaveText('~/dev/dsh-webui-m3e')
  const root = nav.locator('m3e-assist-chip').first()
  // Scroll to the start, retaining the intended inset from the screen-edge
  // back-swipe zone. scrollIntoView's nearest alignment can stop at x=0.
  await nav.evaluate(node => { node.scrollLeft = 0 })
  const rootBox = await touchBounds(root)
  await page.mouse.click(rootBox.left + 2, rootBox.bottom - 2)
  await expect(page.locator('.home-current-path')).toHaveText('/')
})
