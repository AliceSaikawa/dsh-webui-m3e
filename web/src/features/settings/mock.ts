import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import type { SettingObject, SettingsDescription, SettingsNamespace, SettingValue } from './schema.ts'
import type { ProviderAddress, ProviderEntry } from './providers.ts'

type MutateOperation = { op: 'unset'; path: string[] } | { op: 'set'; path: string[]; value: SettingValue }
export interface SettingsMockRemote {
  describe(): Promise<RemoteResult<SettingsDescription>>
  update(ns: string, patch: SettingObject, expectedRevision: number): Promise<RemoteResult<SettingsNamespace>>
  mutate(ns: string, operations: MutateOperation[], expectedRevision: number): Promise<RemoteResult<SettingsNamespace>>
}

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })
const isObject = (value: SettingValue | undefined): value is SettingObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const allowedKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key)

/** Merge user overrides without sharing mutable objects with callers. */
function merge(base: SettingObject, patch: SettingObject): SettingObject {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedKey(key)) continue
    result[key] = isObject(value) ? merge(isObject(result[key]) ? result[key] : {}, value) : structuredClone(value)
  }
  return result
}

function unset(value: SettingObject, path: readonly string[]): void {
  const [key, ...rest] = path
  if (!key || !allowedKey(key)) return
  if (rest.length === 0) { delete value[key]; return }
  const child = value[key]
  if (!isObject(child)) return
  unset(child, rest)
  if (Object.keys(child).length === 0) delete value[key]
}

function set(value: SettingObject, path: readonly string[], next: SettingValue): void {
  const [key, ...rest] = path
  if (!key || !allowedKey(key)) return
  if (rest.length === 0) { value[key] = structuredClone(next); return }
  if (!isObject(value[key])) value[key] = {}
  set(value[key] as SettingObject, rest, next)
}

/** Shapes follow DSH 0.1.5-rc.1: dsh-agent-default-model and dsh-tool-subagent's model selection. */
function modelFixture(ns: 'agent-default-model' | 'subagent-model-selection'): SettingsNamespace {
  if (ns === 'agent-default-model') {
    const base: SettingObject = { provider: 'deepseek', model: 'deepseek-v4' }
    const user: SettingObject = { reasoningEffort: 'high' }
    const refs = {
      0: { type: 'object', dict: { provider: 1, model: 2, reasoningEffort: 3 } },
      1: { type: 'string', meta: { title: '提供元', required: true } },
      2: { type: 'string', meta: { title: 'モデル', required: true } },
      3: { type: 'string', meta: { title: '推論の強さ' } },
    }
    return { ns, revision: 1, schema: { uid: 0, refs }, base, user, value: merge(base, user), secrets: [], applies: 'live' }
  }
  const base: SettingObject = { enabled: false, allowedModels: [] }
  const refs = {
    0: { type: 'object', dict: { enabled: 1, allowedModels: 2 } },
    1: { type: 'boolean', meta: { title: 'モデルを選べるようにする' } },
    2: { type: 'array', inner: 3, meta: { title: '使ってよいモデル' } },
    3: { type: 'object', dict: { provider: 4, model: 5 } },
    4: { type: 'string', meta: { title: '提供元' } },
    5: { type: 'string', meta: { title: 'モデル' } },
  }
  return { ns, revision: 1, schema: { uid: 0, refs }, base, user: {}, value: merge(base, {}), secrets: [], applies: 'live' }
}

