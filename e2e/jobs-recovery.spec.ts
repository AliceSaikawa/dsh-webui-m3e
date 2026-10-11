import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__jobsRace = ctx; return ctx;') })
  })
  await visit(page, '/s/approval-sheet/jobs')
  await expect(page.getByRole('list', { name: 'ジョブの一覧' }).locator('li')).toHaveCount(3)
}

test('ジョブ購読が失敗しても空と表示せず再試行で最新の一覧へ戻る', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => (window as any).__jobsRace.mock.failJobRows('approval-sheet'))
  await expect(page.getByRole('alert')).toContainText('ジョブを読み込めませんでした')
  await expect(page.getByText('ジョブはありません。', { exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as any).__jobsRace.mock.setJobs('approval-sheet', [{ id: 'recovered', label: '復旧したジョブ', kind: 'bash', status: 'running', startedAt: 0, output: { total: 0, earliest: 0 } }]))
  await button(page, 'もう一度読み込む').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'ジョブの一覧' })).toContainText('復旧したジョブ')
})

test('実行中ジョブの停止を要求しても購読通知が来るまで停止済みにしない', async ({ page }) => {
  await setup(page)
  const stop = page.getByRole('button', { name: /を停止$/ })
  await expect(stop).toHaveCount(1)
  await stop.click()
  await expect(page.getByRole('status')).toContainText('停止を要求しました')
  await expect(page.getByRole('list', { name: 'ジョブの一覧' })).toContainText('実行中')
})

async function holdKill(page: Page) {
  await page.evaluate(() => {
    const ctx = (window as any).__jobsRace
    ;(window as any).__killCalls = []
    ctx.mock.patch('jobs.kill', (sessionId: string, id: string) => new Promise(resolve => (window as any).__killCalls.push({ sessionId, id, resolve })))
  })
}
async function settleKill(page: Page, outcome: 'error' | 'requested' | 'already-finished', index = 0) {
  await page.evaluate(({ outcome, index }) => (window as any).__killCalls[index].resolve(outcome === 'error'
    ? { ok: false, error: { code: 'job/not-found', message: 'fixture failure', details: {} } }
    : { ok: true, value: { outcome } }), { outcome, index })
}

test('停止中の連打を防ぎ、失敗後は再試行でき、停止済みの通知で操作を消す', async ({ page }) => {
  await setup(page); await holdKill(page)
  const stop = page.getByRole('button', { name: /を停止$/ })
  await stop.click(); await stop.dispatchEvent('click'); await stop.dispatchEvent('click')
  expect(await page.evaluate(() => (window as any).__killCalls.length)).toBe(1)
  await settleKill(page, 'error')
  await expect(page.getByRole('alert')).toContainText('ジョブを停止できませんでした')
  await expect(stop).toBeEnabled()
  await stop.click(); await settleKill(page, 'requested', 1)
  await expect(stop).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => { const ctx = (window as any).__jobsRace; const id = (window as any).__killCalls[0].id; ctx.mock.setJobs('approval-sheet', [{ id, label: '停止したジョブ', kind: 'bash', status: 'killed', startedAt: 0, finishedAt: 1000, output: { total: 0, earliest: 0 } }]) })
  await expect(page.getByRole('list')).toContainText('停止済み')
  await expect(stop).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('停止応答がすでに終了でも状態を書き換えず通知を待つ', async ({ page }) => {
  await setup(page); await holdKill(page)
  const stop = page.getByRole('button', { name: /を停止$/ })
  await stop.click(); await settleKill(page, 'already-finished')
  await expect(page.getByRole('status')).toHaveText('このジョブはすでに終了しています。')
  await expect(page.getByRole('list')).toContainText('実行中')
  await expect(stop).toBeDisabled()
})

for (const change of ['leave', 'settled']) test(`停止応答より先に${change}しても古い失敗を表示しない`, async ({ page }) => {
  await setup(page); await holdKill(page)
  await page.getByRole('button', { name: /を停止$/ }).click()
  if (change === 'leave') await page.evaluate(() => { location.hash = '/s/readme-review/jobs' })
  else await page.evaluate(() => { const ctx = (window as any).__jobsRace; ctx.mock.setJobs('approval-sheet', [{ id: (window as any).__killCalls[0].id, label: '完了したジョブ', kind: 'bash', status: 'completed', startedAt: 0, output: { total: 0, earliest: 0 } }]) })
  if (change === 'leave') await expect(page.getByText('ジョブはありません。', { exact: true })).toBeVisible()
  else await expect(page.getByRole('list')).toContainText('完了したジョブ')
  await settleKill(page, 'error')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('購読失敗後に再接続すると空と決めつけず最新の一覧へ戻る', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { const ctx = (window as any).__jobsRace; ctx.mock.failJobRows('approval-sheet') })
  await expect(page.getByRole('alert')).toBeVisible()
  await page.evaluate(() => { const ctx = (window as any).__jobsRace; ctx.mock.setConnectionState('disconnected'); ctx.mock.setJobs('approval-sheet', []) })
  await page.evaluate(() => (window as any).__jobsRace.mock.setConnectionState('connected'))
  await expect(page.getByText('ジョブはありません。', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('会話メニューは購読失敗を件数0として扱わず更新失敗を示す', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { location.hash = '/s/approval-sheet' })
  const menu = page.getByLabel('会話のメニュー', { exact: true }).filter({ has: page.locator('m3e-menu-trigger') })
  await menu.click()
  await expect(page.getByLabel('実行中・停止中 1 件')).toBeVisible()
  await page.evaluate(() => (window as any).__jobsRace.mock.failJobRows('approval-sheet'))
  await expect(page.getByLabel('ジョブの更新に失敗')).toBeVisible()
  await expect(page.getByLabel('実行中・停止中 0 件')).toHaveCount(0)
})
