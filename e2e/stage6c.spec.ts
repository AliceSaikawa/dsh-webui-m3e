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

async function announceAgentReady(page: Page) {
  await page.evaluate(async () => {
    const kit = (window as any).__stage6c.mock
    kit.setAgentAvailable('approval-sheet', true)
    // Host agent/created publishes availability even if activation is unchanged.
    await kit.emit('api-session/added', { sessionId: 'approval-sheet', agentAvailable: true, running: false, blank: false, updatedAt: Date.now() })
  })
}

async function preparationFailed(page: Page, message: string) {
  await page.evaluate(async message => {
    const kit = (window as any).__stage6c.mock
    kit.setSessionState('approval-sheet', { lastAgentError: message })
    await kit.emit('api-session/error', 'approval-sheet', { additionalArgs: [message] })
  }, message)
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

test('S6C B2 保存済み投影の後でAgentが準備されるまで操作を待ちactivation通知なしで再取得する', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await expect(button(page, '完了にする')).toBeDisabled()
  await expect(button(page, 'ゴールを消す')).toBeDisabled()
  await announceAgentReady(page)
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
  await expect(page.locator('.composer-sheet').getByRole('alert')).toHaveText('サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。')
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
  await expect(page.locator('.composer-sheet').getByRole('alert')).toHaveCount(0)
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
  await preparationFailed(page, '準備に失敗しました')
  const reads = await page.evaluate(() => (window as any).__goalReads)
  await page.clock.runFor(3000)
  expect(await page.evaluate(() => (window as any).__goalReads)).toBe(reads)
  await expect(button(page, '完了にする')).toBeDisabled()
  await page.evaluate(() => {
    const kit = (window as any).__stage6c.mock
    kit.setSessionState('approval-sheet', { lastAgentError: null })
  })
  await announceAgentReady(page)
  await expect(button(page, '再開')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
})

test('S6C B2 過去の準備エラーを残した再接続でも、遅い成功で完了の操作が復帰する', async ({ page }) => {
  await page.clock.install()
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await preparationFailed(page, '以前の準備に失敗しました')
  await page.evaluate(() => (window as any).__stage6c.mock.setConnectionState('disconnected'))
  await page.clock.runFor(3000)
  await expect(button(page, '完了にする')).toBeDisabled()
  const reads = await page.evaluate(() => (window as any).__goalReads)
  await page.evaluate(() => (window as any).__stage6c.mock.setConnectionState('connected'))
  await expect.poll(() => page.evaluate(() => (window as any).__goalReads)).toBeGreaterThan(reads)
  await page.clock.runFor(3000)
  await expect(button(page, '完了にする')).toBeDisabled()
  // Availability leaves the old error, revision, running and activation intact.
  await announceAgentReady(page)
  await page.clock.runFor(250)
  expect(await page.evaluate(() => (window as any).__stage6c.sessions.binding('approval-sheet').session.getSnapshot().lastAgentError))
    .toBe('以前の準備に失敗しました')
  await expect(button(page, '再開')).toBeEnabled()
  await expect(button(page, '完了にする')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
  await button(page, '完了にする').click()
  await expect(page.locator('.st-goal-status')).toContainText('完了')
})

test('S6C B2 準備が進まなければ読取りを続けず、既存の状態を読み直す操作で復帰する', async ({ page }) => {
  await page.clock.install()
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  const reads = await page.evaluate(() => (window as any).__goalReads)
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).__goalReads)).toBe(reads)
  // Deliberately omit the availability event to verify manual recovery too.
  await page.evaluate(() => (window as any).__stage6c.mock.setAgentAvailable('approval-sheet', true))
  await button(page, '状態を読み直す').click()
  await expect(button(page, '完了にする')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
})

test('S6C B2 準備待ちのゴール画面を離れると通知が来ても読取りを再開しない', async ({ page }) => {
  await page.clock.install()
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  const reads = await page.evaluate(() => (window as any).__goalReads)
  // Keep the same Session open on chat so a leaked watcher could still read it.
  await page.evaluate(() => { window.location.hash = '/s/approval-sheet' })
  await expect(page.getByRole('heading', { name: 'ゴール', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('メッセージ入力欄')).toBeVisible()
  await announceAgentReady(page)
  await page.evaluate(() => {
    const kit = (window as any).__stage6c.mock
    kit.setSessionState('approval-sheet', { running: true })
    kit.setProjection('approval-sheet', 'goal', kit.getProjection('approval-sheet', 'goal'))
  })
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).__goalReads)).toBe(reads)
})

test('S6C B2 同じゴールの投影更新から実行状態を読み直す', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet/goal', 'goal-preparing')
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toBeVisible()
  await page.evaluate(() => {
    const kit = (window as any).__stage6c.mock
    kit.setAgentAvailable('approval-sheet', true)
    // Keep id/revision unchanged, so React effect remounting cannot rescue a
    // missing projection subscription. No availability/activation broadcast.
    kit.setProjection('approval-sheet', 'goal', kit.getProjection('approval-sheet', 'goal'))
  })
  await expect(button(page, '完了にする')).toBeEnabled()
  await expect(page.getByText('ゴールの実行状態を確認できませんでした。')).toHaveCount(0)
})

test('S6C B2 外部からゴールを一時停止して版が変わっても、同じ画面で再開が有効になる', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet/goal')
  await expect(button(page, '一時停止')).toBeEnabled()
  const url = page.url()
  // Another client changes the goal through the RPC. Do not use this screen's
  // mutate handler, manual refresh, navigation or reload to restore the button.
  const changed = await page.evaluate(async () => {
    const api = (window as any).__stage6c.remote.goals
    const current = await api.get('approval-sheet')
    if (!current.ok || !current.value) throw new Error('外部操作前のゴールを取得できませんでした')
    const ref = { id: current.value.id, revision: current.value.revision }
    return { before: ref, result: await api.pause('approval-sheet', ref) }
  })
  expect(changed.result.ok).toBe(true)
  expect(changed.result.value).toMatchObject({
    id: changed.before.id, revision: changed.before.revision + 1, phase: 'paused', activation: 'disarmed',
  })
  await expect(page.locator('.st-goal-status')).toContainText('一時停止')
  await expect(button(page, '再開')).toBeEnabled()
  expect(page.url()).toBe(url)
})
