import { test, expect, visit, action } from './helpers'
import { PROVIDER_EVENTS } from '../web/src/features/settings/providers.ts'
import type { MockContext } from '../web/src/dsh/mock/context.ts'

declare global { interface Window {
  __s5ProviderProbe: { ctx: MockContext; configured: boolean; reads: number; emitted: string[] }
} }

test('S5 record-updatedだけで開いた提供元画面の登録状況を読み直す', async ({ page }) => {
  const event = PROVIDER_EVENTS.find(event => event.endsWith('/record-updated'))
  expect(event).toBeDefined()
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch()
    const body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      const probe = globalThis.__s5ProviderProbe = { ctx, configured: false, reads: 0, emitted: [] };
      const api = ctx.remote[${JSON.stringify(event!.split('/')[0])}];
      const describe = api.describe.bind(api);
      api.describe = async (...args) => {
        probe.reads++;
        const result = await describe(...args);
        if (result.ok && result.value.DEEPSEEK_API_KEY) result.value.DEEPSEEK_API_KEY.configured = probe.configured;
        return result;
      };
      const emit = ctx.mock.emit.bind(ctx.mock);
      ctx.mock.emit = (event, ...args) => { probe.emitted.push(event); return emit(event, ...args); };
      return ctx;`) })
  })
  await visit(page, '/settings/providers', 'empty')
  const provider = action(page, 'ディープシーク')
  await expect(provider).toContainText('API キー：未登録')
  for (const configured of [true, false]) {
    const before = await page.evaluate(() => window.__s5ProviderProbe.reads)
    await page.evaluate(async ({ event, configured }) => {
      const probe = window.__s5ProviderProbe
      probe.configured = configured
      probe.emitted = []
      // No set/unset call: only this one broadcast can invalidate the mounted UI.
      await probe.ctx.mock.emit(event, undefined)
    }, { event: event!, configured })
    await expect(provider).toContainText(configured ? 'API キー：登録済み' : 'API キー：未登録')
    expect(await page.evaluate(() => window.__s5ProviderProbe.reads)).toBeGreaterThan(before)
    expect(await page.evaluate(() => window.__s5ProviderProbe.emitted)).toEqual([event])
  }
})
