import type { ProviderState } from './providers.ts'
import type { PermissionCatalog } from '../composer/api.ts'

export type SettingValue = null | boolean | number | string | SettingValue[] | { [key: string]: SettingValue }
export type SettingObject = { [key: string]: SettingValue }
export type SettingPath = readonly string[]
export interface SchemaNode {
  type?: string
  value?: SettingValue
  dict?: Record<string, SchemaNode>
  list?: SchemaNode[]
  inner?: SchemaNode
  meta?: { description?: string; title?: string; role?: string; min?: number; max?: number; step?: number; required?: boolean; disabled?: boolean }
}
export interface SettingsNamespace {
  autoGenerate: boolean
  ns: string
  revision: number
  schema: unknown
  value: SettingObject
  base?: SettingObject
  user?: SettingObject
  secrets?: { path: string[]; set: boolean }[]
  applies: 'live'
}
export interface SettingsDescription { writable: boolean; namespaces: SettingsNamespace[] }
export interface SettingField {
  path: string[]
  kind: 'switch' | 'text' | 'number' | 'select' | 'group' | 'readonly' | 'masked'
  label: string
  description: string
  value?: SettingValue
  registered?: boolean
  overridden: boolean
  disabled: boolean
  min?: number
  max?: number
  step?: number
  required: boolean
  options?: { label: string; value: string | number | boolean | null }[]
  children?: SettingField[]
}
export const settingsPages = [
  { id: 'models', title: 'モデル', icon: 'smart_toy' },
  { id: 'permission', title: '権限', icon: 'shield' },
  { id: 'agent', title: 'エージェント', icon: 'tune' },
  { id: 'providers', title: '提供元と API キー', icon: 'key' },
  { id: 'tools', title: 'Web 検索とシェル', icon: 'travel_explore' },
  { id: 'other', title: 'そのほか', icon: 'tune' },
] as const
export type SettingsPage = typeof settingsPages[number]['id']

const names: Record<string, string> = {
  'agent-default-model': '既定のモデル', 'subagent-model-selection-settings': 'サブエージェントのモデル',
  permission: '権限', 'agent-preset-registry': 'エージェントのプリセット', 'agent-loop': 'エージェントの動作',
  'web-search-deepseek': 'Web 検索', 'bash-sandbox': 'シェル', 'pwsh-sandbox': 'シェル', locale: '言語と地域',
  selectedDefault: '既定のプリセット', defaultPreset: '新しい会話の権限',
  timeoutMs: '待機時間', maxOutputBytes: '出力の上限',
  enabled: '有効にする', model: 'モデル', default: '既定のモデル', provider: '提供元',
  name: '名前', mode: '動作モード', maxSteps: '最大ステップ数', timeout: '待機時間',
  maxRetries: '再試行の上限', count: '回数', temperature: '応答の多様性',
  retry: '再試行', interval: '間隔', command: 'コマンド', language: '言語',
  reasoningEffort: '推論の強さ',
}
export const namespaceTitle = (ns: string): string => names[ns] ?? ns
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key)
const japanese = (value?: string) => value && /[\u3040-\u30ff\u3400-\u9fff]/.test(value) ? value : undefined

/** Resolve Cordis' node table without mutating it or following cycles. */
export function decodeSchema(input: unknown): SchemaNode {
  if (!isObject(input)) return {}
  if (!isObject(input.refs) || !('uid' in input)) return {}
  const refs = input.refs
  function visit(id: unknown, ancestors: Set<string>, depth: number): SchemaNode {
    if ((typeof id !== 'string' && typeof id !== 'number') || depth > 32) return {}
    const key = String(id)
    if (!safeKey(key) || ancestors.has(key) || !Object.hasOwn(refs, key)) return {}
    const node = refs[key]
    if (!isObject(node)) return {}
    const seen = new Set(ancestors).add(key)
    const result: SchemaNode = { type: typeof node.type === 'string' ? node.type : undefined }
    if ('value' in node) result.value = node.value as SettingValue
    if (isObject(node.meta)) result.meta = node.meta as SchemaNode['meta']
    if (isObject(node.dict)) result.dict = Object.fromEntries(Object.entries(node.dict).filter(([name]) => safeKey(name)).map(([name, child]) => [name, visit(child, seen, depth + 1)]))
    if (Array.isArray(node.list)) result.list = node.list.map(child => visit(child, seen, depth + 1))
    if ('inner' in node) result.inner = visit(node.inner, seen, depth + 1)
    return result
  }
  return visit(input.uid, new Set(), 0)
}

