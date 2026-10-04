import { test, expect, visit, button, action } from './helpers'
import type { Page } from '@playwright/test'

async function expose(page: Page, path = '/s/readme-review') {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__queueReview = ctx; return ctx;') })
  })
  await visit(page, path)
  if (!path.endsWith('/subagents')) await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
}

test('R9 順番待ちの割り込みは実行中のnext-turnだけで有効になる', async ({ page }) => {
  await expose(page)
  await page.evaluate(() => {
    const ctx = (window as any).__queueReview
    const message = { id: 'queued', role: 'user', source: { kind: 'user', rpcId: 'different-rpc' }, content: [{ type: 'text', text: '待機中の本文' }] }
    ctx.mock.setProjection('readme-review', 'inbox', { 'next-turn': [message], 'next-step': [] })
  })
  await button(page, '順番待ち 1 件').click()
  await expect(button(page, '今すぐ割り込ませる')).toBeDisabled()
  await page.evaluate(() => (window as any).__queueReview.mock.setSessionState('readme-review', { running: true }))
  await expect(button(page, '今すぐ割り込ませる')).toBeEnabled()
  await page.evaluate(() => {
    const ctx = (window as any).__queueReview
    const inbox = ctx.mock.getProjection('readme-review', 'inbox')
    ctx.mock.setProjection('readme-review', 'inbox', { 'next-turn': [], 'next-step': inbox['next-turn'] })
  })
  await expect(button(page, '今すぐ割り込ませる')).toBeDisabled()
  await expect(button(page, '編集')).toBeEnabled()
  await button(page, '取り消す').click()
  await expect(page.getByRole('heading', { name: '順番待ちの編集' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__queueReview.mock.getProjection('readme-review', 'inbox')['next-step'])).toEqual([])
})

test('R9 操作直前に実行が終わると本文を保ち日本語のエラーを表示する', async ({ page }) => {
  await expose(page)
  await page.evaluate(() => {
    const ctx = (window as any).__queueReview
    ctx.mock.setSessionState('readme-review', { running: true })
    ctx.mock.setProjection('readme-review', 'inbox', { 'next-turn': [{ id: 'queued', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '取り消さない本文' }] }], 'next-step': [] })
    const face = ctx.sessions.binding('readme-review').session
    const update = face.updateQueue.bind(face)
    face.updateQueue = (...args: any[]) => { ctx.mock.setSessionState('readme-review', { running: false }); return update(...args) }
  })
  await button(page, '順番待ち 1 件').click()
  await button(page, '今すぐ割り込ませる').click()
  await expect(page.getByRole('alert')).toHaveText('このメッセージでは実行中の処理に割り込めません。')
  await expect(page.locator('.composer-queue-preview')).toHaveText('取り消さない本文')
  await expect(button(page, '今すぐ割り込ませる')).toBeDisabled()
})

test('R3 子のready待ちでシートを閉じると元の世代を保ち準備参照を即時解放する', async ({ page }) => {
  await expose(page)
  await page.evaluate(() => {
    const state = window as any, ctx = state.__queueReview
    state.__oldBinding = ctx.sessions.binding('readme-review')
    const retain = ctx.sessions.retain.bind(ctx.sessions)
    ctx.sessions.retain = (target: any, options: any) => {
      const reference = retain(target, options)
      if (options.source !== 'm3e.navigation') return reference
      return { ...reference, ready: reference.ready.then((binding: any) => new Promise((resolve, reject) => {
        state.__finishOpening = () => resolve(binding)
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })) }
    }
  })
  await page.getByLabel('会話を切り替え', { exact: true }).filter({ has: page.locator('.material-symbols-outlined') }).click()
  await page.getByLabel('会話名で検索', { exact: true }).fill('承認シートの見直し')
  await page.locator('.conversation-picker-row').filter({ hasText: '承認シートの見直し' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__queueReview.sessions.retainInfo('session-tools-review').getSnapshot().referenceCount)).toBe(1)
  await button(page, '閉じる').click()
  await expect.poll(() => page.evaluate(() => (window as any).__queueReview.sessions.retainInfo('session-tools-review').getSnapshot().referenceCount)).toBe(0)
  expect(await page.evaluate(() => (window as any).__queueReview.sessions.binding('readme-review') === (window as any).__oldBinding)).toBe(true)
  await page.evaluate(() => (window as any).__finishOpening())
  await expect(page).toHaveURL(/#\/s\/readme-review$/)
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
})

test('R4 子の画面の読み直すから開く失敗を回復できる', async ({ page }) => {
  await expose(page, '/s/approval-sheet/subagents')
  await page.evaluate(() => (window as any).__queueReview.mock.setSessionState('session-tools-review', { openState: 'error', openError: { code: 'gateway/internal', message: 'injected open failure', details: {} } }))
  await action(page, '承認シートの見直し').click()
  await expect(button(page, '読み直す')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__queueReview.sessions.retainInfo('session-tools-review').getSnapshot().referenceCount)).toBe(0)
  await page.evaluate(() => (window as any).__queueReview.mock.setSessionState('session-tools-review', { openState: 'open', openError: null }))
  await button(page, '読み直す').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await action(page, '承認シートの見直し').click()
  await expect(page.getByRole('heading', { name: '承認シートの見直し', exact: true })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
})
