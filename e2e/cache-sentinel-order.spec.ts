import { test, expect, visit } from './helpers'
import type { Page, Route } from '@playwright/test'

// Issue #156: cache-sentinel status reads overlap (first load, the 30-second
// poll, coming back to the foreground, after /unlock). Only the newest read may
// change the banner; an older read that answers later is dropped.
type SentinelWindow = Window & { __m3eTestMockContextReady?: (ctx: any) => void }

/** The mock DSH lists /sentinel, so the composer reads the status; the test answers each read itself. */
async function prepare(page: Page): Promise<Route[]> {
  await page.addInitScript(() => {
    (window as SentinelWindow).__m3eTestMockContextReady = ctx => {
      const list = ctx.remote.commands.list.bind(ctx.remote.commands)
      ctx.mock.patch('remote.commands.list', async (sessionId: string) => {
        const result = await list(sessionId)
        return result.ok ? { ok: true, value: [...result.value, { name: 'sentinel', description: 'cache-sentinel の状態を表示します。' }] } : result
      })
    }
  })
  const reads: Route[] = []
  await page.route('**/api/cache-sentinel.status*', route => { reads.push(route) })
  return reads
}

const banner = (page: Page) => page.getByTestId('cache-sentinel-banner')
const status = (state: 'stale' | 'unlocked') => ({
  gate: true, state, idleMinutes: 75, unlockExpiresAt: state === 'unlocked' ? Date.now() + 10 * 60_000 : null, dryRun: false,
})
const STALE = 'キャッシュ切れ(最終応答から 75 分)。このまま送ると止められます。'
const UNLOCKED = /^次の送信を許可中\(キャッシュなしの料金になります\)。あと \d+ 分$/

/** Starts a second read the way coming back to the foreground does. */
async function readAgain(page: Page, reads: Route[]) {
  const before = reads.length
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => reads.length).toBe(before + 1)
}

test('156 先に始めた遅い取得は、あとの取得が出した「許可中」を「キャッシュ切れ」に戻さない', async ({ page }) => {
  const reads = await prepare(page)
  await visit(page, '/s/readme-review')
  await expect.poll(() => reads.length).toBe(1)
  await readAgain(page, reads)
  await reads[1]!.fulfill({ json: status('unlocked') })
  await expect(banner(page).locator('p')).toHaveText(UNLOCKED)
  await reads[0]!.fulfill({ json: status('stale') })
  // Give the late answer time to land; the banner must not change.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(banner(page).locator('p')).toHaveText(UNLOCKED)
  await expect(banner(page).getByRole('button')).toHaveCount(0)
})

test.describe('失敗する取得', () => {
  // The browser reports the failed read itself; the composer does not log it.
  test.use({ expectedErrors: [/Failed to load resource: the server responded with a status of 500/] })
  test('156 先に始めた取得があとから失敗しても、あとの取得が出した警告を消さない', async ({ page }) => {
    const reads = await prepare(page)
    await visit(page, '/s/readme-review')
    await expect.poll(() => reads.length).toBe(1)
    await readAgain(page, reads)
    await reads[1]!.fulfill({ json: status('stale') })
    await expect(banner(page).locator('p')).toHaveText(STALE)
    await reads[0]!.fulfill({ status: 500, body: 'unavailable' })
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    await expect(banner(page).locator('p')).toHaveText(STALE)
    await expect(banner(page).getByRole('button', { name: '次の 1 回を許可(/unlock)' })).toBeVisible()
  })
})
