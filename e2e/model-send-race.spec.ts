import { test, expect, visit, button, shot } from './helpers'
import type { Page } from '@playwright/test'

async function holdSelection(page: Page) {
  await page.evaluate(() => {
    const target = window as Window & { __m3eTestSelectModelGate?: Promise<void>; releaseModel?: () => void }
    target.__m3eTestSelectModelGate = new Promise(resolve => { target.releaseModel = resolve })
  })
}
async function releaseSelection(page: Page) {
  await page.evaluate(() => (window as Window & { releaseModel?: () => void }).releaseModel?.())
}
async function selectLocal(page: Page, command = false) {
  if (command) {
    await page.getByLabel('メッセージ入力欄').fill('/model')
    await button(page, '送信').click()
  } else await button(page, '入力の補助を開く').click()
  const sheet = page.locator(`m3e-bottom-sheet[aria-label="${command ? 'モデルの選択' : '入力の補助'}"]`)
  await sheet.locator('m3e-select[aria-label="モデル"]').click()
  await page.locator('m3e-option').filter({ hasText: 'ローカル / ローカル（ollama）' }).last().click()
  await expect(sheet.getByText('選択を反映中…')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
}

test('モデル変更中はシートを閉じ再表示しても送信できず、完了後に解除する', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await page.getByLabel('メッセージ入力欄').fill('モデル変更後のメッセージ')
  await holdSelection(page)
  await selectLocal(page)
  await expect(button(page, '送信')).toBeDisabled()
  await page.evaluate(() => { location.hash = '#/settings' })
  await expect(page.getByLabel('メッセージ入力欄')).toHaveCount(0)
  await page.evaluate(() => { location.hash = '#/s/readme-review' })
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('モデル変更後のメッセージ')
  await expect(button(page, '送信')).toBeDisabled()
  await shot(page, '41-model-pending-remounted')
  await releaseSelection(page)
  await expect(button(page, '送信')).toBeEnabled()
  await button(page, '入力の補助を開く').click()
  await expect(page.locator('m3e-select[aria-label="モデル"]')).toHaveJSProperty('value', '6:ollamalocal')
})

for (const text of ['後から書いた本文', '/model']) {
  test(`/model の応答は編集し直した本文「${text}」を消さない`, async ({ page }) => {
    await visit(page, '/s/readme-review')
    await holdSelection(page)
    await selectLocal(page, true)
    await page.getByLabel('メッセージ入力欄').fill('編集中')
    await page.getByLabel('メッセージ入力欄').fill(text)
    await releaseSelection(page)
    await button(page, '入力の補助を開く').click()
    await expect(page.locator('m3e-select[aria-label="モデル"]')).toBeEnabled()
    await expect(page.locator('m3e-select[aria-label="モデル"]')).toHaveJSProperty('value', '6:ollamalocal')
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('メッセージ入力欄')).toHaveValue(text)
  })
}

test('変更失敗は送信を解除し、別会話の送信を妨げない', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await page.getByLabel('メッセージ入力欄').fill('失敗後も残る本文')
  await holdSelection(page)
  await selectLocal(page)
  await page.evaluate(() => { location.hash = '#/s/approval-sheet' })
  await page.getByLabel('メッセージ入力欄').fill('別の会話')
  await expect(button(page, '順番待ち')).toBeEnabled()
  await page.evaluate(() => { location.hash = '#/s/readme-review'; (window as Window & { __m3eTestSelectModelFailure?: boolean }).__m3eTestSelectModelFailure = true })
  await expect(button(page, '送信')).toBeDisabled()
  await releaseSelection(page)
  await expect(button(page, '送信')).toBeEnabled()
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('失敗後も残る本文')
})

test('送信済みの新規下書きへ戻っても以前の選択で既定モデル表示を上書きしない', async ({ page }) => {
  await visit(page, '/new?ws=ws-m3e')
  await button(page, '入力の補助を開く').click()
  await page.locator('m3e-select[aria-label="モデル"]').click()
  await page.locator('m3e-option').filter({ hasText: 'ローカル / ローカル（ollama）' }).last().click()
  await expect(page.locator('m3e-select[aria-label="モデル"]')).toHaveJSProperty('value', '6:ollamalocal')
  await page.keyboard.press('Escape')
  await page.getByLabel('メッセージ入力欄').fill('会話を作成')
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\//)
  // Selecting a session model also saves the Host default. Establish a newer
  // authoritative default before checking that the old controller cannot win.
  await page.evaluate(() => { location.hash = '#/settings/models' })
  await page.locator('m3e-select[aria-label="モデル"]').click()
  await page.locator('m3e-option').filter({ hasText: 'DeepSeek / DeepSeek V4' }).last().click()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  await page.evaluate(() => { location.hash = '#/new?ws=ws-m3e' })
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('')
  // Let the new Composer's catalog prefetch settle before opening its sheet.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await button(page, '入力の補助を開く').click()
  await expect(page.locator('m3e-select[aria-label="モデル"]')).toBeEnabled()
  await expect(page.locator('m3e-select[aria-label="モデル"]')).toHaveJSProperty('value', '8:deepseekdeepseek-v4')
})
