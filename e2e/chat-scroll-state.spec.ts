import { test, expect, type Locator } from '@playwright/test'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'

const script = buildSync({ entryPoints: [fileURLToPath(new URL('./fixtures/chat-scroll.tsx', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' }).outputFiles[0]!.text

async function position(chat: Locator) {
  return chat.evaluate(node => {
    const top = node.getBoundingClientRect().top
    const row = [...node.querySelectorAll<HTMLElement>('[data-chat-key]')].find(row => row.getBoundingClientRect().bottom > top)
    return { key: row?.dataset.chatKey, offset: (row?.getBoundingClientRect().top ?? top) - top }
  })
}
async function move(chat: Locator, top: number) {
  // Let a tab activation's deferred restoration finish before simulating the
  // next user gesture; numeric parent restoration can match before that frame.
  await chat.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await chat.evaluate((node, value) => { node.scrollTop = value; node.dispatchEvent(new Event('scroll')) }, top)
}
test.beforeEach(async ({ page }) => {
  await page.setContent('<!doctype html><html lang="ja"><body><div id="app"></div></body></html>')
  await page.addScriptTag({ content: script })
  await expect.poll(() => page.locator('.chat-scroll').evaluate(node => node.scrollTop)).toBe(4700)
})

test('hidden prepend preserves the visible row and its offset after retained-panel restoration', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await move(chat, 2037)
  const saved = await position(chat)
  await page.getByRole('button', { name: '表示切替' }).click()
  await page.getByRole('button', { name: '別タブで先頭追加' }).click()
  await expect(page.locator('[data-chat-key]')).toHaveCount(70)
  await page.getByRole('button', { name: '表示切替' }).click()
  await expect.poll(() => position(chat)).toEqual(saved)
})

test('scrolling while an older-page request is pending updates the row to preserve', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await move(chat, 1037)
  await page.getByRole('button', { name: '読込開始' }).click()
  await expect(page.locator('output')).toHaveText('読込中')
  await move(chat, 1537)
  const saved = await position(chat)
  await page.getByRole('button', { name: '読込完了' }).click()
  await expect(page.locator('output')).toHaveText('待機')
  await expect.poll(() => position(chat)).toEqual(saved)
})

test('visible prepend stays anchored and programmatic restoration does not resume following', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await move(chat, 1237)
  const saved = await position(chat)
  await page.getByRole('button', { name: '読込開始' }).click()
  await page.getByRole('button', { name: '読込完了' }).click()
  await expect.poll(() => position(chat)).toEqual(saved)
  await page.getByRole('button', { name: '末尾追加' }).click()
  await expect.poll(() => position(chat)).toEqual(saved)
})

test('a request settling while hidden restores the reader on return', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await move(chat, 1237)
  await page.getByRole('button', { name: '読込開始' }).click()
  await move(chat, 1637)
  const saved = await position(chat)
  await page.getByRole('button', { name: '表示切替' }).click()
  await page.getByRole('button', { name: '読込完了' }).click()
  await expect(page.locator('output')).toHaveText('待機')
  await page.getByRole('button', { name: '表示切替' }).click()
  await expect.poll(() => position(chat)).toEqual(saved)
})

test('a request still pending on return tracks subsequent reader movement', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await move(chat, 1237)
  await page.getByRole('button', { name: '読込開始' }).click()
  const before = await position(chat)
  await page.getByRole('button', { name: '表示切替' }).click()
  await page.getByRole('button', { name: '表示切替' }).click()
  await expect.poll(() => position(chat)).toEqual(before)
  await move(chat, 1637)
  const saved = await position(chat)
  await page.getByRole('button', { name: '読込完了' }).click()
  await expect.poll(() => position(chat)).toEqual(saved)
})

test('following across hidden updates and explicitly returning to latest still reach the end', async ({ page }) => {
  const chat = page.locator('.chat-scroll')
  await page.getByRole('button', { name: '表示切替' }).click()
  await page.getByRole('button', { name: '別タブで先頭追加' }).click()
  await page.getByRole('button', { name: '末尾追加' }).click()
  await page.getByRole('button', { name: '表示切替' }).click()
  await expect.poll(() => chat.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBe(0)
  await move(chat, 1037)
  await page.getByRole('button', { name: '読込開始' }).click()
  await page.getByRole('button', { name: '最新へ' }).click()
  await page.getByRole('button', { name: '読込完了' }).click()
  await expect.poll(() => chat.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBe(0)
})
