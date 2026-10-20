import { test, expect, visit, button, nav } from './helpers'

// Issue #78: the shared shell, overlay and error texts moved into dictionaries
// (web/src/app/messages.ts, web/src/dsh/messages.ts). Japanese must not change.

test('78a 下のナビゲーションの名前・タブの文言・受信箱の件数つきの名前', async ({ page }) => {
  await visit(page)
  const navigation = page.getByRole('navigation', { name: 'メインナビゲーション' })
  await expect(navigation).toBeVisible()
  await expect(navigation.locator('m3e-nav-item')).toHaveCount(4)
  for (const label of ['一覧', '検索', '設定']) await expect(nav(page, label)).toHaveAttribute('aria-label', label)
  await expect(nav(page, '一覧')).toHaveAttribute('selected', '')
  await expect(navigation.locator('m3e-nav-item').nth(2)).toHaveAttribute('aria-label', /^対応待ち(?: [1-9]\d* 件)?$/)
})

test('78a2 対応待ちがあるときは、下のタブの名前に件数が付く', async ({ page }) => {
  await visit(page, '/inbox', 'inbox')
  const inbox = page.getByRole('navigation', { name: 'メインナビゲーション' }).locator('m3e-nav-item').nth(2)
  await expect(inbox).toHaveAttribute('aria-label', /^対応待ち [1-9]\d* 件$/)
  await expect(inbox.locator('.count-badge')).toHaveText(/^(?:[1-9]\d?|99\+)$/)
})

test('78b 切断中の案内は、最後に接続した時刻がないときの文言と再接続の操作を出す', async ({ page }) => {
  await visit(page, '/', 'disconnected')
  const banner = page.locator('aside.connection-banner')
  await expect(banner).toHaveText(/DSH との接続が切れました.*保存済みのデータを表示しています.*再接続/s)
  await expect(button(page, '再接続')).toBeVisible()
})

test('78c テキスト入力のダイアログは既定のキャンセルと OK の名前を持つ', async ({ page }) => {
  await visit(page)
  await page.locator('m3e-icon-button[aria-label="ワークスペースを切り替え"]').click()
  await page.locator('[data-add-workspace]').click()
  await button(page, '新しいフォルダ').click()
  await expect(page.getByLabel('フォルダ名', { exact: true })).toBeVisible()
  await expect(button(page, 'キャンセル')).toBeVisible()
  await expect(button(page, 'OK')).toBeVisible()
  await button(page, 'キャンセル').click()
  await expect(page.getByLabel('フォルダ名', { exact: true })).toHaveCount(0)
})

test('78d 共通の枠（PageScaffold）の戻るボタンの名前', async ({ page }) => {
  await visit(page, '/settings/modes')
  await expect(page.locator('.page-screen h1')).toBeVisible()
  await expect(button(page, '戻る')).toBeVisible()
  await button(page, '戻る').click()
  await expect(page).toHaveURL(/#\/$/)
})