function fixture(ns: string, name: string, index: number): SettingsNamespace {
  if (ns === 'agent-default-model' || ns === 'subagent-model-selection') return modelFixture(ns)
  const base: SettingObject = {
    enabled: true,
    name,
    timeout: 30,
    mode: '標準',
    retry: { enabled: true, interval: 2 },
    models: ['基本モデル', '補助モデル'],
    labels: { primary: '既定' },
    custom: null,
  }
  const user: SettingObject = { timeout: 45, retry: { interval: 3 } }
  const dict: Record<string, number> = { enabled: 1, name: 2, timeout: 3, mode: 4, retry: 8, models: 11, labels: 13, custom: 14 }
  const refs: Record<string, unknown> = {
    0: { type: 'object', dict },
    1: { type: 'boolean', meta: { title: '有効にする', description: 'この機能を利用するか選びます。' } },
    2: { type: 'string', meta: { title: '名前', description: 'この設定で使う名前を入力します。', required: true } },
    3: { type: 'number', meta: { title: '待機時間', description: '応答を待つ秒数です。', min: 1, max: 120, step: 1 } },
    4: { type: 'union', list: [5, 6, 7], meta: { title: '動作モード', description: '用途に合わせた動作を選びます。' } },
    5: { type: 'const', value: '標準', meta: { description: '標準' } },
    6: { type: 'const', value: '慎重', meta: { description: '慎重' } },
    7: { type: 'const', value: '高速', meta: { description: '高速' } },
    8: { type: 'object', dict: { enabled: 9, interval: 10 }, meta: { title: '再試行', description: '再試行の動作を調整します。' } },
    9: { type: 'boolean', meta: { title: '再試行する' } },
    10: { type: 'number', meta: { title: '間隔', description: '再試行までの秒数です。', min: 1, max: 10, step: 1 } },
    11: { type: 'array', inner: 12, meta: { title: 'モデルの候補', description: '順番に利用するモデルです。' } },
    12: { type: 'string' },
    13: { type: 'dict', inner: 12, meta: { title: 'ラベル', description: '用途ごとのラベルです。' } },
    14: { type: 'custom', meta: { title: '拡張項目', description: '専用の画面で編集する項目です。' } },
  }
  // A defensive display fixture only; this is not the live registration contract.
  // No stored value is created for this masked field.
  if (ns === 'llm-deepseek') {
    dict.protectedInput = 15
    refs[15] = { type: 'string', meta: { title: '保護された項目', role: 'password', description: '値を表示しないための偽データです。' } }
    base.apiKeyEnv = 'DEEPSEEK_API_KEY'
  }
  if (ns === 'llm-pi-ai') base.providers = { cloud: { apiKeyEnv: 'PI_AI_API_KEY' } }
  if (ns === 'agent-presets') {
    base.default = 'default'
    dict.default = 19
    refs[19] = { type: 'string', meta: { title: '既定のプリセット' } }
  }
  if (ns === 'agent-loop') {
    base.maxParallelToolCalls = 4
    dict.maxParallelToolCalls = 19
    refs[19] = { type: 'number', meta: { title: 'ツールを同時に使う上限', min: 1 } }
  }
  if (ns === 'web-search-deepseek') {
    base.model = 'deepseek-chat'
    base.maxUses = 5
    dict.model = 19
    dict.maxUses = 20
    refs[19] = { type: 'string', meta: { title: '検索モデル' } }
    refs[20] = { type: 'number', meta: { title: '検索回数の上限', min: 0 } }
  }
  if (ns === 'permission') {
    base.defaultPreset = 'workspace-write'
    dict.defaultPreset = 16
    refs[16] = { type: 'union', list: [17, 18], meta: { title: '新しい会話の権限' } }
    refs[17] = { type: 'const', value: 'workspace-write', meta: { description: 'ワークスペース書込' } }
    refs[18] = { type: 'const', value: 'danger-full-access', meta: { description: 'フル アクセス' } }
  }
  return { ns, revision: 1, schema: { uid: 0, refs }, base, user, value: merge(base, user),
    secrets: ns === 'llm-deepseek' ? [{ path: ['protectedInput'], set: true }] : [],
    applies: index % 3 === 1 ? 'restart' : 'live' }
}

