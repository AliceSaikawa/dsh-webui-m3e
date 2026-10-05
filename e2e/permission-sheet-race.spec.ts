import { test, expect, visit } from './helpers'
import type { Page } from '@playwright/test'

const routes = [
  { name: '既存会話', path: '/s/readme-review' },
  { name: '新しい会話', path: '/new?ws=ws-m3e' },
]
const chip = (page: Page) => page.locator('.composer-permission')
const sheet = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="権限の選び直し"]')
const sheetCount = (page: Page) => page.evaluate(() => (window as any).__permissionSheetCount())

async function holdPermissions(page: Page, path: string) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const original = ctx.remote.permissionPresets.catalog.bind(ctx.remote.permissionPresets);
      const pending = [];
      let held = true;
      ctx.remote.permissionPresets.catalog = () => held ? new Promise(resolve => pending.push(resolve)) : original();
      globalThis.__releasePermissionRace = async (fail) => {
        held = false;
        const result = fail
          ? { ok: false, error: { code: 'gateway/internal', message: 'injected catalog failure', details: {} } }
          : await original();
        pending.splice(0).forEach(resolve => resolve(result));
      };
      return ctx;`) })
  })
  // Inactive entries may not be mounted: count the actual stack as well as the visible sheet.
  await page.route('**/src/app/overlay/store.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    await route.fulfill({ response, body: `${body}\nglobalThis.__permissionSheetCount = () => getOverlays().filter(entry => entry.label === '権限の選び直し').length;` })
  })
  await visit(page, path)
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await expect(chip(page)).toHaveText('shield権限')
}

async function pressWhilePending(page: Page, count: number) {
  const before = await chip(page).innerHTML()
  for (let i = 0; i < count; i++) await chip(page).click()
  await expect(chip(page)).toBeEnabled()
  expect(await chip(page).innerHTML()).toBe(before)
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.locator('.composer-notice')).toHaveCount(0)
}

async function release(page: Page, fail = false) {
  await page.evaluate(failure => (window as any).__releasePermissionRace(failure), fail)
}

async function expectOneAndClose(page: Page) {
  await expect.poll(() => sheetCount(page)).toBe(1)
  await expect(sheet(page)).toHaveCount(1)
  await expect.poll(() => sheet(page).evaluate(element => element.matches(':popover-open'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => sheetCount(page)).toBe(0)
  await expect(sheet(page)).toHaveCount(0)
}

for (const route of routes) {
  for (const count of [2, 3]) test(`PR1 ${route.name}の初回権限取得中に${count}回押しても一枚だけ開き、一度で閉じて再度開ける`, async ({ page }) => {
    await holdPermissions(page, route.path)
    await pressWhilePending(page, count)
    await release(page)
    await expectOneAndClose(page)
    await chip(page).click()
    await expectOneAndClose(page)
  })

  test(`PR2 ${route.name}の権限取得が失敗しても次の操作で開ける`, async ({ page }) => {
    await holdPermissions(page, route.path)
    await pressWhilePending(page, 3)
    await release(page, true)
    await expect(page.locator('.composer-notice')).toHaveText('サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。')
    await expect.poll(() => sheetCount(page)).toBe(0)
    await chip(page).click()
    await expectOneAndClose(page)
    await chip(page).click()
    await expectOneAndClose(page)
  })

  test(`PR3 ${route.name}の権限取得中に入力欄が外れても移動先と戻った画面で開ける`, async ({ page }) => {
    await holdPermissions(page, route.path)
    await pressWhilePending(page, 3)
    const previous = await page.getByTestId('composer').elementHandle()
    await page.evaluate(() => { window.location.hash = '/s/approval-sheet' })
    await expect.poll(() => previous!.evaluate(element => element.isConnected)).toBe(false)
    await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
    await pressWhilePending(page, 3)
    await release(page)
    await expectOneAndClose(page)
    await page.evaluate(path => { window.location.hash = path }, route.path)
    await expect(page).toHaveURL(new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
    await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
    await chip(page).click()
    await expectOneAndClose(page)
  })
}

for (const route of routes) {
  test(`PR4 ${route.name}の権限取得中に本文入力で再描画しても一枚だけ開き、本文を保つ`, async ({ page }) => {
    await holdPermissions(page, route.path)
    await pressWhilePending(page, 1)
    const input = page.getByLabel('メッセージ入力欄')
    const text = '権限の候補を待ちながら入力した本文'
    await input.fill(text)
    // Wait for React to reflect the draft change, not just the native input value.
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled()
    await pressWhilePending(page, 1)
    await release(page)
    await expect(input).toHaveValue(text)
    await expectOneAndClose(page)
    await expect(input).toHaveValue(text)
  })
}
