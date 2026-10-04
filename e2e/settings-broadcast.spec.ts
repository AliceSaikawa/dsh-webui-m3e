import { test, expect, visit } from './helpers'
import type { MockContext } from '../web/src/dsh/mock/context.ts'
import type { SettingsApi } from '../web/src/features/settings/store.ts'

declare global { interface Window {
  __s5SettingsProbe: { ctx: MockContext; describes: number }
} }

test('S5 偽の複数引数放送から useSettings へ版を渡し、同じ版の再取得と解除後の更新を防ぐ', async ({ page }) => {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch()
    const body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const probe = globalThis.__s5SettingsProbe = { ctx, describes: 0 };
      const describe = ctx.remote.settings.describe.bind(ctx.remote.settings);
      ctx.remote.settings.describe = (...args) => { probe.describes++; return describe(...args); };
      return ctx;`) })
  })
  await visit(page, '/settings/agent')
  const section = page.locator('.settings-namespace').filter({ has: page.getByRole('heading', { name: 'エージェントの動作', exact: true }) })
  await expect(section.getByLabel('名前', { exact: true })).toHaveValue('通常の実行')
  const revision = await page.evaluate(async () => {
    const result = await (window.__s5SettingsProbe.ctx.remote.settings as SettingsApi).describe()
    if (!result.ok) throw new Error(result.error.message)
    return result.value.namespaces.find(row => row.ns === 'agent-loop')!.revision
  })
  const emitAndCount = (version: number) => page.evaluate(async version => {
    const probe = window.__s5SettingsProbe
    const before = probe.describes
    await probe.ctx.mock.emit('settings/document-updated', 'agent-loop', { additionalArgs: [version] })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return probe.describes - before
  }, version)
  expect(await emitAndCount(revision)).toBe(0)
  expect(await emitAndCount(revision + 1)).toBe(1)
  await page.evaluate(() => { window.location.hash = '/' })
  await expect(page.locator('.home-session').first()).toBeVisible()
  expect(await emitAndCount(revision + 1)).toBe(0)
})
