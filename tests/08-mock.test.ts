import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { groupNamespaces, pageSummary, schemaFields, selectFieldState, type SettingsNamespace, type SettingField, type SettingObject } from '../web/src/features/settings/schema.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { mockPermissionCatalog } from '../web/src/features/composer/mock.ts'
import type { ProviderRemote } from '../web/src/features/settings/providers.ts'

function setup(scenario?: string) {
  const ctx = createMockContext({ extensions: [{ extendMock }], scenario })
  return { ctx, remote: ctx.remote.settings as SettingsMockRemote }
}
async function namespace(remote: SettingsMockRemote, ns = 'example-extension'): Promise<SettingsNamespace & { base: SettingObject; user: SettingObject }> {
  const description = unwrapRemoteResult(await remote.describe())
  const row = description.namespaces.find(item => item.ns === ns)!
  assert.ok(row.base)
  assert.ok(row.user)
  return { ...row, base: row.base, user: row.user }
}
const leaves = (fields: SettingField[]): SettingField[] => fields.flatMap(field => [field, ...leaves(field.children ?? [])])

test('設定の偽データは全ページと全種類、反映時期、除外する名前空間を揃える', async () => {
  const { ctx, remote } = setup()
  try {
    const description = unwrapRemoteResult(await remote.describe())
    assert.equal(description.writable, true)
    assert.equal(description.namespaces.length, 12)
    const grouped = groupNamespaces(description.namespaces)
    assert.deepEqual(Object.fromEntries(Object.entries(grouped).map(([page, items]) => [page, items.length])), {
      models: 2, permission: 1, agent: 2, providers: 0, tools: 3, other: 1,
    })
    assert.deepEqual(new Set(description.namespaces.map(item => item.applies)), new Set(['live']))
    for (const item of description.namespaces.filter(row => row.ns === 'example-extension')) {
      const kinds = new Set(leaves(schemaFields(item)).map(field => field.kind))
      for (const kind of ['switch', 'text', 'number', 'select', 'group', 'readonly']) assert.ok(kinds.has(kind as SettingField['kind']), `${item.ns}: ${kind}`)
    }
    const model = await namespace(remote, 'agent-default-model')
    assert.deepEqual(model.value, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
    const subagent = await namespace(remote, 'subagent-model-selection-settings')
    assert.deepEqual(subagent.value, { enabled: false, allowedModels: [] })
    const protectedRow = await namespace(remote, 'example-extension')
    const masked = leaves(schemaFields(protectedRow)).find(field => field.kind === 'masked')!
    assert.equal(Object.hasOwn(masked, 'value'), false)
    for (const data of [protectedRow.value, protectedRow.base, protectedRow.user]) assert.equal(Object.hasOwn(data, 'protectedInput'), false)
  } finally { ctx.dispose() }
})

test('設定保存は入れ子の兄弟と null を保ち、返した値や入力を内部と共有しない', async () => {
  const { ctx, remote } = setup()
  try {
    const initial = await namespace(remote)
    const patch = { retry: { interval: 8 }, custom: null, models: ['変更した候補'] }
    const changed = unwrapRemoteResult(await remote.update(initial.ns, patch, initial.revision))
    assert.equal(changed.revision, initial.revision + 1)
    assert.deepEqual(changed.value.retry, { enabled: true, interval: 8 })
    assert.deepEqual(changed.user!.retry, { interval: 8 })
    assert.equal(changed.value.custom, null)
    assert.equal(Object.hasOwn(changed.user!, 'custom'), true)
    patch.retry.interval = 9
    patch.models[0] = '呼び出し後の変更'
    changed.value.name = '応答を書き換える'
    const read = await namespace(remote)
    assert.equal((read.value.retry as { interval: number }).interval, 8)
    assert.deepEqual(read.value.models, ['変更した候補'])
    assert.equal(read.value.name, initial.value.name)
    read.user.timeout = 100
    assert.equal((await namespace(remote)).user.timeout, 45)
  } finally { ctx.dispose() }
})

test('偽データの主要設定をトップへ要約し、モデルの保存後は新しい名前を出す', async () => {
  const { ctx, remote } = setup()
  try {
    const groups = groupNamespaces(unwrapRemoteResult(await remote.describe()).namespaces)
    assert.equal(pageSummary('models', groups.models), 'deepseek-v4・推論の強さ：high')
    assert.equal(pageSummary('permission', groups.permission, mockPermissionCatalog), 'ワークスペース書込')
    assert.equal(pageSummary('agent', groups.agent), 'ツールの同時実行数：10')
    assert.equal(pageSummary('tools', groups.tools), '検索モデル：deepseek-v4-flash・検索の上限回数：5')
    const model = await namespace(remote, 'agent-default-model')
    const changed = unwrapRemoteResult(await remote.update(model.ns, { model: '別のモデル' }, model.revision))
    assert.equal(pageSummary('models', [changed]), '別のモデル・推論の強さ：high')
  } finally { ctx.dispose() }
})

test('既定値に戻す処理は対象の上書きだけを消し、更新イベントは名前空間と版を通知する', async () => {
  const { ctx, remote } = setup()
  try {
    const events: unknown[] = []
    const on = ctx.remote.$on as (event: string, handler: (...args: unknown[]) => void) => () => void
    const stop = on('settings/document-updated', (...args) => { events.push(args) })
    const initial = await namespace(remote)
    const changed = unwrapRemoteResult(await remote.update(initial.ns, { retry: { enabled: false } }, initial.revision))
    const reset = unwrapRemoteResult(await remote.mutate(initial.ns, [{ op: 'unset', path: ['retry', 'interval'] }], changed.revision))
    assert.deepEqual(reset.user!.retry, { enabled: false })
    assert.deepEqual(reset.value.retry, { enabled: false, interval: 2 })
    assert.equal(reset.user!.timeout, 45)
    const resetGroup = unwrapRemoteResult(await remote.mutate(initial.ns, [{ op: 'unset', path: ['retry'] }], reset.revision))
    assert.equal(Object.hasOwn(resetGroup.user!, 'retry'), false)
    assert.deepEqual(resetGroup.value.retry, initial.base.retry)
    assert.deepEqual(events, [[initial.ns, changed.revision], [initial.ns, reset.revision], [initial.ns, resetGroup.revision]])
    stop()
  } finally { ctx.dispose() }
})

test('読み取り専用では保存も既定値への復元も拒否する', async () => {
  const { ctx, remote } = setup('settings-readonly')
  try {
    assert.equal(unwrapRemoteResult(await remote.describe()).writable, false)
    const initial = await namespace(remote)
    for (const result of [await remote.update(initial.ns, { enabled: false }, initial.revision), await remote.mutate(initial.ns, [{ op: 'unset', path: ['timeout'] }], initial.revision)]) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'settings/readonly')
    }
    assert.deepEqual(await namespace(remote), initial)
  } finally { ctx.dispose() }
})

