import { test, expect, visit } from './helpers'
import type { Page } from '@playwright/test'

// ws-m3e の偽データ（web/src/features/home/mock.ts と web/src/features/interactions/mock.ts）から導いた並び順です。
const MANUAL_TITLES = ['README の見直し', '承認シートの実装', 'スマートフォンの余白を調整', 'ワークスペースの確認', '一覧のメニューを検討', 'DB の選び直し', '認証の作り直し']
const UPDATED_TITLES = ['スマートフォンの余白を調整', 'ワークスペースの確認', '承認シートの実装', 'README の見直し', '認証の作り直し', 'DB の選び直し', '一覧のメニューを検討']

async function chooseOrder(page: Page, name: string) {
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await page.locator('m3e-menu-item').filter({ hasText: name }).click()
}

test('101a 並べ方を最近の更新順へ切り替え、端末ごとに保存して手動の順へ戻せる', async ({ page }) => {
  await visit(page)
  await expect(page.locator('.home-session-button strong')).toHaveText(MANUAL_TITLES)
  await expect(page.locator('.home-list-caption')).not.toContainText('最近の更新順')

  await chooseOrder(page, '最近の更新順')
  await expect(page.locator('.home-session-button strong')).toHaveText(UPDATED_TITLES)
  await expect(page.locator('.home-list-caption')).toContainText('最近の更新順')

  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await expect(page.locator('m3e-menu-item').filter({ hasText: '最近の更新順' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('m3e-menu-item').filter({ hasText: '手動の順' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('m3e-menu-item').filter({ hasText: '並べ替え' })).toHaveCount(0)

  await page.reload()
  await expect(page.locator('h1').first()).toBeVisible()
  await expect(page.locator('.home-session-button strong')).toHaveText(UPDATED_TITLES)
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await expect(page.locator('m3e-menu-item').filter({ hasText: '最近の更新順' })).toHaveAttribute('aria-checked', 'true')
  await page.locator('m3e-menu-item').filter({ hasText: '手動の順' }).click()

  await expect(page.locator('.home-session-button strong')).toHaveText(MANUAL_TITLES)
  await expect(page.locator('.home-list-caption')).not.toContainText('最近の更新順')
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await expect(page.locator('m3e-menu-item').filter({ hasText: '手動の順' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('m3e-menu-item').filter({ hasText: '並べ替え' })).toHaveCount(1)
})

test('101b 並べ替えの途中で別タブが並べ方を最近の更新順に変えると、並べ替えを抜けて更新順で表示する', async ({ page }) => {
  await visit(page)
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await page.locator('m3e-menu-item').filter({ hasText: '並べ替え' }).click()
  await expect(page.locator('h1').first()).toHaveText('並べ替え')
  await expect(page.locator('.home-session-button strong')).toHaveText(MANUAL_TITLES)

  const other = await page.context().newPage()
  await visit(other)
  await chooseOrder(other, '最近の更新順')
  await expect(other.locator('.home-session-button strong')).toHaveText(UPDATED_TITLES)

  await expect(page.locator('.home-session-button strong')).toHaveText(UPDATED_TITLES)
  await expect(page.locator('h1').first()).not.toHaveText('並べ替え')
  await expect(page.getByRole('button', { name: '完了' })).toHaveCount(0)
  await expect(page.locator('m3e-icon-button[aria-label="一覧のメニュー"]')).toBeVisible()
  await other.close()
})
