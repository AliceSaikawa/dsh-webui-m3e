import { test, expect, visit, menu } from './helpers.ts'

import type { Page } from '@playwright/test'

async function sampleViewport(page: Page, toggle = false) {
  return await page.evaluate(async toggle => {
    const trigger = document.querySelector('m3e-menu-trigger')!.parentElement!
    const frames: { time: number; innerWidth: number; scrollWidth: number; offsetLeft: number; left: number; width: number }[] = []
    const start = performance.now()
    if (toggle) trigger.click()
    await new Promise<void>(resolve => {
      const sample = () => {
        const rect = document.querySelector('m3e-menu')!.getBoundingClientRect()
        frames.push({ time: performance.now() - start, innerWidth, scrollWidth: document.documentElement.scrollWidth, offsetLeft: visualViewport?.offsetLeft ?? 0, left: rect.left, width: rect.width })
        if (performance.now() - start < 1000) requestAnimationFrame(sample)
        else resolve()
      }
      requestAnimationFrame(sample)
    })
    return frames
  }, toggle)
}

for (const { mobile, width, height } of [
  { mobile: false, width: 390, height: 844 },
  { mobile: true, width: 375, height: 812 },
  { mobile: true, width: 390, height: 844 },
  { mobile: true, width: 844, height: 390 },
]) {
  test.describe(`${mobile ? 'mobile' : 'desktop'} menu ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, isMobile: mobile, reducedMotion: 'no-preference' })
    test('menu opening keeps the viewport stable', async ({ page }, info) => {
      await visit(page, '/s/approval-sheet')
      for (let attempt = 0; attempt < 6; attempt++) {
        const samples = await sampleViewport(page, true)
        await info.attach(`viewport-frames-${attempt}`, { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
        expect(Math.max(...samples.map(frame => frame.innerWidth))).toBe(width)
        expect(Math.max(...samples.map(frame => frame.scrollWidth))).toBe(width)
        expect(Math.max(...samples.map(frame => Math.abs(frame.offsetLeft)))).toBe(0)
        if (attempt % 2 === 0) await expect(page.locator('.st-menu')).toBeVisible()
        else await expect(page.locator('.st-menu')).not.toBeVisible()
        expect(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offset: visualViewport?.offsetLeft }))).toEqual({ width, scroll: width, offset: 0 })
      }
    })
    test('every menu action remains reachable', async ({ page }) => {
      for (const label of ['題名を変える', '統計', 'ファイル', 'ジョブ', 'サブエージェント', 'ゴール']) {
        await page.goto('about:blank')
        await visit(page, '/s/approval-sheet')
        await menu(page, label)
        await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
      }
      await visit(page, '/s/readme-review')
      await menu(page, 'アーカイブ')
      await expect(page).toHaveURL(/#\/$/)
    })
    test('an open menu stays in the viewport when its size changes', async ({ page }, info) => {
      await visit(page, '/s/approval-sheet')
      await page.locator('m3e-icon-button').filter({ has: page.locator('m3e-menu-trigger') }).click()
      for (const viewport of [{ width: 844, height: 390 }, { width: 375, height: 812 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport)
        const samples = await sampleViewport(page)
        await info.attach(`resize-${viewport.width}`, { body: JSON.stringify(samples), contentType: 'application/json' })
        expect(Math.max(...samples.map(frame => frame.innerWidth))).toBe(viewport.width)
        expect(Math.max(...samples.map(frame => frame.scrollWidth))).toBe(viewport.width)
        expect(Math.max(...samples.map(frame => Math.abs(frame.offsetLeft)))).toBe(0)
        const bounds = await page.locator('.st-menu').boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      }
      await page.locator('m3e-menu-item').filter({ hasText: 'ファイル' }).click()
      await expect(page.getByRole('heading', { name: 'ファイル', exact: true })).toBeVisible()
    })
    test('keyboard focus enters and leaves the visible menu', async ({ page }) => {
      await visit(page, '/s/approval-sheet')
      const trigger = page.locator('m3e-icon-button').filter({ has: page.locator('m3e-menu-trigger') })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.st-menu')).toBeVisible()
      await expect(page.locator('.st-menu m3e-menu-item').first()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.locator('.st-menu')).not.toBeVisible()
      await expect(trigger).toBeFocused()
    })
  })
}
