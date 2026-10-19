import { test, expect, visit } from './helpers'
import type { Locator, Page } from '@playwright/test'

async function longPress(page: Page, target: Locator) {
  const bounds = await target.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.mouse.up()
}

async function chooseArchivedFilter(page: Page, name: string) {
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await page.locator('m3e-menu-item').filter({ hasText: name }).click()
}

test('100a アーカイブ済みの表示を切り替え、開けず、戻せる', async ({ page }) => {
  await visit(page)
  const last = page.locator('.home-session-button').last()
  const title = (await last.locator('strong').textContent())!.trim()
  await longPress(page, last)
  await page.getByRole('button', { name: 'アーカイブ', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('アーカイブしました')
  await expect(page.locator('.home-session-button').filter({ hasText: title })).toHaveCount(0)

  await chooseArchivedFilter(page, 'アーカイブ済みも表示')
  const archived = page.locator('.home-session[data-archived="true"]')
  await expect(archived).toHaveCount(1)
  await expect(page.locator('.home-list-caption')).toContainText('（アーカイブ済みを含む）')
  const row = archived.locator('.home-session-button')
  await expect(row).toHaveAccessibleName(new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}、アーカイブ済み`))
  await expect(archived.locator('.home-row-archived')).toBeVisible()

  const hash = await page.evaluate(() => location.hash)
  await row.click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('アーカイブ済みのセッションは開けません')
  expect(await page.evaluate(() => location.hash)).toBe(hash)

  await chooseArchivedFilter(page, 'アーカイブ済みだけ表示')
  await expect(page.locator('.home-session')).toHaveCount(1)
  await expect(page.locator('.home-session')).toHaveAttribute('data-archived', 'true')
  await expect(page.locator('.home-list-caption')).toContainText('1 件のアーカイブ済みセッション')

  await longPress(page, page.locator('.home-session-button').first())
  await page.getByRole('button', { name: 'アーカイブを戻す', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('アーカイブを戻しました')
  await expect(page.getByText('アーカイブ済みのセッションはありません', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.locator('h1').first()).toBeVisible()
  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await expect(page.locator('m3e-menu-item').filter({ hasText: 'アーカイブ済みだけ表示' })).toHaveAttribute('aria-checked', 'true')
})

test('100b アーカイブ済みの行は並べ替えのつまみを出さない', async ({ page }) => {
  await visit(page)
  const last = page.locator('.home-session-button').last()
  const title = (await last.locator('strong').textContent())!.trim()
  await longPress(page, last)
  await page.getByRole('button', { name: 'アーカイブ', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('アーカイブしました')

  await chooseArchivedFilter(page, 'アーカイブ済みも表示')
  const archived = page.locator('.home-session[data-archived="true"]')
  await expect(archived).toHaveCount(1)
  await expect(archived.locator('.home-drag-handle')).toHaveCount(0)

  await page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()
  await page.locator('m3e-menu-item').filter({ hasText: '並べ替え' }).click()
  await expect(page.locator('.home-session[data-archived="true"]')).toContainText(title)
  await expect(page.locator('.home-session[data-archived="true"] .home-drag-handle')).toHaveCount(0)
  expect(await page.locator('.home-session:not([data-archived="true"]) .home-drag-handle').count()).toBeGreaterThan(0)
})

const menuItems = (page: Page) => ({
  sort: page.locator('m3e-menu-item').filter({ hasText: '並べ替え' }),
  select: page.locator('m3e-menu-item').filter({ hasText: '選んでアーカイブ' }),
})
const openMenu = (page: Page) => page.locator('m3e-icon-button[aria-label="一覧のメニュー"]').click()

test('100c 操作できる行がないとき並べ替えと選んでアーカイブを押せない', async ({ page }) => {
  // The setup is serialized into the page and archives every Session before the screen starts.
  await page.addInitScript(`globalThis.__m3eTestMockContextReady = ctx => {
    for (const workspace of ctx.workspaces.list.getSnapshot().items) for (const id of workspace.sessionIds) void ctx.workspaces.archiveSession(id, { stopActivity: true })
  }`)
  await visit(page)
  const { sort, select } = menuItems(page)

  await chooseArchivedFilter(page, 'アーカイブ済みだけ表示')
  await expect(page.locator('.home-session[data-archived="true"]').first()).toBeVisible()
  await expect(page.locator('.home-session:not([data-archived="true"])')).toHaveCount(0)
  await openMenu(page)
  await expect(sort).toHaveAttribute('disabled', '')
  await expect(select).toHaveAttribute('disabled', '')
  await page.locator('m3e-menu-item').filter({ hasText: 'アーカイブ済みも表示' }).click()
  await expect(page.locator('.home-session[data-archived="true"]').first()).toBeVisible()
  await openMenu(page)
  await expect(sort).toHaveAttribute('disabled', '')
  await expect(select).toHaveAttribute('disabled', '')
})

test('100d 操作できる行があれば、アーカイブ済みも表示では並べ替えと選んでアーカイブを押せる', async ({ page }) => {
  await visit(page)
  const { sort, select } = menuItems(page)
  const last = page.locator('.home-session-button').last()
  await longPress(page, last)
  await page.getByRole('button', { name: 'アーカイブ', exact: true }).click()
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('アーカイブしました')

  await chooseArchivedFilter(page, 'アーカイブ済みも表示')
  await expect(page.locator('.home-session[data-archived="true"]')).toHaveCount(1)
  await openMenu(page)
  await expect(sort).not.toHaveAttribute('disabled', '')
  await expect(select).not.toHaveAttribute('disabled', '')
  await page.locator('m3e-menu-item').filter({ hasText: 'アーカイブ済みだけ表示' }).click()
  await expect(page.locator('.home-session')).toHaveCount(1)
  await openMenu(page)
  await expect(sort).toHaveAttribute('disabled', '')
  await expect(select).toHaveAttribute('disabled', '')
})
