import { test, expect, visit, button, shot } from './helpers'
import type { Page, Locator } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

const assist = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="入力の補助"]')
const model = (page: Page) => assist(page).locator('m3e-select[aria-label="モデル"]')
const effort = (page: Page) => assist(page).locator('m3e-select[aria-label="考える深さ"]')

async function holdModelCatalog(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __m3eTestModelCatalogGate?: Promise<void>
      __m3eTestReleaseModelCatalog?: () => void
    }
    testWindow.__m3eTestModelCatalogGate = new Promise<void>(resolve => {
      testWindow.__m3eTestReleaseModelCatalog = resolve
    })
  })
}

async function releaseModelCatalog(page: Page) {
  await page.evaluate(() => {
    (window as Window & { __m3eTestReleaseModelCatalog?: () => void }).__m3eTestReleaseModelCatalog?.()
  })
}

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
  // The restored next selection is the historical, now unavailable model.
  await choose(page, model(page), 'DeepSeek / DeepSeek V4')
  await expect(effort(page)).toBeVisible()
  await choose(page, effort(page), '低')
  await expect(effort(page)).toHaveJSProperty('value', 'low')
  await expect(assist(page)).toHaveCount(1)
})

test('遅いモデル一覧を補助シート内で待ち、応答後に選べる', async ({ page }) => {
  await holdModelCatalog(page)
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(assist(page)).toHaveCount(1)
  await expect(assist(page).getByText('モデル一覧を読み込み中…')).toBeVisible()
  await expect(model(page)).toBeDisabled()
  await shot(page, '03-model-catalog-loading')
  await releaseModelCatalog(page)
  await expect(model(page)).toBeEnabled()
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await expect(assist(page)).toHaveCount(1)
  await shot(page, '03-model-catalog-ready')
})

test('読み込み中に補助シートを閉じて開き直しても一枚だけ残る', async ({ page }) => {
  await holdModelCatalog(page)
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await expect(assist(page).getByText('モデル一覧を読み込み中…')).toBeVisible()
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect.poll(() => assist(page).evaluate(element => element.matches(':popover-open'))).toBe(true)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    await page.keyboard.press('Escape')
    await expect(assist(page), `${attempt + 1} 回目の Escape で閉じる`).toHaveCount(0)
    await button(page, '入力の補助を開く').click()
    await expect(assist(page).getByText('モデル一覧を読み込み中…')).toBeVisible()
    await expect(model(page)).toBeDisabled()
  }
  await expect(assist(page)).toHaveCount(1)
  await shot(page, '03-model-catalog-reopened-loading')
  await releaseModelCatalog(page)
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

test('モデルの反映に失敗すると両方の値が戻り理由が出る', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await choose(page, model(page), 'DeepSeek / DeepSeek V4')
  await expect(model(page)).toHaveJSProperty('value', '8:deepseekdeepseek-v4')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  await page.evaluate(() => {
    (window as Window & { __m3eTestSelectModelFailure?: boolean }).__m3eTestSelectModelFailure = true
  })
  await choose(page, effort(page), '低')
  await expect(assist(page).getByRole('alert')).toContainText('選んだモデルを利用できません。モデルを選び直してください。')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(model(page)).toHaveJSProperty('value', '8:deepseekdeepseek-v4')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
})

test('反映中に開き直しても次の選択は送らず結果を表示する', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await button(page, '入力の補助を開く').click()
  await choose(page, model(page), 'DeepSeek / DeepSeek V4')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  await expect(model(page)).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(assist(page)).toHaveCount(0)
  await button(page, '入力の補助を開く').click()
  await page.evaluate(() => {
    (window as Window & { __m3eTestSelectModelDelay?: number }).__m3eTestSelectModelDelay = 1200
  })
  await choose(page, model(page), 'ローカル / ローカル（ollama）')
  await expect(assist(page).getByText('選択を反映中…')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(assist(page)).toHaveCount(0)
  await button(page, '入力の補助を開く').click()
  await expect(assist(page).getByText('選択を反映中…')).toBeVisible()
  await expect(model(page)).toBeDisabled()
  await expect(effort(page)).toBeDisabled()
  await expect(model(page)).toHaveJSProperty('value', '6:ollamalocal')
  await expect(model(page)).toBeEnabled()
  await expect(effort(page)).toHaveCount(0)
})

test('順番待ちシートから編集ダイアログへ切り替えても残る', async ({ page }) => {
  await visit(page, '/s/approval-sheet')
  await page.getByLabel('メッセージ入力欄').fill('順番待ちの確認')
  await button(page, '順番待ち').click()
  await button(page, '順番待ち 1 件').click()
  await button(page, '編集').click()
  const dialog = page.locator('m3e-dialog[aria-label="順番待ちのメッセージを編集"]')
  await expect(dialog).toBeVisible()
  await expect(page.locator('m3e-bottom-sheet[aria-label="順番待ちの編集"]')).toHaveCount(0)
  await expect(dialog).toBeVisible({ timeout: 3000 })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-scroll-area]').first()).not.toHaveCSS('overflow', 'hidden')
})