export function groupNamespaces(namespaces: readonly SettingsNamespace[]): Record<SettingsPage, SettingsNamespace[]> {
  const groups: Record<SettingsPage, SettingsNamespace[]> = { models: [], permission: [], agent: [], providers: [], tools: [], other: [] }
  for (const row of namespaces) {
    if (row.ns.startsWith('ui-')) continue
    // Explicit M3E editors mirror the stock custom pages. Other suppressed
    // entries (including provider internals) must not become generic forms.
    if (!row.autoGenerate && !['agent-default-model', 'subagent-model-selection-settings', 'permission', 'bash-sandbox', 'pwsh-sandbox', 'agent-preset-registry', 'locale'].includes(row.ns)) continue
    const page: SettingsPage = row.ns.startsWith('llm-') ? 'providers'
      : ['agent-default-model', 'subagent-model-selection-settings'].includes(row.ns) ? 'models'
      : row.ns === 'permission' ? 'permission'
      : ['agent-preset-registry', 'agent-loop'].includes(row.ns) ? 'agent'
      : ['web-search-deepseek', 'bash-sandbox', 'pwsh-sandbox', 'locale'].includes(row.ns) ? 'tools' : 'other'
    groups[page].push(row)
  }
  return groups
}

export function valueAt(value: unknown, path: SettingPath): SettingValue | undefined {
  let current = value
  for (const key of path) {
    if (!safeKey(key) || !isObject(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current as SettingValue | undefined
}

export function schemaFields(namespace: SettingsNamespace, catalog?: PermissionCatalog): SettingField[] {
  const schema = decodeSchema(namespace.schema)
  const protectedPaths: SettingPath[] = (namespace.secrets ?? []).map(entry => entry.path)
  const containsPath = (parent: SettingPath, child: SettingPath) => parent.length <= child.length && parent.every((key, index) => key === child[index])
  const protectedAt = (path: SettingPath) => protectedPaths.some(parent => containsPath(parent, path))

  // Password roles also protect values nested inside read-only arrays/dictionaries.
  function collectProtected(node: SchemaNode, path: string[], value: unknown): void {
    if (node.meta?.role === 'password') { protectedPaths.push(path); return }
    if (node.dict) for (const [key, child] of Object.entries(node.dict)) collectProtected(child, [...path, key], isObject(value) ? value[key] : undefined)
    if (node.list) for (const child of node.list) collectProtected(child, path, value)
    if (node.inner && (isObject(value) || Array.isArray(value))) {
      for (const [key, child] of Object.entries(value)) if (safeKey(key)) collectProtected(node.inner, [...path, key], child)
    }
  }
  collectProtected(schema, [], namespace.value)

  // Remove protected descendants before a read-only parent can reach JSON formatting.
  function visibleValue(value: SettingValue | undefined, path: string[], depth = 0): SettingValue | undefined {
    if (protectedAt(path) || depth > 64) return undefined
    if (Array.isArray(value)) return value.map((child, index) => visibleValue(child, [...path, String(index)], depth + 1) ?? null)
    if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => safeKey(key)).flatMap(([key, child]) => {
      const visible = visibleValue(child as SettingValue, [...path, key], depth + 1)
      return visible === undefined ? [] : [[key, visible]]
    }))
    return value
  }
  const visible = visibleValue(namespace.value, [])

  function fields(node: SchemaNode, path: string[], inheritedDisabled = false): SettingField[] {
    if (protectedAt(path)) return [field(node, path, 0, inheritedDisabled)]
    if (node.type === 'intersect') return (node.list ?? []).flatMap(child => fields(child, path, inheritedDisabled || node.meta?.disabled === true))
    if (node.type === 'object' && node.dict) return Object.entries(node.dict).map(([key, child], index) => field(child, [...path, key], index, inheritedDisabled || node.meta?.disabled === true))
    return [field(node, path, 0, inheritedDisabled)]
  }
  function field(node: SchemaNode, path: string[], index: number, inheritedDisabled: boolean): SettingField {
    const meta = node.meta ?? {}
    let kind: SettingField['kind'] = protectedAt(path) ? 'masked'
      : (node.type === 'object' && node.dict) || node.type === 'intersect' ? 'group'
      : node.type === 'boolean' ? 'switch' : node.type === 'string' ? 'text' : node.type === 'number' ? 'number'
      : node.type === 'union' && node.list?.length && node.list.every(child => child.type === 'const' && (child.value === null || ['string', 'boolean', 'number'].includes(typeof child.value))) ? 'select' : 'readonly'
    // Ordinary optional fields remain editable; only metadata identifies masked values.
    if (!['group', 'masked'].includes(kind) && !path.length) kind = 'readonly'
    const label = japanese(meta.title) ?? names[path.at(-1) ?? ''] ?? `項目 ${index + 1}`
    const result: SettingField = {
      path, kind, label, description: japanese(meta.description) ?? (meta.description ? '説明は標準の画面で確認できます。' : ''),
      overridden: valueAt(namespace.user, path) !== undefined,
      disabled: inheritedDisabled || meta.disabled === true, required: meta.required === true,
      min: meta.min, max: meta.max, step: meta.step,
    }
    // Masked fields never carry a stored value into the view model.
    if (kind === 'masked') {
      const status = namespace.secrets?.find(entry => containsPath(entry.path, path))
      result.registered = status ? status.set : valueAt(namespace.value, path) !== undefined
    } else result.value = valueAt(visible, path)
    if (kind === 'group') {
      result.children = fields(node, path, result.disabled)
      delete result.value
    }
    if (kind === 'select') result.options = node.list!.map((child, optionIndex) => ({
      value: child.value as string | number | boolean | null,
      label: japanese(child.meta?.description) ?? japanese(child.meta?.title) ?? (typeof child.value === 'boolean' ? child.value ? '有効' : '無効' : child.value === null ? '指定しない' : String(child.value ?? `選択肢 ${optionIndex + 1}`)),
    }))
    return result
  }
  return fields(schema, []).map(field => namespace.ns === 'permission' && field.kind !== 'masked' && field.path.length === 1 && field.path[0] === 'defaultPreset'
    ? { ...field, kind: 'select', value: field.value ?? catalog?.defaultPreset,
        disabled: field.disabled || !catalog, options: catalog?.defaultOptions.map(option => ({ label: option.name, value: option.value })) ?? [] }
    : field)
}

export function selectFieldState(field: Pick<SettingField, 'options'>, value: SettingValue | undefined): { index: number; placeholder?: string } {
  const index = field.options?.findIndex(option => Object.is(option.value, value)) ?? -1
  return { index, placeholder: index >= 0 ? undefined : value === undefined ? '未設定' : '現在の値は選択肢にありません' }
}

export function parseFieldInput(field: SettingField, input: string): { ok: true; value: string | number | undefined } | { ok: false; message: string } {
  if (field.kind !== 'number') {
    if (!input.trim()) return field.required
      ? { ok: false, message: '値を入力してください。' }
      : { ok: true, value: undefined }
    return { ok: true, value: input }
  }
  if (!input.trim()) return { ok: false, message: '数値を入力してください。' }
  const value = Number(input)
  if (!Number.isFinite(value)) return { ok: false, message: '有効な数値を入力してください。' }
  if (field.min !== undefined && value < field.min) return { ok: false, message: `${field.min} 以上にしてください。` }
  if (field.max !== undefined && value > field.max) return { ok: false, message: `${field.max} 以下にしてください。` }
  if (field.step !== undefined && field.step > 0) {
    const steps = (value - (field.min ?? 0)) / field.step
    if (Math.abs(steps - Math.round(steps)) > 1e-8) return { ok: false, message: `${field.step} 刻みで入力してください。` }
  }
  return { ok: true, value }
}

export function buildPatch(path: SettingPath, value: SettingValue): SettingObject {
  checkPath(path)
  return path.reduceRight<SettingValue>((nested, key) => ({ [key]: nested }), value) as SettingObject
}
export function buildReset(path: SettingPath): { op: 'unset'; path: string[] }[] {
  checkPath(path)
  return [{ op: 'unset', path: [...path] }]
}
function checkPath(path: SettingPath): void {
  if (!path.length || path.some(key => !key || !safeKey(key))) throw new Error('設定項目の場所が不正です。')
}

export function formatSetting(value: SettingValue | undefined): string {
  if (value === undefined || value === null) return '未設定'
  if (typeof value === 'boolean') return value ? '有効' : '無効'
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

export function pageSummary(page: SettingsPage, namespaces: readonly SettingsNamespace[], catalog?: PermissionCatalog): string {
  const leaves = (fields: SettingField[]): SettingField[] => fields.flatMap(field => field.children ? leaves(field.children) : field)
  const fields = new Map(namespaces.map(namespace => [namespace.ns, leaves(schemaFields(namespace, catalog))]))
  // Select documented setting paths after redaction, never raw values or schema order.
  const fieldAt = (ns: string, key: string) => fields.get(ns)?.find(field => field.path.length === 1 && field.path[0] === key && ['text', 'select', 'number', 'switch'].includes(field.kind))
  const textAt = (ns: string, key: string) => {
    const field = fieldAt(ns, key)
    if (!field || field.value === undefined || field.value === null || field.value === '') return undefined
    return field.options?.find(option => Object.is(option.value, field.value))?.label ?? formatSetting(field.value)
  }
  const labeled = (label: string, value: string | undefined) => value === undefined ? undefined : `${label}：${value}`
  const join = (values: (string | undefined)[]) => values.filter(value => value !== undefined).join('・') || '設定項目を確認'
  if (page === 'models') {
    const model = textAt('agent-default-model', 'model')
    const effort = textAt('agent-default-model', 'reasoningEffort')
    return model === undefined ? '既定のモデル：未設定' : join([model, labeled('推論の強さ', effort)])
  }
  if (page === 'permission') {
    const field = fieldAt('permission', 'defaultPreset')
    const labels: Record<string, string> = { 'workspace-write': 'ワークスペース書込', 'danger-full-access': 'フル アクセス' }
    const value = field?.value
    return field?.options?.find(option => Object.is(option.value, value))?.label
      ?? (typeof value === 'string' && value ? labels[value] ?? 'カスタム' : 'プリセット：未設定')
  }
  if (page === 'agent') return join([
    labeled('プリセット', textAt('agent-preset-registry', 'selectedDefault')),
    labeled('ツールの同時実行数', textAt('agent-loop', 'maxParallelToolCalls')),
  ])
  if (page === 'tools') return join([
    labeled('検索モデル', textAt('web-search-deepseek', 'model')),
    labeled('検索の上限回数', textAt('web-search-deepseek', 'maxUses')),
  ])
  if (page === 'providers') return '登録状況を読み込み中…'
  return [...fields.values()].flat()
    .filter(field => ['text', 'select', 'number', 'switch'].includes(field.kind) && field.value !== undefined)
    .slice(0, 2).map(field => `${field.label}：${formatSetting(field.value)}`).join('・') || '設定項目を確認'
}

/** Only registration states enter the top-level summary, never key material. */
export function providerSummary(state: Pick<ProviderState, 'phase' | 'rows'>): string {
  if (state.phase === 'loading') return '登録状況を読み込み中…'
  if (state.phase === 'error') return '登録状況を確認できません'
  if (!state.rows.length) return '提供元はありません'
  const counts = { registered: 0, missing: 0, unnecessary: 0, unknown: 0 }
  for (const row of state.rows) counts[row.status]++
  return [
    counts.registered && `登録済み ${counts.registered}`,
    counts.missing && `未登録 ${counts.missing}`,
    counts.unnecessary && `キー不要 ${counts.unnecessary}`,
    counts.unknown && `未確認 ${counts.unknown}`,
  ].filter(Boolean).join('・')
}
