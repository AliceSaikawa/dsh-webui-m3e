import assert from 'node:assert/strict'
import test from 'node:test'
import { groupNamespaces, schemaFields, type SettingsNamespace } from '../web/src/features/settings/schema.ts'
import { providerRows } from '../web/src/features/settings/providers.ts'
import { createSettingsStore } from '../web/src/features/settings/store.ts'
import { validMockOperations, validMockPatch } from '../web/src/features/settings/mock-validation.ts'
import type { PermissionCatalog } from '../web/src/features/composer/api.ts'

const row = (ns: string, autoGenerate = true): SettingsNamespace => ({ ns, autoGenerate, revision: 0, applies: 'live',
  value: {}, schema: { uid: 0, refs: { 0: { type: 'object', dict: { defaultPreset: 1 } }, 1: { type: 'string' } } } })
const catalog: PermissionCatalog = { options: [{ value: 'auto', name: '自動' }, { value: 'read-only', name: '読み取りのみ' }],
  defaultOptions: [{ value: 'read-only', name: '読み取りのみ' }], defaultPreset: 'read-only' }

test('専用の設定ページを保持し autoGenerate が false の提供元と拡張を汎用表示しない', () => {
  const groups = groupNamespaces(['agent-default-model', 'subagent-model-selection-settings', 'permission', 'agent-preset-registry',
    'bash-sandbox', 'pwsh-sandbox', 'locale', 'llm-deepseek', 'llm-deepseek-account', 'hidden-extension'].map(ns => row(ns, false)))
  assert.deepEqual(groups.models.map(item => item.ns), ['agent-default-model', 'subagent-model-selection-settings'])
  assert.deepEqual(groups.agent.map(item => item.ns), ['agent-preset-registry'])
  assert.deepEqual(groups.tools.map(item => item.ns), ['bash-sandbox', 'pwsh-sandbox', 'locale'])
  assert.equal(groups.permission.length, 1)
  assert.deepEqual(groups.providers, [])
  assert.deepEqual(groups.other, [])
  assert.deepEqual(groupNamespaces([row('extension')]).other.map(item => item.ns), ['extension'])
})

test('権限の文字列 schema に既定候補と省略時の値を結び、mutate で保存する', async () => {
  let current = row('permission', false)
  const writes: unknown[] = []
  const store = createSettingsStore({
    async describe() { return { ok: true, value: { writable: true, namespaces: [current] } } },
    async update() { assert.fail('権限の保存は mutate') },
    async mutate(ns, ops, revision) {
      writes.push([ns, ops, revision])
      current = { ...current, revision: revision + 1, value: { defaultPreset: 'read-only' } }
      return { ok: true, value: current }
    },
  }, async () => catalog)
  await store.reload()
  const field = schemaFields(current, store.getSnapshot().permissionCatalog)[0]!
  assert.equal(field.kind, 'select')
  assert.equal(field.value, 'read-only')
  assert.deepEqual(field.options, [{ label: '読み取りのみ', value: 'read-only' }])
  assert.equal(await store.edit('permission', ['defaultPreset'], 'auto'), false)
  assert.equal(await store.edit('permission', ['defaultPreset'], 'read-only'), true)
  assert.deepEqual(writes, [['permission', [{ op: 'set', path: ['defaultPreset'], value: 'read-only' }], 0]])
  assert.equal(schemaFields(current)[0]!.disabled, true)
})

test('アカウント提供元は利用可能なモデルがある場合だけ表示しキー参照を作らない', () => {
  const entry = { provider: 'deepseek-account', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] }
  const settings = { writable: true, namespaces: [row('llm-deepseek-account', false)] }
  assert.deepEqual(providerRows([{ id: entry.provider, name: entry.displayName }], [entry], settings), [])
  const available = providerRows([{ id: entry.provider, name: entry.displayName }], [entry], settings, true)
  assert.equal(available.length, 1)
  assert.equal(available[0]!.ref, undefined)
  assert.equal(available[0]!.status, 'unnecessary')
  assert.equal(available[0]!.writable, false)
})

test('設定の偽 RPC 用検査は describe にない非 volatile パスと型違いを拒否する', () => {
  const view = row('permission')
  assert.equal(validMockPatch(view, { defaultPreset: 'read-only' }), true)
  assert.equal(validMockPatch(view, { presets: {} }), false)
  assert.equal(validMockPatch(view, { defaultPreset: 3 }), false)
  assert.equal(validMockOperations(view, [{ op: 'set', path: ['defaultPreset'], value: 'read-only' }]), true)
  assert.equal(validMockOperations(view, [{ op: 'unset', path: ['presets'] }]), false)
  assert.equal(validMockOperations(view, [{ op: 'set', path: ['defaultPreset', 'nested'], value: 'x' }]), false)
})
