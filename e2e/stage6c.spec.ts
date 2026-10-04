import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__stage6c = ctx;
      globalThis.__writes = 0;
      globalThis.__goalReads = 0;
      const getGoal = ctx.remote.goals.get;
      ctx.remote.goals.get = (...args) => { globalThis.__goalReads++; return getGoal(...args); };
      for (const method of ['update', 'mutate']) {
        const original = ctx.remote.settings[method];
        ctx.remote.settings[method] = (...args) => { globalThis.__writes++; return original(...args); };
      }
      return ctx;`) })
  })
}

test('S6C B1 整数に近い小数は保存RPCを呼ばず既存の刻みエラーを表示する', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings/agent')
  const section = page.locator('.settings-namespace').filter({ has: page.getByRole('heading', { name: 'エージェントの動作', exact: true }) })
  const input = section.locator('input')
  await input.fill('1.000000001')
  await input.blur()
  await expect(section.getByRole('alert')).toHaveText('1 刻みで入力してください。')
  expect(await page.evaluate(() => (window as any).__writes)).toBe(0)
  await input.fill('2')
  await input.blur()
  await expect(section.getByText('保存しました', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__writes)).toBe(1)
})

test('S6C B2 保存済み投影の後でAgentが準備されるまで操作を待ち通知なしで再取得する', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await expect(button(page, '完了にする')).toBeDisabled()
  await expect(button(page, 'ゴールを消す')).toBeDisabled()
  await page.evaluate(() => (window as any).__stage6c.mock.setAgentAvailable('approval-sheet', true))
  await expect(page.locator('.st-goal-status')).toContainText('停止中')
  await expect(button(page, '再開')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
  await button(page, '再開').click()
  await expect(page.locator('.st-goal-status')).toContainText('進行中')
  await button(page, '一時停止').click()
  await expect(page.locator('.st-goal-status')).toContainText('一時停止')
  // disarmed -> disarmed has no activation event; durable revision drives this.
  await button(page, '完了にする').click()
  await expect(page.locator('.st-goal-status')).toContainText('完了')
})

test('S6C M7 権限設定の通知で古いカタログを破棄し、正常な設定で候補と操作が復帰する', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/readme-review')
  const chip = page.locator('.composer-permission-label')
  await expect(chip).toHaveText('ワークスペース書込')
  await button(page, 'ワークスペース書込').click()
  const fullAccess = page.getByRole('button', { name: /^フル アクセス/ })
  await expect(fullAccess).toBeEnabled()
  const result = await page.evaluate(async () => {
    const ctx = (window as any).__stage6c
    const description = await ctx.remote.settings.describe()
    if (!description.ok) return description
    const row = description.value.namespaces.find((row: any) => row.ns === 'permission')
    return ctx.remote.settings.update('permission', { defaultPreset: 'unknown-preset' }, row.revision)
  })
  expect(result.ok).toBe(true)
  await expect(chip).toHaveText('権限')
  await expect(page.getByText('権限の候補を取得できませんでした。')).toBeVisible()
  await expect(fullAccess).toHaveCount(0)
  // Keep this same composer and sheet mounted: remounting would perform an
  // initial read even if the settings notification no longer reloaded them.
  const restored = await page.evaluate(async () => {
    const ctx = (window as any).__stage6c
    const description = await ctx.remote.settings.describe()
    if (!description.ok) return description
    const row = description.value.namespaces.find((row: any) => row.ns === 'permission')
    return ctx.remote.settings.update('permission', { defaultPreset: 'workspace-write' }, row.revision)
  })
  expect(restored.ok).toBe(true)
  await expect(chip).toHaveText('ワークスペース書込')
  await expect(page.getByText('権限の候補を取得できませんでした。')).toHaveCount(0)
  await expect(fullAccess).toBeEnabled()
  await fullAccess.click()
  await expect(page.getByRole('heading', { name: '権限の選び直し' })).toHaveCount(0)
  await expect(chip).toHaveText('フル アクセス')
})

test('S6C B2 会話の準備失敗で待機を止め、状態の回復から操作を再開する', async ({ page }) => {
  await page.clock.install()
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await page.evaluate(() => (window as any).__stage6c.mock.setSessionState('approval-sheet', { lastAgentError: '準備に失敗しました' }))
  const reads = await page.evaluate(() => (window as any).__goalReads)
  await page.clock.runFor(3000)
  expect(await page.evaluate(() => (window as any).__goalReads)).toBe(reads)
  await expect(button(page, '完了にする')).toBeDisabled()
  await page.evaluate(() => {
    const kit = (window as any).__stage6c.mock
    kit.setAgentAvailable('approval-sheet', true)
    kit.setSessionState('approval-sheet', { lastAgentError: null })
  })
  await expect(button(page, '再開')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
})

test('S6C B2 過去の準備エラーを残した再接続でも、遅い成功で完了の操作が復帰する', async ({ page }) => {
  await page.clock.install()
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await page.evaluate(() => (window as any).__stage6c.mock.setSessionState('approval-sheet', { lastAgentError: '以前の準備に失敗しました' }))
  await page.evaluate(() => (window as any).__stage6c.mock.setConnectionState('disconnected'))
  await page.clock.runFor(3000)
  await expect(button(page, '完了にする')).toBeDisabled()
  const reads = await page.evaluate(() => (window as any).__goalReads)
  await page.evaluate(() => (window as any).__stage6c.mock.setConnectionState('connected'))
  await expect.poll(() => page.evaluate(() => (window as any).__goalReads)).toBeGreaterThan(reads)
  await page.clock.runFor(3000)
  await expect(button(page, '完了にする')).toBeDisabled()
  // Agent availability alone leaves the old error, revision, running state and
  // disarmed activation unchanged; it emits no activation event to rescue us.
  await page.evaluate(() => (window as any).__stage6c.mock.setAgentAvailable('approval-sheet', true))
  await page.clock.runFor(250)
  expect(await page.evaluate(() => (window as any).__stage6c.sessions.binding('approval-sheet').session.getSnapshot().lastAgentError))
    .toBe('以前の準備に失敗しました')
  await expect(button(page, '再開')).toBeEnabled()
  await expect(button(page, '完了にする')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
  await button(page, '完了にする').click()
  await expect(page.locator('.st-goal-status')).toContainText('完了')
})
