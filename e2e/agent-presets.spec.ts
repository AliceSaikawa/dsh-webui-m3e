import { test, expect, visit, nav, action } from './helpers'

// Issue #123: the read-only mode roster and its new-conversation default.
// Made-up DSH data lives in web/src/features/settings/mock.ts.

test('123 設定の「モード」から一覧を開き、組み込みとカスタムの説明を出す', async ({ page }) => {
  await visit(page)
  await nav(page, '設定').click()
  await expect(action(page, 'モード')).toContainText('標準モード')
  await action(page, 'モード').click()
  await expect(page.locator('h1')).toHaveText('モード')
  await expect(page.getByRole('heading', { name: '組み込み' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'カスタム' })).toBeVisible()
  await expect(page.getByText('コード、ファイル、資料を扱います。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '新しい会話の既定: 標準モード' })).toBeDisabled()
  await expect(page.getByText('レビュー用', { exact: true })).toBeVisible()
})

test('123 カスタムモードを新しい会話の既定にできる', async ({ page }) => {
  await visit(page, '/settings/modes')
  await page.getByRole('button', { name: '新しい会話の既定にする: レビュー用' }).click()
  await expect(page.getByRole('button', { name: '新しい会話の既定: レビュー用' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '新しい会話の既定にする: 標準モード' })).toBeEnabled()
})

test('123 壊れたモードは選べないが、設定は読める', async ({ page }) => {
  await visit(page, '/settings/modes')
  await expect(page.getByRole('button', { name: '読み込めません: チーム用' })).toBeDisabled()
  const reason = page.locator('.settings-preset-broken')
  await expect(reason).toContainText('team-tools (./plugins/team-tools.js): Cannot find module')
  await expect(reason).toContainText('persona (@deepseek-ai/dsh-persona): waiting for terminal')
  await expect(reason).toHaveCSS('white-space', 'pre-line')
  await page.getByRole('button', { name: '設定を見る: チーム用' }).click()
  await expect(page.getByRole('heading', { name: 'チーム用 の設定' })).toBeVisible()
  await expect(page.locator('.settings-preset-code')).toContainText("name: './plugins/team-tools.js'")
  await page.locator('.settings-preset-close').click()
  await expect(page.locator('.settings-preset-code')).toHaveCount(0)
})

test('123 保存を拒否されたら理由を出し、既定は変えない', async ({ page }) => {
  await visit(page, '/settings/modes', 'settings-rejected')
  await page.getByRole('button', { name: '新しい会話の既定にする: レビュー用' }).click()
  await expect(page.getByRole('alert')).toHaveText('この値は管理者の設定によって許可されていません。')
  await expect(page.getByRole('button', { name: '新しい会話の既定: 標準モード' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '新しい会話の既定にする: レビュー用' })).toBeEnabled()
})

test('123 読み取り専用の Host では既定を変えられないと伝える', async ({ page }) => {
  await visit(page, '/settings/modes', 'settings-readonly')
  await expect(page.getByText('この DSH では既定のモードを変更できません。設定の内容は確認できます。')).toBeVisible()
  await expect(page.getByRole('button', { name: '新しい会話の既定にする: レビュー用' })).toBeDisabled()
})

test('123 一覧がない Host と取得失敗を区別する', async ({ page }) => {
  await visit(page, '/settings/modes', 'agent-presets-unavailable')
  await expect(page.getByText('この DSH ではモードの一覧を取得できません。')).toBeVisible()
  await visit(page, '/settings/modes', 'agent-presets-invocation-unavailable')
  await expect(page.getByText('この DSH ではモードの一覧を取得できません。')).toBeVisible()
  await visit(page, '/settings/modes', 'agent-presets-error')
  await expect(page.getByRole('alert')).toContainText('サーバーでエラーが発生しました')
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible()
})

test('123 既定のモードが一覧にないときは見つからないと伝える', async ({ page }) => {
  await visit(page, '/settings', 'agent-presets-missing-default')
  await expect(action(page, 'モード')).toContainText('既定のモードが見つかりません')
})
