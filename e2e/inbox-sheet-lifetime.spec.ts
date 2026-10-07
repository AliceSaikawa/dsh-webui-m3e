import { test, expect, visit, action, button } from './helpers'

for (const motion of ['reduce', 'no-preference'] as const) {
  test.describe(`対応待ちの画面離脱 (${motion})`, () => {
    test.use({ reducedMotion: motion })

    test('開いたまま離れても、同じ要求と別の要求を再び開いて回答できる', async ({ page }) => {
      await visit(page, '/inbox', 'inbox')
      const sheets = page.locator('.interaction-sheet')
      const leaveAndReturn = async () => {
        await page.evaluate(() => { window.location.hash = '/search' })
        await expect(page.locator('h1').first()).toHaveText('検索')
        await expect(sheets).toHaveCount(0)
        await page.evaluate(() => { window.location.hash = '/inbox' })
        await expect(page.locator('h1').first()).toHaveText('対応待ち')
      }

      await action(page, '対応待ちのテスト').click()
      await expect(sheets).toHaveCount(1)
      await expect(sheets.getByRole('heading', { name: 'ツールの承認' })).toBeVisible()
      await leaveAndReturn()
      await action(page, '対応待ちのテスト').click()
      await expect(sheets.getByRole('heading', { name: 'ツールの承認' })).toBeVisible()
      await leaveAndReturn()
      await action(page, '一覧の表示方法').click()
      await expect(sheets).toHaveCount(1)
      await sheets.locator('textarea').fill('この回答を保存します')
      await leaveAndReturn()
      await action(page, '一覧の表示方法').click()
      await expect(sheets.locator('textarea')).toHaveValue('この回答を保存します')
      await button(page, '回答する').click()
      await expect(sheets).toHaveCount(0)
      await expect(action(page, '一覧の表示方法')).toHaveCount(0)
      await action(page, '対応待ちのテスト').click()
      await button(page, '許可（1 回）').click()
      await expect(sheets).toHaveCount(0)
      await expect(action(page, '対応待ちのテスト')).toHaveCount(0)
      await action(page, 'スマートフォン画面の改善').click()
      await expect(sheets.getByRole('heading', { name: 'プランの確認' })).toBeVisible()
      await leaveAndReturn()
      await action(page, 'スマートフォン画面の改善').click()
      await button(page, '承認して開始').click()
      await expect(sheets).toHaveCount(0)
      await expect(action(page, 'スマートフォン画面の改善')).toHaveCount(0)
    })
  })
}