export function extendMock(kit: MockKit): void {
  const definitions = [
    ['agent-default-model', '会話の既定モデル'],
    ['subagent-model-selection', '補助エージェントのモデル'],
    ['permission', '標準の権限'],
    ['agent-presets', '基本のプリセット'],
    ['agent-loop', '通常の実行'],
    ['llm-deepseek', 'クラウド提供元'],
    ['llm-pi-ai', '別のクラウド提供元'],
    ['llm-retry', 'モデルの再試行'],
    ['llm-local', 'ローカル提供元'],
    ['web-search-deepseek', '標準の検索'],
    ['shell', '標準のシェル'],
    ['locale', '日本語'],
    ['ui-theme', '標準画面の外観'],
    ['ui-onboarding', '標準画面の案内'],
    ['example-extension', '追加機能'],
  ] as const
  const namespaces = new Map(definitions.map(([ns, name], index) => [ns as string, fixture(ns, name, index)]))
  let writable = true
  let firstWriteConflict = false
  let rejectWrites = false
  let keysWritable = true
  let keyLookupFails = false
  // Keep registration booleans only, never the submitted key material.
  const registeredKeys = new Set(['DEEPSEEK_API_KEY'])
  const providers: ProviderEntry[] = [
    { id: 'deepseek-official', name: 'ディープシーク' },
    { id: 'cloud', name: 'クラウド提供元' },
    { id: 'local', name: 'ローカル' },
  ]
  const directory: ProviderAddress[] = [
    { provider: 'deepseek-official', displayName: 'ディープシーク', settingsNs: 'llm-deepseek', settingsPath: [] },
    { provider: 'cloud', displayName: 'クラウド提供元', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'cloud'] },
    { provider: 'local', displayName: 'ローカル', settingsNs: 'llm-local', settingsPath: [] },
  ]

  function checkWrite(ns: string, expectedRevision: number): RemoteResult<SettingsNamespace> {
    const current = namespaces.get(ns)
    if (!current) return failure('settings/not-found', 'この設定は見つかりません。')
    if (!writable) return failure('settings/readonly', 'この DSH では設定を変更できません。')
    if (firstWriteConflict) {
      firstWriteConflict = false
      current.revision++
      return failure('settings/conflict', 'ほかの場所で設定が変わりました。読み直してください。')
    }
    if (expectedRevision !== current.revision) return failure('settings/conflict', 'ほかの場所で設定が変わりました。読み直してください。')
    if (rejectWrites) return failure('settings/rejected', 'この値は管理者の設定によって許可されていません。')
    return { ok: true, value: current }
  }

  async function commit(current: SettingsNamespace, user: SettingObject): Promise<RemoteResult<SettingsNamespace>> {
    // Mirrors dsh-tool-subagent's section validator, which rejects this before persisting.
    const next = merge(current.base ?? {}, user)
    if (current.ns === 'subagent-model-selection' && next.enabled === true
      && (!Array.isArray(next.allowedModels) || next.allowedModels.length === 0)) {
      return failure('settings/rejected', 'enabled subagent model selection requires at least one allowed model')
    }
    current.user = user
    current.value = merge(current.base ?? {}, user)
    current.revision++
    await kit.emit('settings/document-updated', current.ns)
    return success(current)
  }

  const remote: SettingsMockRemote = {
    async describe() { return success({ writable, namespaces: [...namespaces.values()] }) },
    async update(ns, patch, expectedRevision) {
      const result = checkWrite(ns, expectedRevision)
      if (!result.ok) return result
      return commit(result.value, merge(result.value.user ?? {}, patch))
    },
    async mutate(ns, operations, expectedRevision) {
      const result = checkWrite(ns, expectedRevision)
      if (!result.ok) return result
      if (operations.some(operation => !['set', 'unset'].includes(operation.op) || !operation.path.length || operation.path.some(key => !key || !allowedKey(key)))) {
        return failure('settings/rejected', '設定項目の場所が不正です。')
      }
      const user = structuredClone(result.value.user ?? {})
      for (const operation of operations) {
        if (operation.op === 'set') set(user, operation.path, operation.value)
        else unset(user, operation.path)
      }
      return commit(result.value, user)
    },
  }
  kit.addRemote('settings', remote)
  kit.addRemote('llm', {
    async listProviders() { return success(providers) },
    async listConfigurableProviders() { return success(directory) },
  })
  kit.addRemote('credentials', {
    async describe(refs: string[]) {
      if (keyLookupFails) return failure('credential/unavailable', '登録状況を読み込めません。')
      return success(Object.fromEntries(refs.map(ref => [ref, { configured: registeredKeys.has(ref), writable: writable && keysWritable }])))
    },
    async set(ref: string, value: string) {
      if (!writable || !keysWritable || rejectWrites || !value.trim()) return failure('credential/rejected', 'キーを登録できません。')
      registeredKeys.add(ref)
      await kit.emit('credentials/reference-updated', ref)
      return success({ configured: true, writable: true })
    },
    async unset(ref: string) {
      if (!writable || !keysWritable || rejectWrites) return failure('credential/rejected', '登録を消せません。')
      registeredKeys.delete(ref)
      await kit.emit('credentials/reference-updated', ref)
      return success({ configured: false, writable: true })
    },
  })
  kit.scenario('settings-readonly', () => { writable = false })
  kit.scenario('settings-conflict', () => { firstWriteConflict = true })
  kit.scenario('settings-rejected', () => { rejectWrites = true })
  kit.scenario('settings-unset', () => {
    const row = namespaces.get('agent-loop')!
    unset(row.base ?? {}, ['mode'])
    unset(row.user ?? {}, ['mode'])
    row.value = merge(row.base ?? {}, row.user ?? {})
  })
  kit.scenario('settings-keys-readonly', () => { keysWritable = false })
  kit.scenario('settings-keys-unavailable', () => { keyLookupFails = true })
}
