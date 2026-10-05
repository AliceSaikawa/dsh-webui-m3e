import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { SettingsApi } from '../web/src/features/settings/store.ts'
import type { ModelCatalog, PermissionCatalog } from '../web/src/features/composer/api.ts'
import type { RemoteResult, ISessions, DshServices } from '../web/src/dsh/services.ts'
import type { WorkspaceFilesRemote, WorkspaceFileWatchFrame } from '../web/src/features/session-tools/files.ts'
import { test, expect, button, openM3e } from './fixtures.ts'
import { root } from './dsh-host.ts'
import { autoPresetControl, pagedPng } from './rpc-audit.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { decodeSchema, type SchemaNode } from '../web/src/features/settings/schema.ts'
import { settingsWriteCases, dictionaryKeyCases } from '../tests/support/settings-write-cases.ts'
import { expectedWrites, runSettingWrites } from '../tests/support/settings-writes.ts'
import { expectedSchemaShape } from '../tests/support/settings-schema.ts'

function publicShape(node: SchemaNode): unknown {
  return {
    type: node.type, value: node.value,
    meta: Object.fromEntries(['required', 'min', 'max', 'step', 'pattern'].filter(key => node.meta?.[key as keyof NonNullable<SchemaNode['meta']>] !== undefined).map(key => [key, node.meta![key as keyof NonNullable<SchemaNode['meta']>]])),
    dict: node.dict && Object.fromEntries(Object.entries(node.dict).map(([key, child]) => [key, publicShape(child)])),
    list: node.list?.map(publicShape), inner: node.inner && publicShape(node.inner), sKey: node.sKey && publicShape(node.sKey),
  }
}

type Rpc = {
  $on(event: string, listener: (...args: unknown[]) => unknown): () => void
  settings: SettingsApi
  session: { modelCatalog(): Promise<RemoteResult<ModelCatalog>> }
  permissionPresets: { catalog(): Promise<RemoteResult<PermissionCatalog>> }
  workspaceFiles: WorkspaceFilesRemote
}
declare global { interface Window {
  __rpcReview: { remote: Rpc; sessions: ISessions; workspaces: DshServices['workspaces'] }
  __rpcWatch?: { handle: ReturnType<WorkspaceFilesRemote['changes']>; iterator: AsyncIterator<WorkspaceFileWatchFrame> }
  __rpcDelivered: string[]
  __rpcSubscriptions: { event: string; active: boolean }[]
} }

