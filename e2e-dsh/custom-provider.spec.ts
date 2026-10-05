import type { Page } from '@playwright/test'
import { test, expect, button, openM3e } from './fixtures.ts'

/** Observe the public remote only; no substitute Host or key API is installed. */
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
            return { ...exported, apply(ctx: any) { const result = apply(ctx); (window as any).__customRemote = ctx.root.remote; return result } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: next => { load = next.bind(value) } })
      },
    })
  })
}
const form = (page: Page) => page.locator('.custom-provider-form')
const row = (page: Page, id: string) => page.getByRole('group', { name: id, exact: true })
async function create(page: Page, id: string, withKey: boolean) {
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill(id)
  await page.getByLabel('ベース URL', { exact: true }).fill('http://127.0.0.1:12345/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill(`${id}-model`)
  if (withKey) await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-integration-only')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await expect(row(page, id)).toContainText(withKey ? 'API キー：登録済み' : 'API キー：未登録')
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const remote = (window as any).__customRemote
    const result = await remote.settings.describe()
    if (!result.ok) throw new Error('describe failed')
    const ns = result.value.namespaces.find((n: any) => n.ns === 'llm-pi-ai')
    return { providers: ns.value.providers, revision: ns.revision, default: (await remote.session.modelCatalog()).value.default }
  })
}

test('I16 real lifecycle: キーあり・なしの作成と編集を再読込し未知項目と既定値を保持する', async ({ page, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  const before = await snapshot(page)
  for (const [id, withKey] of [['i16-keyless', false], ['i16-keyed', true]] as const) {
    await create(page, id, withKey)
    const saved = await snapshot(page)
    expect(saved.providers[id]).toMatchObject({ baseURL: 'http://127.0.0.1:12345/v1', api: 'openai-completions', models: [{ id: `${id}-model` }] })
    expect(saved.default).toEqual(before.default)
    await page.reload(); await expect(row(page, id)).toBeVisible()
    expect((await snapshot(page)).providers[id]).toEqual(saved.providers[id])
    // Model metadata not exposed by this form must survive array replacement.
    const enriched = await page.evaluate(async id => {
      const remote = (window as any).__customRemote
      const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-pi-ai')
      return remote.settings.mutate(ns.ns, [
        { op: 'set', path: ['providers', id, 'extraField'], value: { retained: true } },
        { op: 'set', path: ['providers', id, 'models'], value: [{ id: `${id}-model`, extraField: { retained: 'model' }, reasoningEfforts: { high: 'high' } }] },
      ], ns.revision)
    }, id)
    expect(enriched.ok).toBe(true)
    await row(page, id).getByRole('button', { name: '編集', exact: true }).click()
    await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveAttribute('type', 'password')
    await page.getByLabel('モデル表示名（任意）', { exact: true }).fill('編集したモデル')
    await button(page, 'モデルを追加').click()
    await page.getByLabel('モデル ID', { exact: true }).last().fill(`${id}-second`)
    await button(page, '保存').click(); await expect(form(page)).toBeHidden()
    await page.reload(); await expect(row(page, id)).toContainText(withKey ? 'API キー：登録済み' : 'API キー：未登録')
    const after = await snapshot(page)
    expect(after.providers[id].models).toEqual([
      { ...enriched.value.value.providers[id].models[0], name: '編集したモデル' },
      { id: `${id}-second`, input: [], compat: { chatTemplateArgs: {}, chatTemplateKwargs: {} } },
    ])
    expect(after.providers[id].extraField).toEqual({ retained: true })
    expect(after.providers[id].apiKeyEnv).toBe(saved.providers[id].apiKeyEnv)
    expect(after.default).toEqual(before.default)
    for (const [other, value] of Object.entries(saved.providers)) if (other !== id) expect(after.providers[other]).toEqual(value)
  }
  await button(page, '戻る').click()
  await page.locator('m3e-nav-item').filter({ hasText: '設定' }).click()
  await page.locator('m3e-list-action').filter({ hasText: 'モデル' }).first().click()
  await page.locator('m3e-select[aria-label="モデル"]').click()
  await expect(page.locator('m3e-option').filter({ hasText: 'i16-keyless-second' }).last()).toBeVisible()
  expect((await snapshot(page)).default).toEqual(before.default)
})

test('I16 real failures: 別ページの競合と設定だけ成功したキー保存を確認する', async ({ page, context, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  await create(page, 'i16-conflict', false)
  await row(page, 'i16-conflict').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('表示名（任意）', { exact: true }).fill('送らない下書き')
  const second = await context.newPage(); await instrument(second)
  await second.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  await expect(row(second, 'i16-conflict')).toBeVisible()
  const result = await second.evaluate(async () => {
    const remote = (window as any).__customRemote
    const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-pi-ai')
    return remote.settings.mutate(ns.ns, [{ op: 'set', path: ['providers', 'i16-conflict', 'baseURL'], value: 'http://localhost:4567/v1' },
      { op: 'set', path: ['providers', 'i16-conflict', 'apiKeyEnv'], value: 'DEEPSEEK_API_KEY' }], ns.revision)
  })
  expect(result.ok).toBe(true)
  await expect(form(page).getByRole('alert')).toHaveText('ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。')
  await expect(button(page, '保存')).toBeDisabled()
  expect((await snapshot(page)).providers['i16-conflict'].displayName).toBeUndefined()
  await button(page, '再読み込み').click()
  await expect(page.getByLabel('ベース URL', { exact: true })).toHaveValue('http://localhost:4567/v1')
  await page.getByLabel('表示名（任意）', { exact: true }).fill('設定だけ成功')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-rejected-key')
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('提供元の設定は保存しましたが、API キーを保存できませんでした。入力し直してください。')
  const saved = await snapshot(page)
  expect(saved.providers['i16-conflict'].displayName).toBe('設定だけ成功')
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-retry')
  await button(page, 'API キーを保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('提供元の設定は保存しましたが、API キーを保存できませんでした。入力し直してください。')
  expect((await snapshot(page)).revision).toBe(saved.revision)
  await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await row(page, '設定だけ成功').getByRole('button', { name: '編集', exact: true }).click()
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  await second.close()
})
