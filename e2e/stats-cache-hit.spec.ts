import { test, expect, visit, button, menu, shot } from './helpers'
import type { Page } from '@playwright/test'

// Same hook as malformed-data.spec.ts: the finished ?mock context, before main.tsx uses it.
async function expose(page: Page) {
  await page.addInitScript('globalThis.__m3eTestMockContextReady = ctx => { globalThis.__stats = ctx }')
}
const setUsage = (page: Page, usage: unknown) => page.evaluate(value => (window as any).__stats.mock.setProjection('approval-sheet', 'tokenUsage', value), usage)
const hit = (page: Page) => page.getByTestId('cache-hit')

async function openStats(page: Page) {
  await menu(page, '統計')
  await expect(page.getByRole('heading', { name: '統計', exact: true })).toBeVisible()
}

test('145 統計に会話全体のキャッシュヒット率を出し、コンテキストの使用率とトークンも読める', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet')
  await setUsage(page, { uncachedInputTokens: 11668, outputTokens: 812, cacheReadTokens: 15400, cacheWriteTokens: 2048 })
  await openStats(page)
  // 15400 / (11668 + 15400 + 2048) = 52.9% -> 53%
  await expect(hit(page)).toContainText('キャッシュヒット率')
  await expect(hit(page).locator('strong')).toHaveText('53%')
  await expect(hit(page).getByRole('progressbar', { name: 'キャッシュヒット率 53%' })).toHaveAttribute('value', '53')
  await expect(page.getByLabel('コンテキストの使用率 62%')).toBeVisible()
  await expect(page.getByText('入力 1.2 万 ・ 出力 812', { exact: true })).toBeVisible()
  await expect(page.getByText('読み込み 1.5 万 ・ 書き込み 2,048', { exact: true })).toBeVisible()
  await shot(page, '145-stats-cache-hit')
})

test('145 統計のキャッシュヒット率は値の更新に追従し、100% に届かない値は小数まで出す', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet')
  await openStats(page)
  await setUsage(page, { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 999, cacheWriteTokens: 0 })
  await expect(hit(page).locator('strong')).toHaveText('99.9%')
  await setUsage(page, { uncachedInputTokens: 0, outputTokens: 1, cacheReadTokens: 999, cacheWriteTokens: 0 })
  await expect(hit(page).locator('strong')).toHaveText('100%')
  await setUsage(page, { uncachedInputTokens: 100, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })
  await expect(hit(page).locator('strong')).toHaveText('0%')
})

test('145 入力がない・値が欠けているときはキャッシュヒット率を出さない', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet')
  await openStats(page)
  for (const usage of [
    { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    { uncachedInputTokens: 10, outputTokens: 1, cacheWriteTokens: 0 },
  ]) {
    await setUsage(page, usage)
    await expect(page.getByRole('heading', { name: '統計', exact: true })).toBeVisible()
    await expect(hit(page)).toHaveCount(0)
    await expect(page.getByText(/NaN|undefined/)).toHaveCount(0)
  }
  await expect(page.getByLabel('コンテキストの使用率 62%')).toBeVisible()
  await button(page, '閉じる').click()
})