/** Capture the real controller's public remote; every call still reaches DSH. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    type Context = Window['__rpcReview'] & { root: Window['__rpcReview'] }
    type Plugin = { id: string; factory: (require: unknown) => { apply?: (ctx: Context) => unknown } }
    type Loader = { load(plugin: Plugin): unknown }
    let facade: Loader
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => facade,
      set(value: Loader) {
        facade = value
        let load = value.load.bind(value)
        const observe = (plugin: Plugin) => plugin.id !== '@deepseek-ai/dsh-api-session-controller' ? load(plugin) : load({
          ...plugin, factory(require) {
            const exported = plugin.factory(require)
            const apply = exported.apply!
            return { ...exported, apply(ctx: Context) {
              const result = apply(ctx)
              window.__rpcReview = ctx.root
              window.__rpcDelivered = []
              window.__rpcSubscriptions = []
              const prototype = Object.getPrototypeOf(ctx.root.remote) as Rpc
              const subscribe = prototype.$on
              prototype.$on = function(event, listener) {
                const subscription = { event, active: true }
                window.__rpcSubscriptions.push(subscription)
                const off = subscribe.call(this, event, (...args) => {
                  window.__rpcDelivered.push(event)
                  return listener(...args)
                })
                return () => { subscription.active = false; off() }
              }
              return result
            } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: (next: Loader['load']) => { load = next.bind(value) } })
      },
    })
  })
}

const action = (page: Page, name: string | RegExp) => page.locator('m3e-list-action').filter({ hasText: name })

async function setup(page: Page, host: Parameters<typeof openM3e>[1], hash = '/settings') {
  await instrument(page)
  await openM3e(page, host, hash)
}
async function createWorkspace(page: Page, host: Parameters<typeof openM3e>[1], name: string) {
  const path = join(host.workspace, name)
  mkdirSync(path, { recursive: true })
  const workspaceId = await page.evaluate(async path => (await window.__rpcReview.workspaces.create({ path })).workspaceId, path)
  return { path, workspaceId }
}
async function setValue(page: Page, ns: string, path: string[], value?: string | number) {
  return page.evaluate(async ({ ns, path, value }) => {
    const api = window.__rpcReview.remote.settings
    const description = await api.describe()
    if (!description.ok) throw new Error(description.error.message)
    const row = description.value.namespaces.find(row => row.ns === ns)!
    const response = await api.mutate(ns, [value === undefined ? { op: 'unset', path } : { op: 'set', path, value }], row.revision)
    if (!response.ok) throw new Error(response.error.message)
  }, { ns, path, value })
}

function fileVersion(path: string): string {
  const stat = statSync(path, { bigint: true })
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

async function expectWatchedChange(page: Page, sessionId: string, target: string, absolutePath: string, mutate: () => void) {
  try {
    const ready = await page.evaluate(async ({ sessionId, target }) => {
      const handle = window.__rpcReview.remote.workspaceFiles.changes(sessionId, target)
      const iterator = handle[Symbol.asyncIterator]()
      window.__rpcWatch = { handle, iterator }
      return iterator.next()
    }, { sessionId, target })
    expect(ready).toEqual({ done: false, value: { kind: 'ready' } })
    const before = fileVersion(absolutePath)
    mutate()
    const expected = { absolutePath, version: fileVersion(absolutePath) }
    expect(expected.version, '監視対象の状態を変える操作が必要').not.toBe(before)
    // ready starts watching; it does not flush earlier filesystem notifications.
    // Keep pulling queued frames until the independently measured post-write version.
    const observed = await page.evaluate(async version => {
      const { iterator } = window.__rpcWatch!
      for (;;) {
        const { value, done } = await iterator.next()
        if (done) throw new Error('操作後の版を通知する前に監視が終了しました')
        if (value.kind === 'change' && 'version' in value.change && value.change.version === version) return value.change
      }
    }, expected.version)
    expect(observed).toEqual(expected)
  } finally {
    await page.evaluate(() => {
      window.__rpcWatch?.handle.dispose()
      delete window.__rpcWatch
    })
  }
}

test('S5 設定一覧とシェル設定を実 DSH に保存し再読込できる', async ({ page, integration }) => {
  await setup(page, integration.host)
  const description = await page.evaluate(async () => {
    const result = await window.__rpcReview.remote.settings.describe()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  writeFileSync(join(root, 'tmp/s5-public-settings.json'), JSON.stringify(description, null, 2))
  for (const fixture of settingsFixtures().filter(row => row.ns !== 'example-extension')) {
    const actual = description.namespaces.find(row => row.ns === fixture.ns)!
    expect(actual, fixture.ns).toBeDefined()
    expect(publicShape(decodeSchema(actual.schema)), fixture.ns).toEqual(expectedSchemaShape(fixture.schema))
    expect(fixture.autoGenerate, fixture.ns).toBe(actual.autoGenerate)
    // These two mock routes deliberately configure its scripted provider directory.
    if (!['agent-default-model', 'llm-pi-ai'].includes(fixture.ns)) expect(fixture.value, fixture.ns).toEqual(actual.value)
  }
  for (const title of ['モデル', '権限', 'エージェント', '提供元と API キー', 'Web 検索とシェル']) await expect(action(page, title).first()).toBeVisible()
  await action(page, 'Web 検索とシェル').click()
  const shell = page.locator('.settings-namespace').filter({ has: page.getByRole('heading', { name: 'シェル', exact: true }) })
  const timeout = shell.getByLabel('待機時間', { exact: true })
  await expect(timeout).toHaveValue('60000')
  try {
    await timeout.fill('61000')
    await timeout.blur()
    await expect(shell.getByText('保存しました', { exact: true })).toBeVisible()
    await page.reload()
    await expect(timeout).toHaveValue('61000')
    const rejected = await page.evaluate(async () => {
      const api = window.__rpcReview.remote.settings
      const result = await api.describe()
      if (!result.ok) throw new Error(result.error.message)
      const row = result.value.namespaces.find(row => row.ns === 'permission')!
      return Promise.all([{ presets: {} }, { timeout: 60 }].map(async patch => {
        const response = await api.update('permission', patch, row.revision)
        return response.ok ? { ok: true } : { ok: false, code: response.error.code }
      }))
    })
    expect(rejected).toEqual([{ ok: false, code: 'settings/rejected' }, { ok: false, code: 'settings/rejected' }])
  } finally { await setValue(page, 'bash-sandbox', ['timeoutMs']) }
})

test('S5 設定の35入力と辞書キー2入力を実DSHへ書き込み受理と拒否を確認する', async ({ page, integration }, info) => {
  await setup(page, integration.host)
  const api: SettingsApi = {
    describe: () => page.evaluate(() => window.__rpcReview.remote.settings.describe()),
    update: (ns, patch, revision) => page.evaluate(async ({ ns, patch, revision }) => {
      const result = await window.__rpcReview.remote.settings.update(ns, patch, revision)
      // RemoteError fields are accessors; project them before crossing Playwright's bridge.
      return result.ok ? result : { ok: false as const, error: { code: result.error.code, message: result.error.message, details: result.error.details } }
    }, { ns, patch, revision }),
    mutate: (ns, ops, revision) => page.evaluate(async ({ ns, ops, revision }) => {
      const result = await window.__rpcReview.remote.settings.mutate(ns, ops, revision)
      return result.ok ? result : { ok: false as const, error: { code: result.error.code, message: result.error.message, details: result.error.details } }
    }, { ns, ops, revision }),
  }
  const cases = [...settingsWriteCases, ...dictionaryKeyCases]
  const outcomes = await runSettingWrites(api, cases)
  writeFileSync(join(root, 'tmp/stage5-fix3-real-writes.json'), JSON.stringify(outcomes, null, 2))
  await info.attach('settings-write-outcomes', { body: JSON.stringify(outcomes), contentType: 'application/json' })
  expect(outcomes).toEqual(expectedWrites(cases))
})

test('S5 モデルと提供元は実物の一覧を表示し環境由来のキーは変更できない', async ({ page, integration }) => {
  await setup(page, integration.host, '/settings/models')
  const model = page.locator('m3e-select[aria-label="モデル"]')
  await expect(model).toHaveJSProperty('disabled', false)
  await model.click()
  await expect(page.locator('m3e-option').filter({ hasText: /^DeepSeek \/ DeepSeek-V41-Flash$/ }).last()).toBeVisible()
  await expect(page.locator('m3e-option').filter({ hasText: /^DeepSeek \/ DeepSeek-V4-Pro$/ }).last()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto(`${integration.host.origin}/m3e/#/settings/providers`)
  const provider = action(page, /DeepSeek/)
  await expect(provider).toHaveCount(1)
  await expect(provider).toContainText('API キー：登録済み（変更できません）')
  await expect(provider).toHaveJSProperty('disabled', true)
  await expect(page.getByText('DeepSeek Account', { exact: true })).toHaveCount(0)
  await expect(page.locator('.settings-namespace')).toHaveCount(0)
})

test('S5 カタログの権限を既定に保存し新規会話へ適用して切り替える', async ({ page, integration }) => {
  const auto = await autoPresetControl(integration.host)
  await setup(page, integration.host, '/settings/permission')
  const select = page.locator('m3e-select[aria-label="新しい会話の権限"]')
  await expect(select).toHaveJSProperty('disabled', false)
  try {
    await select.click()
    await page.locator('m3e-option').filter({ hasText: /^read-only$/ }).last().click()
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    await page.reload()
    await expect(select).toHaveJSProperty('value', '0')
    const { workspaceId } = await createWorkspace(page, integration.host, 'rpc-permissions')
    await page.goto(`${integration.host.origin}/m3e/#/new?ws=${encodeURIComponent(workspaceId)}`)
    await expect(page.locator('.composer-permission')).toContainText('read-only')
    await page.getByLabel('メッセージ入力欄').fill('権限 RPC の確認')
    await button(page, '送信').click()
    await expect(page).toHaveURL(/#\/s\/[^/]+$/)
    await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
    await expect(page.locator('.composer-permission')).toContainText('read-only')
    await page.locator('.composer-permission').click()
    await expect(button(page, 'workspace-write')).toBeVisible()
    await expect(button(page, 'danger-full-access')).toBeVisible()
    await button(page, 'workspace-write').click()
    await expect(page.locator('.composer-permission')).toContainText('workspace-write')
    await page.reload()
    await expect(page.locator('.composer-permission')).toContainText('workspace-write')
    await page.locator('.composer-permission').click()
    await expect(button(page, 'auto')).toHaveCount(0)
    auto.set(true)
    await expect.poll(auto.acknowledged).toBe('on')
    await expect(button(page, 'auto')).toBeVisible()
    auto.set(false)
    await expect.poll(auto.acknowledged).toBe('off')
    await expect(button(page, 'auto')).toHaveCount(0)
  } finally {
    try { await setValue(page, 'permission', ['defaultPreset']) }
    finally { auto.restore() }
  }
})

test('S5 会話のファイル一覧・テキスト・画像を実ワークスペースから読む', async ({ page, integration }, info) => {
  const imageReads: unknown[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/workspaceFiles/readBytes') {
      const args = request.postDataJSON().payload.args
      if (args.path === 'preview.png') imageReads.push(args.options)
    }
  })
  await setup(page, integration.host)
  const { path, workspaceId } = await createWorkspace(page, integration.host, 'rpc-files')
  writeFileSync(join(path, 'rpc.txt'), 'M3E RPC ファイル確認\n2 行目')
  const png = pagedPng()
  expect(png.length).toBeGreaterThan(256 * 1024)
  writeFileSync(join(path, 'preview.png'), png)
  const sessionId = await page.evaluate(workspaceId => window.__rpcReview.sessions.create({ workspaceId }), workspaceId)
  await info.attach('remote-identity', { body: String(await page.evaluate(() => window.__rpcReview.remote.workspaceFiles === window.__rpcReview.remote.workspaceFiles)), contentType: 'text/plain' })
  await page.goto(`${integration.host.origin}/m3e/#/s/${sessionId}`)
  await button(page, '会話のメニュー').click()
  await page.locator('m3e-menu-item').filter({ hasText: 'ファイル' }).click()
  await expect(action(page, 'rpc.txt')).toBeVisible()
  await expect(action(page, 'preview.png')).toBeVisible()
  await action(page, 'rpc.txt').click()
  await expect(page.locator('.session-file-text')).toHaveText('M3E RPC ファイル確認\n2 行目')
  await button(page, '戻る').click()
  await action(page, 'preview.png').click()
  await expect(page.locator('.session-file-image')).toBeVisible()
  const displayed = await page.locator('.session-file-image').evaluate(async image => [...new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer())])
  await info.attach('expected-image', { body: png, contentType: 'image/png' })
  await info.attach('displayed-image', { body: Buffer.from(displayed), contentType: 'image/png' })
  expect(Buffer.from(displayed).equals(png)).toBe(true)
  await expect.poll(() => page.locator('.session-file-image').evaluate(image => [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight])).toEqual([384, 256])
  expect(imageReads).toEqual([{ range: { offset: 0, length: 262144 } }, { range: { offset: 262144, length: 262144 } }])
  const bytes = await page.evaluate(async sessionId => {
    const remote = window.__rpcReview.remote.workspaceFiles
    const result = await remote.readBytes(sessionId, 'rpc.txt', { range: { offset: 0, length: 3 } })
    if (!result.ok) throw new Error(result.error.message)
    return { native: result.value.data instanceof Uint8Array, data: [...result.value.data], offset: result.value.offset, eof: result.value.eof }
  }, sessionId)
  expect(bytes).toEqual({ native: true, data: [77, 51, 69], offset: 0, eof: false })
})

test('S5 実 DSH の対象パス監視とバイト範囲の検証を確認する', async ({ page, integration }) => {
  await setup(page, integration.host)
  const { path, workspaceId } = await createWorkspace(page, integration.host, 'rpc-watch')
  writeFileSync(join(path, 'watched.txt'), 'before')
  const sessionId = await page.evaluate(workspaceId => window.__rpcReview.sessions.create({ workspaceId }), workspaceId)
  const legacy = await page.evaluate(async sessionId => {
    const response = await window.__rpcReview.remote.workspaceFiles.readBytes(sessionId, 'watched.txt',
      // @ts-expect-error Deliberately use the removed 0.1.5 argument shape.
      { offset: 0, length: 3 })
    if (!response.ok) throw new Error(response.error.message)
    return { text: new TextDecoder().decode(response.value.data), eof: response.value.eof }
  }, sessionId)
  // DSH ignores the obsolete flat options and reads the whole file; callers must use range.
  expect(legacy).toEqual({ text: 'before', eof: true })
  const rejected = await page.evaluate(async sessionId => {
    const response = await window.__rpcReview.remote.workspaceFiles.readBytes(sessionId, 'watched.txt', { range: { offset: -1 } })
    return response.ok ? { ok: true } : { ok: false, code: response.error.code }
  }, sessionId)
  expect(rejected).toEqual({ ok: false, code: 'gateway/bad-request' })
  await expectWatchedChange(page, sessionId, 'watched.txt', join(path, 'watched.txt'), () => {
    writeFileSync(join(path, 'watched.txt'), 'after')
  })
  await expectWatchedChange(page, sessionId, '.', path, () => {
    writeFileSync(join(path, 'new-child.txt'), 'new file')
  })
})

test('S5 隔離した DSH の提供元に偽の API キーを登録して削除する', async ({ page, integration }, info) => {
  await setup(page, integration.host, '/settings/providers')
  // Switch only this isolated profile to a fresh reference; the process key remains intact.
  await setValue(page, 'llm-deepseek', ['apiKeyEnv'], 'M3E_INTEGRATION_API_KEY')
  const writer = await page.context().newPage()
  try {
    const provider = action(page, /DeepSeek/)
    await expect(provider).toContainText('API キー：未登録')
    await expect(provider).toHaveJSProperty('disabled', false)
    // The stock Models client registers this additional invalidation too.
    // Key writes in this Host emit reference-updated; prove the other active
    // registration independently, without inventing a record-updated payload.
    expect(await page.evaluate(() => window.__rpcSubscriptions.filter(row => row.active && row.event.endsWith('/record-updated')).length)).toBe(1)
    await setup(writer, integration.host, '/settings/providers')
    await page.evaluate(() => { window.__rpcDelivered = [] })
    const writerProvider = action(writer, /DeepSeek/)
    await writerProvider.click()
    await writer.getByLabel('API キー', { exact: true }).fill('fake-key-for-m3e-integration-2')
    await button(writer, '保存').click()
    await expect(writerProvider).toContainText('API キー：登録済み')
    // The reader stays mounted; its own save/reload path cannot refresh it.
    await expect(provider).toContainText('API キー：登録済み')
    await info.attach('key-save-delivered-events', { body: JSON.stringify(await page.evaluate(() => window.__rpcDelivered)), contentType: 'application/json' })
    await expect.poll(() => page.evaluate(() => window.__rpcDelivered.filter(event => event.endsWith('/reference-updated')).length)).toBeGreaterThan(0)
    await page.evaluate(() => { window.__rpcDelivered = [] })
    await writerProvider.click()
    await expect(writer.getByLabel('API キー', { exact: true })).toHaveValue('')
    await button(writer, '登録を消す').click()
    await button(writer, '登録を消す').click()
    await expect(writerProvider).toContainText('API キー：未登録')
    await expect(provider).toContainText('API キー：未登録')
    await expect.poll(() => page.evaluate(() => window.__rpcDelivered.filter(event => event.endsWith('/reference-updated')).length)).toBeGreaterThan(0)
    await page.reload()
    await expect(provider).toContainText('API キー：未登録')
  } finally {
    await writer.close()
    await setValue(page, 'llm-deepseek', ['apiKeyEnv'])
  }
})
