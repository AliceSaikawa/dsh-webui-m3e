import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderState } from '../web/src/features/settings/providers.ts'
import { pageSummary, providerSummary, type SettingObject, type SettingsNamespace } from '../web/src/features/settings/schema.ts'

function namespace(ns: string, value: SettingObject): SettingsNamespace {
  const dict: Record<string, number> = {}
  const refs: Record<number, unknown> = { 0: { type: 'object', dict } }
  for (const [index, [key, current]] of Object.entries(value).entries()) {
    dict[key] = index + 1
    refs[index + 1] = { type: typeof current }
  }
  return { ns, value, revision: 1, schema: { uid: 0, refs }, applies: 'live' }
}

test('設定トップは項目順にかかわらず実物の既定モデルと権限を要約する', () => {
  const model = namespace('agent-default-model', { enabled: true, name: 'ダミー名', provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
  const before = structuredClone(model)
  assert.equal(pageSummary('models', [model]), 'deepseek-chat・推論の強さ：high')
  assert.deepEqual(model, before)
  const permission = namespace('permission', { enabled: true, name: 'ダミー名', defaultPreset: 'workspace-write' })
  assert.equal(pageSummary('permission', [permission]), 'ワークスペース書込')
  permission.value.defaultPreset = 'danger-full-access'
  assert.equal(pageSummary('permission', [permission]), 'フル アクセス')
  permission.value.defaultPreset = 'deployment-specific'
  assert.equal(pageSummary('permission', [permission]), 'カスタム')
})

test('権限の選択肢に日本語の説明があれば表示名に使う', () => {
  const permission = namespace('permission', { defaultPreset: 'restricted' })
  permission.schema = { uid: 0, refs: {
    0: { type: 'object', dict: { defaultPreset: 1 } },
    1: { type: 'union', list: [2] },
    2: { type: 'const', value: 'restricted', meta: { description: '読み取りのみ' } },
  } }
  assert.equal(pageSummary('permission', [permission]), '読み取りのみ')
})

test('エージェントとツールは確認済みの主要設定値だけを要約する', () => {
  const agent = [
    namespace('agent-loop', { enabled: false, maxParallelToolCalls: 4 }),
    namespace('agent-presets', { name: 'ダミー名', default: 'default' }),
  ]
  assert.equal(pageSummary('agent', agent), 'プリセット：default・ツールの同時実行数：4')
  const tools = [namespace('web-search-deepseek', { name: 'ダミー名', model: 'deepseek-chat', maxUses: 5 })]
  assert.equal(pageSummary('tools', tools), '検索モデル：deepseek-chat・検索の上限回数：5')
})

test('主要項目が未設定または保護対象なら値を表示せず別項目でも代用しない', () => {
  assert.equal(pageSummary('models', [namespace('agent-default-model', { name: '代用しない' })]), '既定のモデル：未設定')
  assert.equal(pageSummary('permission', []), 'プリセット：未設定')
  const model = namespace('agent-default-model', { model: 'value-not-for-display', reasoningEffort: 'hidden-depth' })
  model.secrets = [{ path: ['model'], set: true }, { path: ['reasoningEffort'], set: true }]
  assert.equal(pageSummary('models', [model]), '既定のモデル：未設定')
  const permission = namespace('permission', { defaultPreset: 'value-not-for-display' })
  permission.secrets = [{ path: ['defaultPreset'], set: true }]
  assert.equal(pageSummary('permission', [permission]), 'プリセット：未設定')
})

test('提供元の要約は登録状況の件数だけを表示し読み込み中と失敗を区別する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const store = createProviderStore(ctx.remote as unknown as ProviderRemote)
    assert.equal(providerSummary(store.getSnapshot()), '登録状況を読み込み中…')
    await store.load()
    assert.equal(providerSummary(store.getSnapshot()), '登録済み 1・未登録 1・キー不要 1')
    const cloud = store.getSnapshot().rows.find(row => row.id === 'cloud')!
    await store.save(cloud, 'input-value-never-in-summary')
    assert.equal(providerSummary(store.getSnapshot()), '登録済み 2・キー不要 1')
    await store.remove(cloud)
    assert.equal(providerSummary(store.getSnapshot()), '登録済み 1・未登録 1・キー不要 1')
    const stale: ProviderState = { ...store.getSnapshot(), phase: 'error' }
    assert.equal(providerSummary(stale), '登録状況を確認できません')
    assert.equal(providerSummary({ phase: 'ready', rows: [] }), '提供元はありません')
    store.connectionChanged(false)
    assert.equal(providerSummary(store.getSnapshot()), '登録状況を読み込み中…')
  } finally { ctx.dispose() }
})

test('登録状況の照会失敗を未登録として数えない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }], scenario: 'settings-keys-unavailable' })
  try {
    const store = createProviderStore(ctx.remote as unknown as ProviderRemote)
    await store.load()
    assert.equal(providerSummary(store.getSnapshot()), 'キー不要 1・未確認 2')
  } finally { ctx.dispose() }
})
