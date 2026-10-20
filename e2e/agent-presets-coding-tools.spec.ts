import { test, expect, visit, action, shot } from './helpers'
import type { Page } from '@playwright/test'

// Issue #143: with Coding Tools off (ui-settings `enabled: false`) the Host hides
// the PTC and Minimal modes and puts a hidden default back to standard.

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__codingTools = ctx; return ctx;') })
  })
}

const selectedDefault = (page: Page) => page.evaluate(async () => {
  const result = await (window as any).__codingTools.remote.settings.describe()
  return result.value.namespaces.find((row: any) => row.ns === 'agent-preset-registry').value.selectedDefault
})
const setCodingTools = (page: Page, enabled: boolean) => page.evaluate(async enabled => {
  const settings = (window as any).__codingTools.remote.settings
  const row = (await settings.describe()).value.namespaces.find((item: any) => item.ns === 'ui-settings')
  const result = await settings.update('ui-settings', { enabled }, row.revision)
  if (!result.ok) throw new Error(result.error.message)
}, enabled)

// Match the mode's own name: descriptions mention other modes (PTC's says "標準モード").
const card = (page: Page, name: string) => page.locator('.settings-preset-card').filter({ has: page.locator('.settings-preset-name', { hasText: name }) })
const standardIsDefault = (page: Page) => expect(page.getByRole('button', { name: '新しい会話の既定: 標準モード' })).toBeDisabled()

test('143 コード作業がオンなら PTC と最小も一覧に出る', async ({ page }) => {
  await visit(page, '/settings/modes')
  await expect(card(page, '標準モード')).toBeVisible()
  await expect(card(page, 'PTC モード')).toBeVisible()
  await expect(card(page, '最小モード')).toBeVisible()
})

test('143 コード作業がオフなら、モードの一覧から PTC と最小を隠す', async ({ page }) => {
  await visit(page, '/settings/modes', 'coding-tools-off')
  await expect(card(page, '標準モード')).toBeVisible()
  await expect(card(page, 'Creator モード')).toBeVisible()
  await expect(card(page, 'レビュー用')).toBeVisible()
  await expect(card(page, 'PTC モード')).toHaveCount(0)
  await expect(card(page, '最小モード')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await shot(page, '143-coding-tools-off')
})

test('143 オフにして既定が PTC なら、標準へ戻して保存する', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings/modes', 'coding-tools-off-default-ptc')
  await expect(card(page, 'PTC モード')).toHaveCount(0)
  await standardIsDefault(page)
  expect(await selectedDefault(page)).toBe('standard')
  await page.goto('/m3e/?mock&scenario=coding-tools-off-default-ptc#/settings')
  await expect(action(page, 'モード')).toContainText('標準モード')
})

test('143 設定の一覧を開いただけでも、隠れた既定を標準へ戻す', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings', 'coding-tools-off-default-ptc')
  await expect(action(page, 'モード')).toContainText('標準モード')
  expect(await selectedDefault(page)).toBe('standard')
})

test('143 標準が使えないときは保存せず、理由を伝える', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings/modes', 'coding-tools-off-default-ptc-no-standard')
  await expect(page.getByRole('alert')).toContainText('標準モードを使えません')
  await expect(page.getByRole('alert')).toContainText('既定は変更していません')
  await expect(card(page, 'PTC モード')).toHaveCount(0)
  expect(await selectedDefault(page)).toBe('ptc')
})

test('143 実行中にオフへ変えると隠して標準へ戻し、オンに戻すと再び出る（既定は標準のまま）', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings/modes')
  await page.getByRole('button', { name: '新しい会話の既定にする: PTC モード' }).click()
  await expect(page.getByRole('button', { name: '新しい会話の既定: PTC モード' })).toBeDisabled()
  await setCodingTools(page, false)
  await expect(card(page, 'PTC モード')).toHaveCount(0)
  await expect(card(page, '最小モード')).toHaveCount(0)
  await standardIsDefault(page)
  expect(await selectedDefault(page)).toBe('standard')
  await setCodingTools(page, true)
  await expect(card(page, 'PTC モード')).toBeVisible()
  await expect(card(page, '最小モード')).toBeVisible()
  await standardIsDefault(page)
})
