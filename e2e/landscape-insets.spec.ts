import type { Locator } from '@playwright/test'
import { test, expect, visit, button } from './helpers'

// Chromium's CDP override exercises the actual env() CSS. Physical iOS
// notch/home-indicator behavior still needs device verification.
for (const area of [
  { name: 'portrait', width: 390, height: 844, left: 0, right: 0 },
  { name: 'landscape-zero', width: 568, height: 320, left: 0, right: 0 },
  { name: 'landscape-left', width: 740, height: 390, left: 44, right: 20 },
  { name: 'landscape-right', width: 740, height: 390, left: 20, right: 44 },
]) {
  test.describe(area.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: area.width, height: area.height })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: area.left, right: area.right } })
    })
    async function edges(node: Locator, gutter: number) {
      await expect(node.first()).toBeAttached()
      const bounds = await node.first().evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right } })
      expect(bounds.left).toBeCloseTo(Math.max(gutter, area.left), 0)
      expect(bounds.right).toBeCloseTo(area.width - Math.max(gutter, area.right), 0)
    }
    test('chat rows, tools and latest button stay inside the safe body', async ({ page }) => {
      await visit(page, '/s/chat-samples')
      await edges(page.locator('.chat-tool'), 16)
      // Stress the rendered text containers without changing application state.
      await page.locator('.chat-bubble').first().evaluate(el => { el.textContent = 'long_unbroken_text_'.repeat(120) })
      const bubble = await page.locator('.chat-bubble').first().boundingBox()
      expect(bubble!.x).toBeGreaterThanOrEqual(Math.max(16, area.left))
      expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(area.width - Math.max(16, area.right) + 1)
      await visit(page, '/s/chat-long')
      await page.locator('.chat-scroll').evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; el.dispatchEvent(new Event('scroll')) })
      await expect(button(page, '最新へ')).toBeVisible()
      const latest = await page.locator('.chat-latest').boundingBox()
      expect(latest!.x + latest!.width).toBeCloseTo(area.width - Math.max(16, area.right), 0)
      await button(page, '最新へ').click()
      await expect.poll(() => page.locator('.chat-scroll').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4)
    })
    test('trace rows and its independently padded footer remain usable', async ({ page }) => {
      await visit(page, '/s/trace-example/trace')
      await edges(page.locator('[data-trace-row]'), 16)
      await page.getByLabel('記録を検索').fill('要約')
      await expect(page.locator('[data-trace-row]')).toHaveCount(2)
      const footer = await page.locator('.trace-search').evaluate(el => ({ left: el.getBoundingClientRect().left, padding: getComputedStyle(el).paddingLeft }))
      expect(footer.left).toBe(0)
      expect(parseFloat(footer.padding)).toBe(Math.max(12, area.left))
    })
    test('home, drawer and directory picker use one safe-area gutter', async ({ page }) => {
      await visit(page)
      await edges(page.locator('.home-session-surface'), 12)
      await page.locator('m3e-icon-button[aria-label="ワークスペースを切り替え"]').click()
      const entry = page.locator('.home-workspace-entry').first()
      await expect(entry).toBeVisible()
      await expect.poll(async () => (await entry.boundingBox())!.x).toBeCloseTo(Math.max(12, area.left) + 12, 0)
      await visit(page, '/workspaces/add')
      await edges(page.locator('.home-folder-row'), 12)
      const firstCrumb = await page.locator('.home-crumbs m3e-assist-chip').first().boundingBox()
      expect(firstCrumb!.x).toBeCloseTo(Math.max(20, area.left), 0)
    })
    test('common settings body protects controls with zero-inset spacing preserved', async ({ page }) => {
      await visit(page, '/settings')
      const row = page.locator('.settings-content m3e-list-action').first()
      await expect(row).toBeVisible()
      const box = await row.boundingBox()
      expect(box!.x).toBeCloseTo(area.left + 16, 0)
      expect(box!.x + box!.width).toBeCloseTo(area.width - area.right - 16, 0)
      expect(await page.locator('body').evaluate(el => el.scrollWidth)).toBe(area.width)
    })
  })
}
