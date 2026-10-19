import { test, expect, visit } from './helpers'
import type { Locator, Page } from '@playwright/test'

async function longPress(page: Page, target: Locator) {
  const bounds = await target.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.mouse.up()
}

async function rowNames(page: Page): Promise<(string | null)[]> {
  return page.locator('.home-session-button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
}

test('99a 一覧の行をピン留めして先頭へ移し、外すと元に戻る', async ({ page }) => {
  await visit(page)
  const buttons = page.locator('.home-session-button')
  const order = await rowNames(page)
  expect(order.length).toBeGreaterThan(1)
  const last = buttons.last()
  const title = (await last.locator('strong').textContent())!.trim()
  await longPress(page, last)
  await page.getByRole('button', { name: 'ピン留め', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ピン留めしました')

  const pinned = page.locator('.home-session[data-pinned="true"]')
  await expect(pinned).toHaveCount(1)
  await expect(pinned.locator('.home-row-pin')).toBeVisible()
  const first = buttons.first()
  await expect(first).toContainText(title)
  await expect(first).toHaveAccessibleName(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}、ピン留め`))

  await longPress(page, first)
  await page.getByRole('button', { name: 'ピン留めを外す', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ピン留めを外しました')
  await expect(page.locator('.home-session[data-pinned="true"]')).toHaveCount(0)
  expect(await rowNames(page)).toEqual(order)
})

test('99b 並べ替えではピン留めした行にドラッグのつまみを出さない', async ({ page }) => {
  await visit(page)
  await longPress(page, page.locator('.home-session-button').last())
  await page.getByRole('button', { name: 'ピン留め', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ピン留めしました')

  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await page.locator('m3e-menu-item').filter({ hasText: '並べ替え' }).click()
  await expect(page.locator('.home-list-caption')).toContainText('ピン留めした行は固定した順に並びます')
  await expect(page.locator('.home-session[data-pinned="true"]')).toHaveCount(1)
  await expect(page.locator('.home-session[data-pinned="true"] .home-drag-handle')).toHaveCount(0)
  expect(await page.locator('.home-session:not([data-pinned="true"]) .home-drag-handle').count()).toBeGreaterThan(0)
})
