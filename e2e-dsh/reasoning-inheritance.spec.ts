import type { Page, TestInfo } from '@playwright/test'
import { test as base, expect, button, openM3e } from './fixtures.ts'
import { startDsh, type DshHost } from './dsh-host.ts'
import { startFakeLlm } from './fake-llm.ts'

const inherited = { provider: 'reasoning-test', model: 'reasoning', reasoningEffort: 'high' }
const test = base.extend({
  integration: [async ({}, use) => {
    const llm = await startFakeLlm()
    let host: DshHost | undefined
    try {
      host = await startDsh(llm.url, { preserveRuns: true, basePatch: [
        { id: 'agent-default-model', config: inherited },
        { id: 'llm-pi-ai', config: { providers: { 'reasoning-test': {
          displayName: '推論なし検証', api: 'anthropic-messages', baseURL: llm.url,
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          models: [
            { id: 'reasoning', name: '推論対応モデル', reasoningEfforts: { low: 'low', high: 'high' } },
            { id: 'plain', name: '推論なしモデル', reasoningEfforts: false },
          ],
        } } } },
      ] })
      await use({ host, llm })
    } finally { await host?.stop(); await llm.close() }
  }, { scope: 'worker', timeout: 600_000 }],
})
test.describe.configure({ mode: 'serial' })

/** Observe the public remote without replacing RPCs, state, or transport. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    let facade: any
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => facade,
      set(value) {
        facade = value
        let load = value.load.bind(value)
        const observe = (plugin: any) => plugin.id !== '@deepseek-ai/dsh-api-session-controller' ? load(plugin) : load({
          ...plugin, factory(require: any) {
            const exported = plugin.factory(require), apply = exported.apply
            return { ...exported, apply(ctx: any) {
              const result = apply(ctx)
              ;(window as any).__reasoningRemote = ctx.root.remote
              return result
            } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: next => { load = next.bind(value) } })
      },
    })
  })
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const remote = (window as any).__reasoningRemote
    const description = await remote.settings.describe()
    const catalog = await remote.session.modelCatalog()
    if (!description.ok || !catalog.ok) throw new Error('公開設定の取得に失敗')
    const ns = description.value.namespaces.find((row: any) => row.ns === 'agent-default-model')
    return { base: ns.base, user: ns.user, value: ns.value, selection: catalog.value.default }
  })
}
const effort = (page: Page) => page.locator('m3e-select[aria-label="推論の強さ"]')
async function reopen(page: Page, host: DshHost) {
  await page.goto('about:blank')
  await host.restart()
  await openM3e(page, host, '/settings/models')
  await expect(page.locator('m3e-select[aria-label="モデル"]')).toBeEnabled()
}
async function evidence(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' })
  await info.attach(`${name}-画面`, { body: await page.screenshot(), contentType: 'image/png' })
}

test('I45 実設定: 指定なしで下位のhighを消し、Host再起動後も維持する', async ({ page, integration }, info) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/models')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  expect((await snapshot(page)).base).toMatchObject(inherited)
  await effort(page).click()
  await page.locator('m3e-option').filter({ hasText: '既定（モデルに任せる）' }).last().click()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  await reopen(page, integration.host)
  await expect(effort(page).locator('[slot="value"]')).toHaveText('既定（モデルに任せる）')
  // An empty select value still has a visible custom label. After blur the
  // field label must stay above it, including after a full Host restart.
  await page.getByRole('heading', { name: 'モデル', exact: true }).click()
  await expect.poll(() => effort(page).evaluate(select => {
    const label = select.closest('m3e-form-field')!.querySelector('label')!.getBoundingClientRect()
    const value = select.querySelector('[slot="value"]')!.getBoundingClientRect()
    return value.top - label.bottom
  })).toBeGreaterThan(0)
  const saved = await snapshot(page)
  expect(saved.base).toMatchObject(inherited)
  expect(saved.user.reasoningEffort).toEqual({ __jsExpr: 'void 0' })
  expect(saved.value.reasoningEffort).toBeUndefined()
  expect(saved.selection).toEqual({ provider: inherited.provider, model: inherited.model })
  await evidence(page, info, '指定なし・再起動後')
})

test('I45 実設定: 既定値に戻すと下位のhighを再び継承する', async ({ page, integration }, info) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/models')
  await button(page, '既定のモデルを既定値に戻す').click()
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  await reopen(page, integration.host)
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  const reset = await snapshot(page)
  expect(reset.value).toMatchObject(inherited)
  expect(reset.selection).toEqual(inherited)
  expect(reset.user).toEqual({})
  await evidence(page, info, '既定値へ戻す・再起動後')
})

test('I45 実設定: 非対応モデルへ変更して保存・再起動・送信できる', async ({ page, integration }, info) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/models')
  await expect(effort(page)).toHaveJSProperty('value', 'high')
  await page.locator('m3e-select[aria-label="モデル"]').click()
  await page.locator('m3e-option').filter({ hasText: '推論なし検証 / 推論なしモデル' }).last().click()
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  await reopen(page, integration.host)
  await expect(effort(page)).toBeHidden()
  const saved = await snapshot(page)
  expect(saved.base).toMatchObject(inherited)
  expect(saved.user.reasoningEffort).toEqual({ __jsExpr: 'void 0' })
  expect(saved.selection).toEqual({ provider: 'reasoning-test', model: 'plain' })
  expect(saved.value.reasoningEffort).toBeUndefined()
  await evidence(page, info, '非対応モデル・再起動後')
  await page.goto(`${integration.host.origin}/m3e/#/`)
  await button(page, 'ワークスペースを追加').click()
  await button(page, 'ここを追加').click()
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill('推論なしモデルの保存確認')
  await button(page, '送信').click()
  try {
    await expect(page.getByText('こんにちは。偽のモデルです。', { exact: true })).toBeVisible()
  } finally {
    await info.attach('ローカルLLMの要求先', { body: JSON.stringify(integration.llm.requestPaths), contentType: 'application/json' })
  }
  expect(integration.llm.requests.some(request => request.model === 'plain')).toBe(true)
})
