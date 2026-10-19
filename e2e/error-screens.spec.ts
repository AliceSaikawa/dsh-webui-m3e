import { test, expect, visit } from './helpers'

// Issue #93: one shared error screen for render failures, unknown routes,
// conversation open errors and the offline boot failure.

test.describe('描画の失敗', () => {
  test.use({ expectedErrors: [/mock render error/] })

  test('93a 描画エラーは理由と読み直し・一覧に戻るを出す', async ({ page }) => {
    await page.goto('/m3e/?mock#/__mock/render-error')
    await expect(page.getByRole('heading', { name: '画面を表示できませんでした', level: 1 })).toBeVisible()
    await expect(page.getByRole('main').getByRole('heading', { name: '画面を表示できませんでした' })).toBeVisible()
    await expect(page.getByRole('button', { name: '読み直す', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '一覧に戻る', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '一覧に戻る', exact: true }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('ul[aria-label="セッション一覧"]')).toBeVisible()
  })
})

test('93b 存在しない画面は理由と一覧に戻るを出す', async ({ page }) => {
  await visit(page, '/__mock/not-found')
  await expect(page.getByRole('heading', { name: '画面が見つかりません' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '画面が見つかりません', level: 2 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('エラー')
  await expect(page.getByText('URL が古いか、間違っている可能性があります。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '一覧に戻る', exact: true }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('ul[aria-label="セッション一覧"]')).toBeVisible()
})

test.describe('会話を開けない', () => {
  test.use({ expectedErrors: [/会話を選択できませんでした: does-not-exist/] })

  test('93c 開けない会話は理由と戻る・もう一度開くを出す', async ({ page }) => {
    await visit(page, '/s/does-not-exist')
    await expect(page.getByRole('heading', { name: '会話を開けませんでした' })).toBeVisible()
    await expect(page.getByText('会話が見つかりません。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '戻る', exact: true }).last()).toBeVisible()
    await expect(page.getByRole('button', { name: 'もう一度開く', exact: true })).toBeVisible()
  })
})

test.describe('起動時のオフライン', () => {
  test.use({ expectedErrors: [/Failed to load resource: net::ERR_FAILED|Failed to fetch dynamically imported module/] })

  test('93d オフラインの起動失敗は接続を確かめる文と読み直しを出す', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
    let attempts = 0
    await page.route('**/src/dsh/mock/index.ts*', async route => {
      attempts++
      if (attempts > 1) return route.continue()
      return route.abort('failed')
    })
    await page.goto('/m3e/?mock#/')
    await expect(page.locator('#app')).toContainText('オフラインです')
    await expect(page.locator('#app')).toContainText('ネットワークにつながっていません。接続を確かめてから読み直してください。')
    await expect(page.getByRole('button', { name: '読み直す', exact: true })).toBeVisible()
  })
})
