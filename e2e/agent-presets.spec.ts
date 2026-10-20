import type { Page } from '@playwright/test'
import { test, expect, visit, nav, action, dismiss, shot, shots } from './helpers'

// Issue #123: the mode page. Made-up DSH data lives in
// web/src/features/agent-presets/mock.ts.

const card = (page: Page, name: string) =>
  page.locator('.modes-card').filter({ has: page.getByRole('heading', { name, level: 3 }) })

test('123 設定からモードを開き、既定を選び、構成の YAML を読む', async ({ page }) => {
  await visit(page)
  await nav(page, '設定').click()
  await action(page, 'モード').click()
  await expect(page.locator('h1')).toHaveText('モード')
  await expect(page.getByRole('heading', { name: '組込み' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'カスタム' })).toBeVisible()
  await expect(card(page, '標準モード').locator('.modes-badge-default')).toHaveText('新しい会話の既定')
  await expect(card(page, '旧モード').locator('.modes-broken')).toHaveText('プラグイン @example/missing を読み込めません')
  await expect(card(page, '旧モード').locator('m3e-button', { hasText: '新しい会話の既定にする' })).toHaveJSProperty('disabled', true)
  await shot(page, '123-modes')

  await card(page, '見直し').getByRole('button', { name: '新しい会話の既定にする' }).click()
  await expect(card(page, '見直し').locator('.modes-badge-default')).toHaveText('新しい会話の既定')
  await expect(card(page, '標準モード').locator('.modes-badge-default')).toHaveCount(0)
  await expect(card(page, '標準モード').getByRole('button', { name: '新しい会話の既定にする' })).toBeEnabled()
  await page.screenshot({ path: `${shots}123-modes-full.png`, fullPage: true, animations: 'disabled' })

  await card(page, '標準モード').getByRole('button', { name: '構成を見る' }).click()
  await expect(page.locator('.modes-yaml')).toContainText('!!js true')
  await shot(page, '123-modes-yaml')
  await expect(page.getByRole('heading', { name: '標準モード' }).last()).toBeVisible()
  await dismiss(page)
  await expect(page.locator('.modes-yaml')).toHaveCount(0)
})

test('123 名前空間のない Host では取得できないと伝える', async ({ page }) => {
  await visit(page, '/settings/modes', 'modes-unavailable')
  await expect(page.locator('h1')).toHaveText('モード')
  await expect(page.getByText('この Host ではモードの一覧を取得できません。')).toBeVisible()
})

test('123 読み込みに失敗したら説明と再試行を出す', async ({ page }) => {
  await visit(page, '/settings/modes', 'modes-error')
  await expect(page.getByRole('alert')).toContainText('サーバーでエラーが発生しました')
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible()
})

test('123 モードが無い Host では空だと伝える', async ({ page }) => {
  await visit(page, '/settings/modes', 'modes-empty')
  await expect(page.getByText('この Host にはモードがありません。')).toBeVisible()
  await expect(page.locator('.modes-card')).toHaveCount(0)
})

test('123 設定を変更できない Host では既定を選べない', async ({ page }) => {
  await visit(page, '/settings/modes', 'settings-readonly')
  await expect(page.getByText('この DSH では設定を変更できません。')).toBeVisible()
  await expect(card(page, '見直し').locator('m3e-button', { hasText: '新しい会話の既定にする' })).toHaveJSProperty('disabled', true)
  await card(page, '見直し').getByRole('button', { name: '構成を見る' }).click()
  await expect(page.locator('.modes-yaml')).toContainText('@example/dsh-preset-review')
  await dismiss(page)
})

test('123 保存が衝突したら読み直したと伝え、既定は動かない', async ({ page }) => {
  await visit(page, '/settings/modes', 'settings-conflict')
  await card(page, '見直し').getByRole('button', { name: '新しい会話の既定にする' }).click()
  await expect(page.getByRole('alert')).toHaveText('ほかの場所で設定が変わりました。読み直しました。')
  await expect(card(page, '標準モード').locator('.modes-badge-default')).toHaveText('新しい会話の既定')
})

test('123 構成を読めないときは理由を出し、画面は残る', async ({ page }) => {
  await visit(page, '/settings/modes', 'modes-read-error')
  await card(page, '標準モード').getByRole('button', { name: '構成を見る' }).click()
  await expect(page.getByRole('alert')).toContainText('サーバーでエラーが発生しました')
  await expect(page.locator('.modes-yaml')).toHaveCount(0)
  await expect(card(page, '標準モード')).toBeVisible()
})
