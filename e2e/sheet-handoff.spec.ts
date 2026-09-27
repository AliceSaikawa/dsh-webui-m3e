import { test, expect, visit, button } from './helpers'
import type { Page, Locator } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

const assist = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="入力の補助"]')
const model = (page: Page) => assist(page).locator('m3e-select[aria-label="モデル"]')
const effort = (page: Page) => assist(page).locator('m3e-select[aria-label="考える深さ"]')

async function choose(page: Page, select: Locator, label: string) {
  await select.click()
  await page.locator('m3e-option').filter({ hasText: label }).last().click()
}

test('既存会話のモデルを選び直しても補助シートを開き直せる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(model(page)).toBeVisible()
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await expect(effort(page)).toHaveCount(0)
  await expect(assist(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(assist(page)).toHaveCount(0)
  await expect(page.locator('[data-scroll-area]').first()).not.toHaveCSS('overflow', 'hidden')
  await expect(page.locator('[data-testid="composer"]')).not.toHaveAttribute('inert', '')
  await button(page, '入力の補助を開く').click()
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
})

test('考える深さをドロップダウンで変更する', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(effort(page)).toBeVisible()
  await choose(page, effort(page), '低')
  await expect(effort(page)).toHaveJSProperty('value', 'low')
  await expect(assist(page)).toHaveCount(1)
})

test('遅いモデル一覧を補助シート内で待ち、応答後に選べる', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __m3eTestModelCatalogDelay?: number }).__m3eTestModelCatalogDelay = 200
  })
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(assist(page)).toHaveCount(1)
  await expect(assist(page).getByText('モデル一覧を読み込み中…')).toBeVisible()
  await expect(model(page)).toBeDisabled()
  await expect(model(page)).toBeEnabled()
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await expect(assist(page)).toHaveCount(1)
})

test('読み込み中に補助シートを閉じて開き直しても一枚だけ残る', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __m3eTestModelCatalogDelay?: number }).__m3eTestModelCatalogDelay = 200
  })
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(assist(page).getByText('モデル一覧を読み込み中…')).toBeVisible()
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect.poll(() => assist(page).evaluate(element => element.matches(':popover-open'))).toBe(true)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await page.keyboard.press('Escape')
    await expect(assist(page), `${attempt + 1} 回目の Escape で閉じる`).toHaveCount(0)
    await button(page, '入力の補助を開く').click()
  }
  await expect(assist(page)).toHaveCount(1)
  await expect(model(page)).toBeEnabled()
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await page.keyboard.press('Escape')
  await expect(assist(page)).toHaveCount(0)
  await expect(page.locator('[data-scroll-area]').first()).not.toHaveCSS('overflow', 'hidden')
  await expect.poll(() => page.locator('[data-scroll-area]').first().evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
})

test('新しいセッションでもモデルを選べる', async ({ page }) => {
  await visit(page, '/new?ws=ws-m3e')
  await button(page, '入力の補助を開く').click()
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await page.keyboard.press('Escape')
  await button(page, '入力の補助を開く').click()
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
})

test('/model も同じドロップダウンを開く', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await page.getByLabel('メッセージ入力欄').fill('/model')
  await button(page, '送信').click()
  const sheet = page.locator('m3e-bottom-sheet[aria-label="モデルの選択"]')
  const select = sheet.locator('m3e-select[aria-label="モデル"]')
  await expect(select).toBeVisible()
  await choose(page, select, 'ローカル / ローカル（ollama）')
  await expect(sheet).toHaveCount(1)
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('')
})
