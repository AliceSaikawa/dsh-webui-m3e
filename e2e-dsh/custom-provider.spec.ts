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
            return { ...exported, apply(ctx: any) {
              const result = apply(ctx), w = window as any
              w.__customRemote = ctx.root.remote
              w.__settingsWrites = []
              w.__heldSettings = []
              w.__keySends = 0
              const prototype = Object.getPrototypeOf(ctx.root.remote)
              const subscribe = prototype.$on, invoke = prototype.invoke
              prototype.$on = function(event: string, listener: (...args: any[]) => unknown) {
                return subscribe.call(this, event, (...args: any[]) => {
                  if ((event === 'settings/document-updated' && w.__holdSettings) || (w.__holdProviders && event.endsWith('-updated'))) w.__heldSettings.push(() => listener(...args))
                  else return listener(...args)
                })
              }
              prototype.invoke = async function(...args: any[]) {
                const descriptor = args[0]
                const write = descriptor.namespace === 'settings' && ['mutate', 'update'].includes(descriptor.method)
                  ? { method: descriptor.method, revision: args[4][2], ops: args[4][1], code: 'pending' } : undefined
                if (write) w.__settingsWrites.push(write)
                // Count only; the submitted value is never recorded.
                if (descriptor.namespace === 'credentials' && descriptor.method === 'set') w.__keySends++
                const answer = await invoke.apply(this, args)
                if (write) write.code = answer.ok ? 'ok' : answer.error.code
                // The Host has applied the write; only this page's response waits.
                if (write && w.__holdWriteResponse) { w.__holdWriteResponse = false; await new Promise<void>(resolve => { w.__releaseWrite = resolve }) }
                return answer
              }
              return result
            } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: next => { load = next.bind(value) } })
      },
    })
  })
}
const form = (page: Page) => page.locator('.custom-provider-form')
const row = (page: Page, id: string) => page.getByRole('group', { name: id, exact: true })
async function create(page: Page, id: string, withKey: boolean, status = withKey ? 'API キー：登録済み' : 'API キー：未設定') {
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill(id)
  await page.getByLabel('ベース URL', { exact: true }).fill('http://127.0.0.1:12345/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill(`${id}-model`)
  if (withKey) await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-integration-only')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await expect(row(page, id)).toContainText(status)
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

async function namedReference(page: Page, id: string, ref?: string) {
  const result = await page.evaluate(async ({ id, ref }) => {
    const remote = (window as any).__customRemote
    const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-pi-ai')
    return remote.settings.mutate(ns.ns, [ref === undefined
      ? { op: 'unset', path: ['providers', id, 'apiKeyEnv'] }
      : { op: 'set', path: ['providers', id, 'apiKeyEnv'], value: ref }], ns.revision)
  }, { id, ref })
  expect(result.ok).toBe(true)
}

test('I16 real notification: 別ページの通知だけで編集中の保存を無効にする', async ({ page, context, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  await create(page, 'i16-notification', false)
  const second = await context.newPage(); await instrument(second)
  await second.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  await expect(row(second, 'i16-notification')).toBeVisible()
  await row(page, 'i16-notification').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('表示名（任意）', { exact: true }).fill('通知前の下書き')
  await page.evaluate(() => { (window as any).__settingsWrites = [] })
  await namedReference(second, 'i16-notification', 'I16_NOTIFICATION_API_KEY')
  const foreign = await snapshot(second)
  // No save click: this assertion must depend on the update notification.
  await expect(form(page).getByRole('alert')).toHaveText('ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。')
  await expect(button(page, '保存')).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__settingsWrites)).toEqual([])
  expect(await snapshot(page)).toEqual(foreign)
  await second.close()
})

test('I16 real destinations: フォームの追加と編集の衝突で既存の登録状態を変えない', async ({ page, context, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  await create(page, 'i16-reserved-owner', false)
  await namedReference(page, 'i16-reserved-owner', 'I16_RESERVED_API_KEY')
  const second = await context.newPage(); await instrument(second)
  await second.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  await expect(row(second, 'i16-reserved-owner')).toContainText('API キー：未登録')
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('i16-reserved')
  await page.getByLabel('ベース URL', { exact: true }).fill('http://localhost:12345')
  await page.getByLabel('モデル ID', { exact: true }).fill('collision-model')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-must-not-register-owner')
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toContainText('別の提供元とキーの参照名が重なります')
  expect((await snapshot(second)).providers['i16-reserved']).toBeUndefined()
  await second.reload(); await expect(row(second, 'i16-reserved-owner')).toContainText('API キー：未登録')
  await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await create(page, 'i16-reserved', false)
  await expect(row(page, 'i16-reserved')).toContainText('API キーは「編集」から登録できます。')
  await expect(row(page, 'i16-reserved').getByRole('button', { name: 'API キー', exact: true })).toHaveCount(0)
  await expect(row(page, 'i16-reserved-owner').getByRole('button', { name: 'API キー', exact: true })).toBeEnabled()
  await row(page, 'i16-reserved').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-edit-must-not-register-owner')
  const foreign = await snapshot(second)
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toContainText('参照名が重なります')
  await expect(form(page).getByRole('alert')).toContainText('I16_RESERVED_API_KEY')
  await expect(form(page).getByRole('alert')).toContainText('my-i16-reserved')
  expect(await snapshot(second)).toEqual(foreign)
  await second.reload(); await expect(row(second, 'i16-reserved-owner')).toContainText('API キー：未登録')
  await expect(row(second, 'i16-reserved-owner').getByRole('button', { name: 'API キー', exact: true })).toBeEnabled()
  expect((await snapshot(second)).providers['i16-reserved'].apiKeyEnv).toBeUndefined()
  await second.close()
})

test('I16 real case N09: 大小文字だけ違う明示参照の登録を分離する', async ({ page, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  await create(page, 'i16-case-lower', false); await create(page, 'i16-case-upper', false)
  await namedReference(page, 'i16-case-lower', 'i16_case_api_key')
  await namedReference(page, 'i16-case-upper', 'I16_CASE_API_KEY')
  for (const id of ['i16-case-lower', 'i16-case-upper']) {
    await row(page, id).getByRole('button', { name: 'API キー', exact: true }).click()
    await page.getByLabel('API キー', { exact: true }).fill('fake-case-only')
    await button(page, '保存').click()
    await expect(page.locator('.settings-sheet')).toBeHidden()
    await expect(row(page, id)).toContainText('API キー：登録済み')
    if (id === 'i16-case-lower') await expect(row(page, 'i16-case-upper')).toContainText('API キー：未登録')
  }
  await row(page, 'i16-case-lower').getByRole('button', { name: 'API キー', exact: true }).click()
  await button(page, '登録を消す').click()
  await button(page, '登録を消す').click()
  await expect(row(page, 'i16-case-lower')).toContainText('API キー：未登録')
  await expect(row(page, 'i16-case-upper')).toContainText('API キー：登録済み')
})

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
    await page.reload(); await expect(row(page, id)).toContainText(withKey ? 'API キー：登録済み' : 'API キー：未設定')
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
  const opened = await snapshot(page)
  await page.evaluate(() => { (window as any).__holdSettings = true; (window as any).__settingsWrites = [] })
  const second = await context.newPage(); await instrument(second)
  await second.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  await expect(row(second, 'i16-conflict')).toBeVisible()
  const result = await second.evaluate(async () => {
    const remote = (window as any).__customRemote
    const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-pi-ai')
    return remote.settings.mutate(ns.ns, [{ op: 'set', path: ['providers', 'i16-conflict', 'baseURL'], value: 'http://localhost:4567/v1' },
      { op: 'set', path: ['providers', 'i16-conflict', 'apiKeyEnv'], value: 'M3E_DSH_VERSION' }], ns.revision)
  })
  expect(result.ok).toBe(true)
  const foreign = await snapshot(second)
  await expect.poll(() => page.evaluate(() => (window as any).__heldSettings.length)).toBeGreaterThan(0)
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。')
  await expect(button(page, '保存')).toBeDisabled()
  expect(await snapshot(page)).toEqual(foreign)
  expect(await page.evaluate(() => (window as any).__settingsWrites)).toEqual([{
    method: 'mutate', revision: opened.revision, code: 'settings/conflict',
    ops: [{ op: 'set', path: ['providers', 'i16-conflict', 'displayName'], value: '送らない下書き' }],
  }])
  await page.evaluate(() => { const w = window as any; w.__holdSettings = false; w.__heldSettings.splice(0).forEach((deliver: () => void) => deliver()) })
  await button(page, '再読み込み').click()
  await expect(page.getByLabel('ベース URL', { exact: true })).toHaveValue('http://localhost:4567/v1')
  await page.getByLabel('表示名（任意）', { exact: true }).fill('設定だけ成功')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-rejected-key')
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('提供元の設定は保存しましたが、API キーを保存できませんでした。 設定が変わったか、このキーは変更できません。入力画面を開き直してください。')
  const saved = await snapshot(page)
  const writesBeforeRetry = await page.evaluate(() => (window as any).__settingsWrites)
  expect(writesBeforeRetry).toHaveLength(2)
  expect(saved.providers['i16-conflict'].displayName).toBe('設定だけ成功')
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-retry')
  await button(page, 'API キーを保存').click()
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  // Observe either completion or a forbidden settings request, including a
  // no-op request whose Host response has not arrived yet.
  await expect.poll(async () => (await page.evaluate(() => (window as any).__settingsWrites.length)) > writesBeforeRetry.length
    || await page.getByLabel('API キー（任意）', { exact: true }).isEnabled()).toBe(true)
  expect(await page.evaluate(() => (window as any).__settingsWrites)).toEqual(writesBeforeRetry)
  await expect(button(page, 'API キーを保存')).toBeVisible()
  await expect(button(page, 'API キーを保存')).toBeDisabled()
  await expect(form(page).getByRole('alert')).toHaveText('提供元の設定は保存しましたが、API キーを保存できませんでした。 設定が変わったか、このキーは変更できません。入力画面を開き直してください。')
  expect((await snapshot(page)).revision).toBe(saved.revision)
  expect(await snapshot(page)).toEqual(saved)
  expect(await page.evaluate(() => (window as any).__settingsWrites)).toEqual(writesBeforeRetry)
  await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await row(page, '設定だけ成功').getByRole('button', { name: '編集', exact: true }).click()
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  await second.close()
})

test('I16 real numeric ID: 数字始まりをキーなしで追加した後も既存のキーを登録削除できる', async ({ page, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  const existing = page.locator('m3e-list-action').filter({ hasText: /DeepSeek/ })
  await expect(existing).toContainText('API キー：登録済み')
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('1-i16-api')
  await page.getByLabel('ベース URL', { exact: true }).fill('http://127.0.0.1:12345/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill('numeric-model')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-invalid-ref')
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('キーの参照名が DSH の形式に合わないため、この提供元には API キーを登録できません。')
  expect((await snapshot(page)).providers['1-i16-api']).toBeUndefined()
  await page.getByLabel('API キー（任意）', { exact: true }).fill('')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await expect(row(page, '1-i16-api')).toContainText('API キー：未設定')
  await expect(row(page, '1-i16-api').getByRole('button', { name: 'API キー', exact: true })).toHaveCount(0)
  await expect(existing).toContainText('API キー：登録済み')
  await page.reload(); await expect(existing).toContainText('API キー：登録済み')
  const previous = await page.evaluate(async () => {
    const remote = (window as any).__customRemote
    const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-deepseek')
    const prior = ns.user?.apiKeyEnv
    const result = await remote.settings.mutate(ns.ns, [{ op: 'set', path: ['apiKeyEnv'], value: 'I16_EXISTING_API_KEY' }], ns.revision)
    if (!result.ok) throw new Error('設定できません')
    return prior ?? null
  })
  try {
    await expect(existing).toContainText('API キー：未登録')
    // G1: a standard row naming its reference shows exactly what main shows.
    await expect(existing.locator('span[slot="supporting-text"]')).toHaveText('API キー：未登録')
    await expect(existing).toHaveJSProperty('disabled', false)
    await existing.click()
    await page.getByLabel('API キー', { exact: true }).fill('synthetic-existing-after-numeric')
    await button(page, '保存').click()
    await expect(existing).toContainText('API キー：登録済み')
    await existing.click()
    await expect(page.getByLabel('API キー', { exact: true })).toHaveValue('')
    await button(page, '登録を消す').click(); await button(page, '登録を消す').click()
    await expect(existing).toContainText('API キー：未登録')
    await row(page, '1-i16-api').getByRole('button', { name: '編集', exact: true }).click()
    await expect(form(page)).toContainText('キーを空欄にすると、設定だけ保存できます。')
    await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
    await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  } finally {
    expect(await page.evaluate(async previous => {
      const remote = (window as any).__customRemote
      const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-deepseek')
      return (await remote.settings.mutate(ns.ns, [previous === null ? { op: 'unset', path: ['apiKeyEnv'] } : { op: 'set', path: ['apiKeyEnv'], value: previous }], ns.revision)).ok
    }, previous)).toBe(true)
  }
})

test('I16 real late registration: 設定の保存中に別の名前空間で登録された名前へキーを送らない', async ({ page, context, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  const second = await context.newPage(); await instrument(second)
  await second.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  await expect(second.locator('m3e-list-action').filter({ hasText: /DeepSeek/ })).toBeVisible()
  const registered = () => second.evaluate(async () => {
    const answer = await (window as any).__customRemote.credentials.describe(['I16_LATE_API_KEY'])
    if (!answer.ok) throw new Error('照会できません')
    return answer.value.I16_LATE_API_KEY.configured
  })
  const keySends = () => page.evaluate(() => (window as any).__keySends)
  const message = '提供元の設定は保存しましたが、API キーを保存できませんでした。 設定を保存する間に、この参照名のキーが登録されました。上書きを避けるため、API キーを送信していません。 この保存で付けた参照名を、この提供元の設定から外しました。登録済みのキーは、この提供元には使われません。この提供元の API キーは未設定です。キーを使うには、ほかと重ならない ID で追加し直してください。'
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('i16-late')
  await page.getByLabel('ベース URL', { exact: true }).fill('http://127.0.0.1:12345/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill('late-model')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-form-key')
  expect(await registered()).toBe(false)
  await page.evaluate(() => { const w = window as any; w.__holdWriteResponse = true; w.__keySends = 0 })
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseWrite)).toBe('function')
  // The first page found the destination unregistered and its settings write is
  // applied. Another namespace's provider names the same reference and
  // registers its own key before the first page sends one.
  const previous = await second.evaluate(async () => {
    const remote = (window as any).__customRemote
    const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-deepseek')
    const prior = ns.user?.apiKeyEnv
    if (!(await remote.settings.mutate(ns.ns, [{ op: 'set', path: ['apiKeyEnv'], value: 'I16_LATE_API_KEY' }], ns.revision)).ok) throw new Error('設定できません')
    if (!(await remote.credentials.set('I16_LATE_API_KEY', 'synthetic-other-owner')).ok) throw new Error('登録できません')
    return prior ?? null
  })
  try {
    expect(await registered()).toBe(true)
    await page.evaluate(() => (window as any).__releaseWrite())
    await expect(form(page).getByRole('alert')).toHaveText(message)
    expect(await keySends()).toBe(0)
    // The form took the name it assigned back out on the real Host.
    expect((await snapshot(second)).providers['i16-late'].apiKeyEnv).toBeUndefined()
    expect((await snapshot(second)).providers['i16-late'].baseURL).toBe('http://127.0.0.1:12345/v1')
    expect(await registered()).toBe(true)
    expect(await second.evaluate(async () => (await (window as any).__customRemote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-deepseek').value.apiKeyEnv)).toBe('I16_LATE_API_KEY')
    await expect(page.getByLabel('API キー（任意）', { exact: true })).toBeDisabled()
    await expect(form(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(row(page, 'i16-late')).toContainText('API キー：未設定')
    await expect(row(page, 'i16-late').getByRole('button', { name: 'API キー', exact: true })).toHaveCount(0)
    // Reopened, the name belongs to the other provider: stopped before any write.
    await row(page, 'i16-late').getByRole('button', { name: '編集', exact: true }).click()
    await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-form-reopened')
    await button(page, '保存').click()
    await expect(form(page).getByRole('alert')).toContainText('参照名が重なります')
    expect(await keySends()).toBe(0)
    expect(await registered()).toBe(true)
    await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  } finally {
    expect(await second.evaluate(async previous => {
      const remote = (window as any).__customRemote
      const removed = await remote.credentials.unset('I16_LATE_API_KEY')
      const ns = (await remote.settings.describe()).value.namespaces.find((n: any) => n.ns === 'llm-deepseek')
      const restored = await remote.settings.mutate(ns.ns, [previous === null ? { op: 'unset', path: ['apiKeyEnv'] } : { op: 'set', path: ['apiKeyEnv'], value: previous }], ns.revision)
      return removed.ok && restored.ok
    }, previous)).toBe(true)
  }
  await second.close()
})

test('I16 real list destination G3: 一覧が導出名を使う標準の行と重なる名前を新しく付けない', async ({ page, integration }) => {
  await instrument(page); await openM3e(page, integration.host, '/settings/providers')
  // On main the list derives OPENAI_CODEX_API_KEY for the inactive catalog route openai-codex.
  const standard = page.locator('m3e-list-action').filter({ hasText: 'openai-codex' })
  await expect(standard).toContainText('API キー：未登録')
  const before = await snapshot(page)
  await button(page, 'カスタムプロバイダーを追加').click()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('OpenAI-Codex')
  await page.getByLabel('ベース URL', { exact: true }).fill('http://127.0.0.1:12345/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill('codex-model')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('synthetic-collision')
  await page.evaluate(() => { (window as any).__keySends = 0; (window as any).__settingsWrites = [] })
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toContainText('参照名「OPENAI_CODEX_API_KEY」：別の提供元とキーの参照名が重なります。')
  expect(await page.evaluate(() => (window as any).__keySends)).toBe(0)
  expect(await page.evaluate(() => (window as any).__settingsWrites.length)).toBe(0)
  expect((await snapshot(page)).providers).toEqual(before.providers)
  await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(standard).toContainText('API キー：未登録')
})
