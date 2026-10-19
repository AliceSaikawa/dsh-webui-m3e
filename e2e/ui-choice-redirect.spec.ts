import { test, expect } from './helpers'
import type { BrowserContext, Page } from '@playwright/test'
import { uiChoiceScript } from '../src/shared/ui-choice.ts'

// The stock index is DSH's own page, which the ?mock Vite server does not serve.
// Serve a stand-in whose head carries the very script the Host taps into every
// index, and run it in a real browser so `matchMedia` answers for the emulated
// input device. `/m3e/` is also a stand-in: only the destination matters here.
const STOCK = 'stock-ui'
const M3E = 'm3e-ui'

async function serveStockAndM3e(page: Page) {
  const html = (title: string, script = '') => ({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta charset="utf-8">${script}<title>${title}</title></head><body>${title}</body></html>`,
  })
  await page.route(url => url.pathname === '/', route => route.fulfill(html(STOCK, `<script>${uiChoiceScript()}</script>`)))
  await page.route(url => url.pathname === '/m3e/', route => route.fulfill(html(M3E)))
}

async function chooseM3e(context: BrowserContext) {
  await context.addCookies([{ name: 'dsh-webui', value: 'm3e', url: 'http://localhost:5191/' }])
}

test.describe('マウス環境（パソコン）', () => {
  test.use({ hasTouch: false, isMobile: false })

  test('M3E を選んだ端末でも / は標準の画面のままで、/m3e/ は直接開ける', async ({ page, context }) => {
    await serveStockAndM3e(page)
    await chooseM3e(context)
    await page.goto('/')
    await expect(page).toHaveTitle(STOCK)
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/')
    await page.goto('/m3e/')
    await expect(page).toHaveTitle(M3E)
  })

  test('?ui=m3e を付けると、パソコンでも / から /m3e/ へ移り、Cookie を残す', async ({ page, context }) => {
    await serveStockAndM3e(page)
    await page.goto('/?ui=m3e')
    await expect(page).toHaveTitle(M3E)
    expect(new URL(page.url()).pathname).toBe('/m3e/')
    expect((await context.cookies()).find(cookie => cookie.name === 'dsh-webui')?.value).toBe('m3e')
  })
})

test.describe('タッチ環境（スマートフォン）', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('M3E を選んだ端末では、/ から /m3e/ へ転送される', async ({ page, context }) => {
    await serveStockAndM3e(page)
    await chooseM3e(context)
    await page.goto('/')
    await expect(page).toHaveTitle(M3E)
    expect(new URL(page.url()).pathname).toBe('/m3e/')
  })

  test('Cookie が M3E でなければ、/ は標準の画面のまま', async ({ page }) => {
    await serveStockAndM3e(page)
    await page.goto('/')
    await expect(page).toHaveTitle(STOCK)
    expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true)
  })
})
