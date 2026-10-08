import { test, expect } from '@playwright/test'

for (const kind of ['download', 'incompatible'] as const) {
  test(`起動失敗（${kind}）から画面内の読み直す操作で同じURLを再起動できる`, async ({ page }) => {
    let attempts = 0
    await page.route('**/src/dsh/mock/index.ts*', async route => {
      attempts++
      if (attempts > 1) return route.continue()
      if (kind === 'download') return route.abort('failed')
      await route.fulfill({ contentType: 'application/javascript', body: 'export function createMockContext() { throw new Error("client-modules: no registered factory for connection") }' })
    })
    await page.goto('/m3e/?mock#/s/readme-review')
    const originalUrl = page.url()
    await expect(page.locator('#app')).toContainText(kind === 'download'
      ? '起動に失敗しました。ページを読み直してください。'
      : 'この DSH の版に M3E の画面が対応していない可能性があります。')
    await expect(page.getByRole('link', { name: '今の画面に戻す' })).toHaveAttribute('href', '/?ui=classic')
    const retry = page.getByRole('button', { name: '読み直す', exact: true })
    await expect(retry).toBeVisible()
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('メッセージ入力欄')).toBeVisible()
    expect(page.url()).toBe(originalUrl)
    expect(attempts).toBe(2)
    await expect(page.getByRole('button', { name: '読み直す', exact: true })).toHaveCount(0)
  })
}

test('Host以外の診断と標準画面リンクの非表示を保ち、再読み込みだけを行う', async ({ page }) => {
  let documents = 0
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++ })
  await page.goto('/m3e/')
  await expect(page.locator('#app')).toContainText('このページは DSH の Host が描いたページではありません。')
  await expect(page.getByRole('link', { name: '今の画面に戻す' })).toHaveCount(0)
  await page.getByRole('button', { name: '読み直す', exact: true }).click()
  await expect.poll(() => documents).toBe(2)
  await expect(page.locator('#app')).toContainText('このページは DSH の Host が描いたページではありません。')
  await expect(page.getByRole('link', { name: '今の画面に戻す' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/m3e\/$/)
})
