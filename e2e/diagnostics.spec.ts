import { test, expect, button } from './helpers'
import type { Page } from '@playwright/test'

// The ?diag panel for checks on real phones (#98).
const panel = (page: Page) => page.locator('[data-m3e-diagnostics]')
const trigger = (page: Page) => page.getByLabel('会話を切り替え', { exact: true }).filter({ has: page.locator('.material-symbols-outlined') })

async function open(page: Page, query: string) {
  await page.goto(`/m3e/?mock${query}#/s/readme-review`)
  await expect(page.locator('h1').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

/** Whether the panel's centre is the topmost hit target once it accepts pointers. */
async function panelOnTop(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-m3e-diagnostics]')!
    const before = element.style.pointerEvents
    element.style.pointerEvents = 'auto'
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    element.style.pointerEvents = before
    return !!hit && element.contains(hit)
  })
}

test('98a ?diag がなければ計測の表示を出さない', async ({ page }) => {
  await open(page, '')
  await expect(panel(page)).toHaveCount(0)
})

test('98b ?diag で計測を表示し、覚えて次の起動でも出し、下の操作を妨げずシートより上に出す', async ({ page }) => {
  await open(page, '&diag')
  await expect(panel(page)).toBeVisible()
  const text = panel(page).locator('pre')
  await expect(text).toContainText('M3E 計測')
  await expect(text).toContainText('inner 390×844')
  await expect(text).toContainText('safe-area 0 0 0 0')
  await expect(text).toContainText(/描画 \d+ fps/)

  // Home screen launches open start_url without the query.
  await open(page, '')
  await expect(panel(page)).toBeVisible()

  // The panel covers the top bar but lets the tap through to the trigger.
  const box = (await panel(page).boundingBox())!
  const target = (await trigger(page).boundingBox())!
  expect(target.y).toBeLessThan(box.y + box.height)
  await trigger(page).click()
  await expect(page.locator('.conversation-picker')).toBeVisible()
  await expect(text).toContainText(/toggle m3e-bottom-sheet.* open/)
  await expect.poll(() => panelOnTop(page)).toBe(true)

  // Its buttons still work over a modal sheet and do not close the sheet.
  await button(page, '上下に移す').click()
  await expect.poll(async () => (await panel(page).boundingBox())!.y).toBeGreaterThan(box.y + box.height)
  await expect(page.locator('.conversation-picker')).toBeVisible()
  await expect(text).not.toContainText(/toggle m3e-bottom-sheet.* closed/)

  await page.keyboard.press('Escape')
  await expect(page.locator('.conversation-picker')).toHaveCount(0)
})

test('98c 計測を終えるボタンと ?diag=0 で止め、次の起動でも出さない', async ({ page }) => {
  await open(page, '&diag')
  await button(page, '計測を終える').click()
  await expect(panel(page)).toHaveCount(0)
  await open(page, '')
  await expect(panel(page)).toHaveCount(0)

  await open(page, '&diag=1')
  await expect(panel(page)).toBeVisible()
  await open(page, '&diag=0')
  await expect(panel(page)).toHaveCount(0)
  await open(page, '')
  await expect(panel(page)).toHaveCount(0)
})