test('未設定シナリオでは任意の選択欄を未設定として表示し、選択・既定値への復帰ができる', async () => {
  const { ctx, remote } = setup('settings-unset')
  try {
    const initial = await namespace(remote)
    const field = schemaFields(initial).find(item => item.path[0] === 'mode')!
    assert.equal(field.kind, 'select')
    assert.equal(field.required, false)
    assert.equal(field.value, undefined)
    assert.deepEqual(selectFieldState(field, field.value), { index: -1, placeholder: '未設定' })
    const chosen = field.options![0]!.value
    const saved = unwrapRemoteResult(await remote.update(initial.ns, { mode: chosen }, initial.revision))
    assert.deepEqual(selectFieldState(field, saved.value.mode), { index: 0, placeholder: undefined })
    const reset = unwrapRemoteResult(await remote.mutate(initial.ns, [{ op: 'unset', path: ['mode'] }], saved.revision))
    assert.equal(Object.hasOwn(reset.value, 'mode'), false)
    assert.deepEqual(selectFieldState(field, reset.value.mode), { index: -1, placeholder: '未設定' })
    assert.equal(reset.value.name, initial.value.name)
  } finally { ctx.dispose() }
})

test('初回競合のあと読み直した版で保存でき、古い版での保存は常に競合する', async () => {
  const { ctx, remote } = setup('settings-conflict')
  try {
    const initial = await namespace(remote)
    const conflict = await remote.update(initial.ns, { enabled: false }, initial.revision)
    assert.equal(conflict.ok, false)
    if (!conflict.ok) assert.equal(conflict.error.code, 'settings/conflict')
    const refreshed = await namespace(remote)
    assert.equal(refreshed.revision, initial.revision + 1)
    assert.equal(refreshed.value.enabled, true)
    const saved = unwrapRemoteResult(await remote.update(initial.ns, { enabled: false }, refreshed.revision))
    assert.equal(saved.value.enabled, false)
    const stale = await remote.mutate(initial.ns, [{ op: 'unset', path: ['enabled'] }], refreshed.revision)
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.equal(stale.error.code, 'settings/conflict')
  } finally { ctx.dispose() }
})

test('拒否シナリオは理由を返して値を保ち、不正な復元指定も保存しない', async () => {
  const rejected = setup('settings-rejected')
  try {
    const initial = await namespace(rejected.remote)
    const result = await rejected.remote.update(initial.ns, { timeout: 10 }, initial.revision)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'settings/rejected')
      assert.match(result.error.message, /管理者/)
    }
    assert.deepEqual(await namespace(rejected.remote), initial)
  } finally { rejected.ctx.dispose() }
  const normal = setup()
  try {
    const initial = await namespace(normal.remote)
    const result = await normal.remote.mutate(initial.ns, [{ op: 'unset', path: [] }], initial.revision)
    assert.equal(result.ok, false)
    assert.deepEqual(await namespace(normal.remote), initial)
  } finally { normal.ctx.dispose() }
})

// DSH 0.2.0-rc.2 dsh-api-settings-controller/lib/index.js:55-57 (MAX_DESCRIBE_REFS = 64, gateway/bad-request).
test('I16 lookup limit: 偽のキーの状態の照会も 64 件を受理し 65 件を拒否する', async () => {
  const { ctx } = setup()
  try {
    const credentials = (ctx.remote as unknown as ProviderRemote).credentials
    const refs = Array.from({ length: 65 }, (_, i) => `LIMIT_${i}`)
    const accepted = await credentials.describe(refs.slice(0, 64))
    assert.equal(accepted.ok, true)
    if (accepted.ok) assert.deepEqual(Object.keys(accepted.value), refs.slice(0, 64))
    const rejected = await credentials.describe(refs)
    assert.equal(rejected.ok, false)
    if (!rejected.ok) assert.equal(rejected.error.code, 'gateway/bad-request')
  } finally { ctx.dispose() }
})
