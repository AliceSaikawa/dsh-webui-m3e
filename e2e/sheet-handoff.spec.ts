import { test, expect, visit, button } from './helpers'

test.use({ reducedMotion: 'no-preference' })

test('遅れて届くモデル一覧でもシートを選べて次の入力補助を開ける', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __m3eTestModelCatalogDelay?: number }).__m3eTestModelCatalogDelay = 120
  })
  await visit(page, '/new?ws=ws-m3e')
  await button(page, '入力の補助を開く').click()
  await page.getByRole('button', { name: /^モデル/ }).click()
  const modelSheet = page.locator('m3e-bottom-sheet[aria-label="モデルの選択"]')
  await expect(modelSheet).toHaveJSProperty('open', true)
  await expect(modelSheet).toBeVisible()
  // The old first-close callback fires after the new sheet opens in the regression.
  await page.waitForTimeout(350)
  await expect(modelSheet).toBeVisible()
  expect(await modelSheet.evaluate(element => element.matches(':popover-open'))).toBe(true)
  await page.getByRole('button', { name: 'ローカル（ollama）', exact: true }).click()
  await expect(modelSheet).toHaveCount(0)
  await button(page, '入力の補助を開く').click()
  await expect(page.getByRole('heading', { name: '入力の補助' })).toBeVisible()
})
