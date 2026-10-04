import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { SettingsApi } from '../web/src/features/settings/store.ts'
import type { ModelCatalog, PermissionCatalog } from '../web/src/features/composer/api.ts'
import type { RemoteResult, ISessions, DshServices } from '../web/src/dsh/services.ts'
import type { WorkspaceFilesRemote } from '../web/src/features/session-tools/files.ts'
import { test, expect, button, openM3e } from './fixtures.ts'

type Rpc = {
  settings: SettingsApi
  session: { modelCatalog(): Promise<RemoteResult<ModelCatalog>> }
  permissionPresets: { catalog(): Promise<RemoteResult<PermissionCatalog>> }
  workspaceFiles: WorkspaceFilesRemote
}
declare global { interface Window {
  __rpcReview: { remote: Rpc; sessions: ISessions; workspaces: DshServices['workspaces'] }
  __rpcWatchReady?: boolean
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
            return { ...exported, apply(ctx: Context) { const result = apply(ctx); window.__rpcReview = ctx.root; return result } }
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

test('S5 設定一覧とシェル設定を実 DSH に保存し再読込できる', async ({ page, integration }) => {
  await setup(page, integration.host)
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
      const response = await api.update('permission', { presets: {} }, row.revision)
      return response.ok ? { ok: true } : { ok: false, code: response.error.code }
    })
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('非 volatile 項目の変更が拒否されませんでした')
    expect(rejected.code).toBe('settings/rejected')
  } finally { await setValue(page, 'bash-sandbox', ['timeoutMs']) }
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
  } finally { await setValue(page, 'permission', ['defaultPreset']) }
})

test('S5 会話のファイル一覧・テキスト・画像を実ワークスペースから読む', async ({ page, integration }) => {
  await setup(page, integration.host)
  const { path, workspaceId } = await createWorkspace(page, integration.host, 'rpc-files')
  writeFileSync(join(path, 'rpc.txt'), 'M3E RPC ファイル確認\n2 行目')
  writeFileSync(join(path, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const sessionId = await page.evaluate(workspaceId => window.__rpcReview.sessions.create({ workspaceId }), workspaceId)
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
  await expect.poll(() => page.locator('.session-file-image').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
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
  const change = page.evaluate(async sessionId => {
    const handle = window.__rpcReview.remote.workspaceFiles.changes(sessionId, 'watched.txt')
    try {
      for await (const frame of handle) {
        if (frame.kind === 'ready') window.__rpcWatchReady = true
        else return frame.change.absolutePath
      }
      throw new Error('変更通知の前に監視が終了しました')
    } finally { handle.dispose() }
  }, sessionId)
  await expect.poll(() => page.evaluate(() => window.__rpcWatchReady)).toBe(true)
  writeFileSync(join(path, 'watched.txt'), 'after')
  expect(await change).toBe(join(path, 'watched.txt'))
})

test('S5 隔離した DSH の提供元に偽の API キーを登録して削除する', async ({ page, integration }) => {
  await setup(page, integration.host, '/settings/providers')
  // Switch only this isolated profile to a fresh reference; the process key remains intact.
  await setValue(page, 'llm-deepseek', ['apiKeyEnv'], 'M3E_INTEGRATION_API_KEY')
  try {
    const provider = action(page, /DeepSeek/)
    await expect(provider).toContainText('API キー：未登録')
    await expect(provider).toHaveJSProperty('disabled', false)
    await provider.click()
    await page.getByLabel('API キー', { exact: true }).fill('fake-key-for-m3e-integration-2')
    await button(page, '保存').click()
    await expect(provider).toContainText('API キー：登録済み')
    await page.reload()
    await expect(provider).toContainText('API キー：登録済み')
    await provider.click()
    await expect(page.getByLabel('API キー', { exact: true })).toHaveValue('')
    await button(page, '登録を消す').click()
    await button(page, '登録を消す').click()
    await expect(provider).toContainText('API キー：未登録')
    await page.reload()
    await expect(provider).toContainText('API キー：未登録')
  } finally { await setValue(page, 'llm-deepseek', ['apiKeyEnv']) }
})
