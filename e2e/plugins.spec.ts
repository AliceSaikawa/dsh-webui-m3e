import { test, expect, visit, nav, action } from './helpers'

// Issue #96: the read-only plugin list. Made-up DSH data lives in
// web/src/features/plugins/mock.ts.

test('96 設定からプラグインの一覧を開き、読み込み失敗とバンドルの説明を出す', async ({ page }) => {
  await visit(page)
  await nav(page, '設定').click()
  await action(page, 'プラグイン').click()
  await expect(page.locator('h1')).toHaveText('プラグイン')

  await expect(page.getByRole('heading', { name: '読み込みに失敗したプラグイン' })).toBeVisible()
  await expect(page.getByText('壊れたプラグイン')).toBeVisible()
  await expect(page.getByText('失敗の理由は DSH から取得できません。標準の画面かログで確認してください。')).toBeVisible()
  await expect(page.getByText('コマンドや設定ファイルでの変更は、自動では反映されません。読み直してください。')).toBeVisible()

  await expect(page.getByRole('heading', { name: '稼働中' })).toBeVisible()
  await expect(page.getByText('メモ', { exact: true })).toBeVisible()
  await expect(page.getByText('@example/dsh-plugin-notes')).toBeVisible()

  // The metadata diagnostic is not printed, only carried in the title attribute.
  await expect(page.getByText('表示用の情報に問題があります')).toBeVisible()
  await expect(page.getByText('meta.title is not a string')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: 'バンドル' })).toBeVisible()
  await expect(page.getByText('デモバンドル')).toBeVisible()
  await expect(page.getByText('版 1.2.3')).toBeVisible()
  await expect(page.getByText('インストール済み').first()).toBeVisible()
  await expect(page.getByText('この DSH の版に対応していません')).toBeVisible()
  await expect(page.getByText('dsh-core@0.2.0 は dsh-core@^0.3.0 を必要とします')).toBeVisible()
})

test('96 読み直すボタンで一覧を取り直す', async ({ page }) => {
  await visit(page, '/settings/plugins')
  await expect(page.getByText('壊れたプラグイン')).toBeVisible()
  await page.locator('m3e-icon-button[aria-label="読み直す"]').click()
  await expect(page.getByText('壊れたプラグイン')).toBeVisible()
})

test('96 名前空間のない Host では取得できないと伝える', async ({ page }) => {
  await visit(page, '/settings/plugins', 'plugins-unavailable')
  await expect(page.locator('h1')).toHaveText('プラグイン')
  await expect(page.getByText('この Host ではプラグインの一覧を取得できません。')).toBeVisible()
})

test('96 読み込みに失敗したら説明と再試行を出す', async ({ page }) => {
  await visit(page, '/settings/plugins', 'plugins-error')
  await expect(page.getByRole('alert')).toContainText('サーバーでエラーが発生しました')
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible()
})

test('96 管理できない Host ではバンドルの節を出さない', async ({ page }) => {
  await visit(page, '/settings/plugins', 'plugins-unmanaged')
  await expect(page.locator('.plugins-list')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'バンドル' })).toHaveCount(0)
})
