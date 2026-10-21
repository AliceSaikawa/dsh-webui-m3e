import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openM3e } from './fixtures.ts'
import type { DshHost } from './dsh-host.ts'

// The "一般" section of M3E and the stock Settings → General share one document
// per namespace. These tests change a value on one screen and read it on the other.
// A touch device is the one the stock index moves to /m3e/ on its own (see fixtures.ts).
test.use({ hasTouch: true })
test.describe.configure({ mode: 'serial' })

async function openStockSettings(context: BrowserContext, host: DshHost): Promise<Page> {
  const stock = await context.newPage()
  await stock.goto(`${host.origin}/?ui=classic`)
  const notice = stock.getByRole('button', { name: 'Continue', exact: true })
  if (await notice.isVisible({ timeout: 5_000 }).catch(() => false)) await notice.click()
  await stock.getByRole('button', { name: 'Account menu', exact: true }).click()
  await stock.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await expect(stock.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  return stock
}
const stockSwitch = (stock: Page) => stock.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('switch', { name: 'Show coding view', exact: true })
const m3eSwitch = (page: Page) => page.locator('section[aria-labelledby="settings-general"]').getByRole('switch', { name: 'コーディングビューを表示', exact: true })

test('G-real-1 コーディングビューを M3E で変えると標準画面に、標準画面で変えると M3E に反映される', async ({ page, context, integration }) => {
  await openM3e(page, integration.host, '/settings')
  await expect(m3eSwitch(page)).toBeChecked()
  const stock = await openStockSettings(context, integration.host)
  try {
    await expect(stockSwitch(stock)).toBeChecked()
    // M3E → stock: the stock dialog follows the change without a reload.
    await m3eSwitch(page).click()
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    await expect(stockSwitch(stock)).not.toBeChecked()
    // stock → M3E.
    await stockSwitch(stock).click()
    await expect(stockSwitch(stock)).toBeChecked()
    await expect(m3eSwitch(page)).toBeChecked()
  } finally {
    await stock.close()
  }
})

test('G-real-2 オフにするとモードの一覧から PTC と最小が消え、オンに戻すと出る（実 DSH の値に従う）', async ({ page, integration }) => {
  await openM3e(page, integration.host, '/settings')
  const mode = page.locator('m3e-list-action').filter({ hasText: 'モード' })
  const card = (name: string) => page.locator('.settings-preset-card').filter({ has: page.locator('.settings-preset-name', { hasText: name }) })
  await m3eSwitch(page).click()
  await expect(m3eSwitch(page)).not.toBeChecked()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  try {
    await mode.click()
    await expect(card('標準モード')).toBeVisible()
    await expect(card('PTC モード')).toHaveCount(0)
    await expect(card('最小モード')).toHaveCount(0)
  } finally {
    // Already logged in: only the route changes (a second login in this tab would stay on the stock index).
    await page.goto(`${integration.host.origin}/m3e/#/settings`)
    await expect(m3eSwitch(page)).toBeVisible()
    if (!await m3eSwitch(page).isChecked()) await m3eSwitch(page).click()
    await expect(m3eSwitch(page)).toBeChecked()
  }
  await mode.click()
  await expect(card('PTC モード')).toBeVisible()
  await expect(card('最小モード')).toBeVisible()
})

// The stock row is a title, a description and a menu button; the button names the current value.
const stockRow = (stock: Page, title: string) => stock.getByRole('dialog', { name: 'Settings', exact: true })
  .getByText(title, { exact: true }).locator('xpath=ancestor::div[2]').getByRole('button')
const m3eChoice = (page: Page, label: string) => page.locator('section[aria-labelledby="settings-general"]').locator(`m3e-select[aria-label="${label}"]`)
const m3eShown = (page: Page, label: string) => m3eChoice(page, label).evaluate((el: any) => el.selected.map((option: any) => option.textContent.trim()).join(','))
async function m3ePick(page: Page, label: string, option: string) {
  await m3eChoice(page, label).click()
  await page.locator('m3e-option').filter({ hasText: option }).last().click()
}

test('G-real-3 作業の詳細・折りたたむタイミング・パフォーマンスと使用状況が、標準画面と M3E で同じ値になる', async ({ page, context, integration }) => {
  await openM3e(page, integration.host, '/settings')
  // Nothing saved yet: both screens show the stock defaults.
  await expect.poll(() => m3eShown(page, '作業の詳細')).toBe('詳細')
  await expect.poll(() => m3eShown(page, '折りたたむタイミング')).toBe('回答の完了時')
  await expect.poll(() => m3eShown(page, 'パフォーマンスと使用状況')).toBe('詳細')
  const stock = await openStockSettings(context, integration.host)
  try {
    await expect(stockRow(stock, 'Work details')).toHaveText('Detailed')
    await expect(stockRow(stock, 'When to Collapse Work Details')).toHaveText('On completion')
    await expect(stockRow(stock, 'Performance & usage')).toHaveText('Detailed')
    // M3E → stock.
    await m3ePick(page, '作業の詳細', '完全に展開')
    await m3ePick(page, '折りたたむタイミング', '次のメッセージの送信時')
    await m3ePick(page, 'パフォーマンスと使用状況', '簡潔')
    await expect(stockRow(stock, 'Work details')).toHaveText('Verbose')
    await expect(stockRow(stock, 'When to Collapse Work Details')).toHaveText('On next message')
    await expect(stockRow(stock, 'Performance & usage')).toHaveText('Compact')
    // stock → M3E.
    await stockRow(stock, 'Work details').click()
    await stock.getByRole('menuitem', { name: 'Compact', exact: true }).click()
    await expect.poll(() => m3eShown(page, '作業の詳細')).toBe('簡潔')
    await stockRow(stock, 'Performance & usage').click()
    await stock.getByRole('menuitem', { name: 'Detailed', exact: true }).click()
    await expect.poll(() => m3eShown(page, 'パフォーマンスと使用状況')).toBe('詳細')
    await stockRow(stock, 'When to Collapse Work Details').click()
    await stock.getByRole('menuitem', { name: 'On completion', exact: true }).click()
    await expect.poll(() => m3eShown(page, '折りたたむタイミング')).toBe('回答の完了時')
    // The Host keeps them: a fresh load of M3E reads the same values.
    await page.reload()
    await expect.poll(() => m3eShown(page, '作業の詳細')).toBe('簡潔')
    await expect.poll(() => m3eShown(page, 'パフォーマンスと使用状況')).toBe('詳細')
    await expect.poll(() => m3eShown(page, '折りたたむタイミング')).toBe('回答の完了時')
  } finally {
    await stock.close()
  }
})
