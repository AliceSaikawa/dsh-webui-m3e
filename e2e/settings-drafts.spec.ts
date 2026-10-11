import { test, expect, visit } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const probe = globalThis.__settingsDrafts = { ctx, calls: [] };
      const update = ctx.remote.settings.update.bind(ctx.remote.settings);
      const mutate = ctx.remote.settings.mutate.bind(ctx.remote.settings);
      ctx.remote.settings.mutate = async (...args) => {
        if (probe.delayReset && args[0] === 'example-extension') await new Promise(resolve => { probe.releaseReset = resolve; });
        return mutate(...args);
      };
      probe.externalUpdate = update;
      ctx.remote.settings.update = async (...args) => {
        probe.calls.push(args);
        if (probe.delayValue !== undefined && args[0] === 'example-extension' && args[1].timeout === probe.delayValue) {
          await new Promise(resolve => { probe.release = resolve; });
        }
        if (probe.rejectNext) { probe.rejectNext = false; return { ok: false, error: { code: 'settings/rejected', message: '試験用の拒否', details: {} } }; }
        return update(...args);
      };
      return ctx;`) })
  })
})

test('#46 まとまりを戻す間は子の入力だけを止め、完了後に編集できる', async ({ page }) => {
  await visit(page, '/settings/other')
  const child = page.getByLabel('間隔', { exact: true })
  const sibling = page.getByLabel('待機時間', { exact: true })
  await expect(child).toBeEnabled()
  await page.evaluate(() => { (window as any).__settingsDrafts.delayReset = true })
  await page.getByRole('button', { name: '再試行を既定値に戻す', exact: true }).click()
  await expect(child).toBeDisabled()
  await expect(sibling).toBeEnabled()
  await sibling.fill('80')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__settingsDrafts.releaseReset))).toBe(true)
  await page.evaluate(() => { (window as any).__settingsDrafts.releaseReset() })
  await expect(child).toBeEnabled()
  await child.fill('7'); await child.press('Tab')
  await expect.poll(() => page.evaluate(async () => {
    const result = await (window as any).__settingsDrafts.ctx.remote.settings.describe()
    return result.value.namespaces.find((row: any) => row.ns === 'example-extension').value.retry.interval
  })).toBe(7)
  await expect(sibling).toHaveValue('80')
})

test('#46 60の保存待ちで80を入力し別グループを戻しても80を保存する', async ({ page }) => {
  await visit(page, '/settings/other')
  const field = page.getByLabel('待機時間', { exact: true })
  await expect(field).toHaveValue('45')
  await page.evaluate(() => { (window as any).__settingsDrafts.delayValue = 60 })
  await field.fill('60'); await field.press('Tab')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__settingsDrafts.release))).toBe(true)
  await field.fill('80')
  await page.getByRole('button', { name: '再試行を既定値に戻す', exact: true }).click()
  await page.evaluate(() => { (window as any).__settingsDrafts.release() })
  await expect.poll(() => page.evaluate(async () => {
    const result = await (window as any).__settingsDrafts.ctx.remote.settings.describe()
    return result.value.namespaces.find((row: any) => row.ns === 'example-extension').value.timeout
  })).toBe(80)
  await expect(field).toHaveValue('80')
  expect(await page.evaluate(() => (window as any).__settingsDrafts.calls.map((args: any[]) => args[1]))).toEqual([{ timeout: 60 }, { timeout: 80 }])
})

test('#46 debounce中の切断で入力と中断案内を保ち、復帰後に保存し直せる', async ({ page }) => {
  await visit(page, '/settings/other')
  const field = page.getByLabel('待機時間', { exact: true })
  await expect(field).toHaveValue('45')
  await field.fill('80')
  await page.evaluate(() => { (window as any).__settingsDrafts.ctx.mock.setConnectionState('disconnected') })
  await expect(field).toBeDisabled()
  await expect(field).toHaveValue('80')
  await expect(page.getByText(/接続が切れたため保存を中断/)).toBeVisible()
  await page.evaluate(() => { (window as any).__settingsDrafts.ctx.mock.setConnectionState('connected') })
  await expect(field).toBeEnabled()
  // Cross the actual 600ms debounce boundary: reconnect must not replay it.
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => (window as any).__settingsDrafts.calls.length)).toBe(0)
  await page.getByRole('button', { name: 'もう一度保存する', exact: true }).click()
  await expect(page.getByText(/接続が切れたため保存を中断/)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__settingsDrafts.calls.length)).toBe(1)
  await expect(field).toHaveValue('80')
})

test('#46 保存中の切断は古い応答を待たずに再試行し、新しい入力を保つ', async ({ page }) => {
  await visit(page, '/settings/other')
  const field = page.getByLabel('待機時間', { exact: true })
  await expect(field).toHaveValue('45')
  await page.evaluate(() => { (window as any).__settingsDrafts.delayValue = 60 })
  await field.fill('60'); await field.press('Tab')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__settingsDrafts.release))).toBe(true)
  await field.fill('80')
  await page.evaluate(() => { (window as any).__settingsDrafts.ctx.mock.setConnectionState('disconnected') })
  await expect(field).toBeDisabled()
  await page.evaluate(() => { (window as any).__settingsDrafts.ctx.mock.setConnectionState('connected') })
  await expect(field).toBeEnabled()
  await page.getByRole('button', { name: 'もう一度保存する', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__settingsDrafts.calls.length)).toBe(2)
  await page.evaluate(() => { (window as any).__settingsDrafts.release() })
  await expect(field).toHaveValue('80')
  await expect(page.locator('.settings-error')).toHaveCount(0)
})

test('#46 保存拒否のエラーは入力を元に戻すと消え、外部更新にも残らない', async ({ page }) => {
  await visit(page, '/settings/other')
  const field = page.getByLabel('待機時間', { exact: true })
  await expect(field).toHaveValue('45')
  await page.evaluate(() => { (window as any).__settingsDrafts.rejectNext = true })
  await field.fill('80'); await field.press('Tab')
  await expect(page.getByText('試験用の拒否', { exact: true })).toBeVisible()
  await field.fill('45'); await field.press('Tab')
  await expect(page.getByText('試験用の拒否', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__settingsDrafts.rejectNext = true })
  await field.fill('80'); await field.press('Tab')
  await expect(page.getByText('試験用の拒否', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const p = (window as any).__settingsDrafts
    const result = await p.ctx.remote.settings.describe()
    const row = result.value.namespaces.find((row: any) => row.ns === 'example-extension')
    await p.externalUpdate('example-extension', { timeout: 90 }, row.revision)
  })
  await expect(page.getByText('試験用の拒否', { exact: true })).toHaveCount(0)
  await expect(page.getByText('保存済みの値：90', { exact: true })).toBeVisible()
  await expect(field).toHaveValue('80')
  await expect(page.getByRole('button', { name: 'もう一度保存する', exact: true })).toBeEnabled()
})
