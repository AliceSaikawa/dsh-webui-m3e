import { test, expect, visit, button, nav } from './helpers'

test('期限後の質問を既存の対応待ちの行で開き、全問に回答する', async ({ page }) => {
  await visit(page, '/s/05-db-choice', 'question-continued')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await button(page, 'あとで').click()
  await button(page, '戻る').last().click()
  await nav(page, '対応待ち').click()
  await page.getByText('DB の選び直し', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await page.getByText('PostgreSQL', { exact: true }).click()
  await button(page, '次へ').click()
  await page.getByText('データの移行', { exact: true }).click()
  await button(page, '回答する').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('DB の選び直し', { exact: true })).toHaveCount(0)
})
