import type { ProviderState } from './providers.ts'
import type { PermissionCatalog } from '../composer/api.ts'
import { presetDisplayName } from '../../dsh/permission-presets.ts'
import { matchesNumberStep } from './number-step.ts'

export type SettingValue = null | boolean | number | string | SettingValue[] | { [key: string]: SettingValue }
export type SettingObject = { [key: string]: SettingValue }
export type SettingPath = readonly string[]
export interface SchemaMeta {
  readonly description?: string; readonly title?: string; readonly role?: string; readonly min?: number; readonly max?: number; readonly step?: number
  readonly required?: boolean; readonly disabled?: boolean; readonly pattern?: { readonly source: string; readonly flags: string }
}
/**
 * A decoded schema node. The same object is shared by every path that refers to the
 * same definition, so it is read-only (and frozen outside production builds).
 */
export interface SchemaNode {
  /** The definition was not decoded (a limit, the depth or a cycle on this path). Everything at this path is unknown. */
  readonly truncated?: boolean
  readonly type?: string
  readonly value?: SettingValue
  readonly dict?: Readonly<Record<string, SchemaNode>>
  readonly list?: readonly SchemaNode[]
  readonly inner?: SchemaNode
  readonly sKey?: SchemaNode
  readonly meta?: SchemaMeta
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
  /** A read-only placeholder without a value: the definition or the value exceeded a limit. */
  omitted?: boolean
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
  'web-search-deepseek': 'Web 検索', web: 'Web の提供元', 'web-deepseek-api': 'Web 検索と取得 API',
  'bash-sandbox': 'シェル', 'pwsh-sandbox': 'シェル', locale: '言語と地域',
  selectedDefault: '既定のプリセット', defaultPreset: '新しい会話の権限',
  timeoutMs: '待機時間', maxOutputBytes: '出力の上限',
  enabled: '有効にする', model: 'モデル', default: '既定のモデル', provider: '提供元',
  name: '名前', mode: '動作モード', maxSteps: '最大ステップ数', timeout: '待機時間',
  maxRetries: '再試行の上限', count: '回数', temperature: '応答の多様性',
  retry: '再試行', interval: '間隔', command: 'コマンド', language: '言語',
  searchProvider: '検索の提供元', fetchProvider: '取得の提供元',
  apiKey: 'API キー', apiKeyEnv: 'API キーの環境変数', baseURL: '接続先', sendOriginalQuestion: '元の質問を送る',
  reasoningEffort: '推論の強さ',
}
export const namespaceTitle = (ns: string): string => names[ns] ?? ns

// Some DSH fields carry neither a title nor a description, so their names alone
// would be opaque. Add what this UI knows about the value of the Web provider
// selection (the stock page writes `deepseek-official`/`deepseek-search-api` and
// `http`/`deepseek-fetch-api`) so the plain text fields stay usable without it.
const fieldNotes: Record<string, string> = {
  'web.searchProvider': '検索に使う提供元の名前です。DeepSeek の Messages 検索は deepseek-official、Web 検索 API は deepseek-search-api です。',
  'web.fetchProvider': 'ページを取得する提供元の名前です。標準のページ取得は http、Web 検索 API は deepseek-fetch-api です。',
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key)
const japanese = (value?: string) => value && /[\u3040-\u30ff\u3400-\u9fff]/.test(value) ? value : undefined

// Limits, checked against the bundled DSH 0.2.0-rc.2 forms (docs/design/08-settings.md, Issue #77):
// the largest form (llm-pi-ai) has 144 nodes, 153 decode visits, depth 10, and 19 fields at most.
// Protection and value traversals grow with user data: 10 custom providers x 10 models already
// cost 6,612 steps in the former protection walk, so those two budgets are larger.
const MAX_SCHEMA_NODES = 1024
export const MAX_SCHEMA_WORK = 4096
const MAX_SCHEMA_DEPTH = 32
const MAX_SCHEMA_FIELDS = 512
const MAX_VALUE_WORK = 32768
const MAX_VALUE_DEPTH = 64
class SchemaTooComplex extends Error {}
class ValueTooLarge extends Error {}

// Decoded nodes are shared between paths; freeze them so an accidental write fails loudly in development and tests.
// (The cast keeps this file loadable by plain Node and the host type check, where Vite's env is absent.)
const freezeNodes = (import.meta as { env?: { PROD?: boolean } }).env?.PROD !== true
const seal = (node: Mutable<SchemaNode>): SchemaNode => {
  if (freezeNodes) { Object.freeze(node.meta); Object.freeze(node.dict); Object.freeze(node.list); Object.freeze(node) }
  return node
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
const TRUNCATED: SchemaNode = seal({ truncated: true })

/**
 * Resolve Cordis' node table without mutating it or following cycles. A node beyond a
 * limit, too deep, or closing a cycle becomes `{ truncated: true }` on its own; the rest
 * of the definition is still decoded.
 */
export function decodeSchema(input: unknown): SchemaNode {
  if (!isObject(input)) return seal({})
  if (!isObject(input.refs) || !('uid' in input)) return seal({})
  const refs = input.refs
  const cache = new Map<string, SchemaNode>()
  let work = 0
  let pathCuts = 0
  function visit(id: unknown, ancestors: Set<string>, depth: number): SchemaNode {
    if (++work > MAX_SCHEMA_WORK) return TRUNCATED
    if (depth > MAX_SCHEMA_DEPTH) { pathCuts++; return TRUNCATED }
    if (typeof id !== 'string' && typeof id !== 'number') return seal({})
    const key = String(id)
    if (!safeKey(key) || !Object.hasOwn(refs, key)) return seal({})
    // A cycle cut hides the definition below it, which may hold a password role.
    if (ancestors.has(key)) { pathCuts++; return TRUNCATED }
    const cached = cache.get(key)
    if (cached) return cached
    if (cache.size >= MAX_SCHEMA_NODES) return TRUNCATED
    const node = refs[key]
    if (!isObject(node)) return seal({})
    const seen = new Set(ancestors).add(key)
    const previousCuts = pathCuts
    const result: Mutable<SchemaNode> = { type: typeof node.type === 'string' ? node.type : undefined }
    if ('value' in node) result.value = node.value as SettingValue
    // Copy so that freezing never touches the caller's document.
    if (isObject(node.meta)) result.meta = { ...node.meta } as SchemaMeta
    if (isObject(node.dict)) result.dict = Object.fromEntries(Object.entries(node.dict).filter(([name]) => safeKey(name)).map(([name, child]) => [name, visit(child, seen, depth + 1)]))
    if (Array.isArray(node.list)) result.list = node.list.map(child => visit(child, seen, depth + 1))
    if ('inner' in node) result.inner = visit(node.inner, seen, depth + 1)
    if ('sKey' in node) result.sKey = visit(node.sKey, seen, depth + 1)
    seal(result)
    // A result cut by depth or an ancestor depends on its path and cannot be reused elsewhere.
    if (pathCuts === previousCuts) cache.set(key, result)
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
      : ['web', 'web-search-deepseek', 'web-deepseek-api', 'bash-sandbox', 'pwsh-sandbox', 'locale'].includes(row.ns) ? 'tools' : 'other'
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

const tooComplex = '設定の定義が複雑なため表示できません。標準の画面で確認してください。'
const notice = (shown: number): SettingField => ({
  path: [], kind: 'readonly', omitted: true, label: '表示していない項目', overridden: false, disabled: true, required: false,
  description: shown ? `設定の項目や値が多いため、先頭の ${shown} 項目だけを表示しています。残りの項目は標準の画面で確認してください。` : tooComplex,
})
const unknownDescription = '設定の定義を読み切れないため、値を表示しません。標準の画面で確認してください。'
const largeValueDescription = '値が大きいため表示を省略しました。標準の画面で確認してください。'

/** Paths with prefix queries in O(depth). */
class PathSet {
  private readonly exact = new Set<string>()
  private readonly prefixes = new Set<string>()
  constructor(paths: readonly SettingPath[] = []) { for (const path of paths) this.add(path) }
  add(path: SettingPath): void {
    this.exact.add(JSON.stringify(path))
    for (let length = 0; length <= path.length; length++) this.prefixes.add(JSON.stringify(path.slice(0, length)))
  }
  /** A member is `path` or one of its ancestors. */
  covers(path: SettingPath): boolean {
    for (let length = 0; length <= path.length; length++) if (this.exact.has(JSON.stringify(path.slice(0, length)))) return true
    return false
  }
  /** A member is `path` or one of its descendants. */
  touches(path: SettingPath): boolean { return this.prefixes.has(JSON.stringify(path)) }
}

/**
 * Build the field models. Top-level items are shown in order until the next one would
 * exceed a limit; the rest is replaced by one notice pointing to the stock settings page.
 * A node whose definition is unknown (truncated) becomes a value-less placeholder on its own.
 */
export function schemaFields(namespace: SettingsNamespace, catalog?: PermissionCatalog): SettingField[] {
  let fields: SettingField[]
  try { fields = boundedSchemaFields(namespace) } catch (error) {
    if (!(error instanceof SchemaTooComplex)) throw error
    // Never show an incompletely redacted value after a traversal limit.
    return [notice(0)]
  }
  return fields.map(field => {
    const updated = namespace.ns === 'permission' && field.kind !== 'masked' && !field.omitted && field.path.length === 1 && field.path[0] === 'defaultPreset'
      ? { ...field, kind: 'select' as const, value: field.value ?? catalog?.defaultPreset,
          disabled: field.disabled || !catalog, options: catalog?.defaultOptions.map(option => ({ label: presetDisplayName(option.value, option.name), value: option.value })) ?? [] }
      : field
    const note = updated.path.length === 1 ? fieldNotes[`${namespace.ns}.${updated.path[0]}`] : undefined
    return note ? { ...updated, description: updated.description ? `${updated.description}\n${note}` : note } : updated
  })
}
function boundedSchemaFields(namespace: SettingsNamespace): SettingField[] {
  const schema = decodeSchema(namespace.schema)
  let protectionWork = 0, valueWork = 0, fieldCount = 0
  const protectedPaths = new PathSet((namespace.secrets ?? []).map(entry => entry.path))
  const unknownPaths = new PathSet()
  const containsPath = (parent: SettingPath, child: SettingPath) => parent.length <= child.length && parent.every((key, index) => key === child[index])

  /** Members of nested intersections, each shared definition once. */
  function members(node: SchemaNode, disabled: boolean): { node: SchemaNode; disabled: boolean }[] {
    const result: { node: SchemaNode; disabled: boolean }[] = []
    const seen = [new Set<SchemaNode>(), new Set<SchemaNode>()]
    let work = 0
    const walk = (current: SchemaNode, off: boolean): void => {
      if (++work > MAX_SCHEMA_WORK) throw new SchemaTooComplex()
      const visited = seen[Number(off)]!
      if (visited.has(current)) return
      visited.add(current)
      if (current.type === 'intersect' && !current.truncated) for (const child of current.list ?? []) walk(child, off || current.meta?.disabled === true)
      else result.push({ node: current, disabled: off })
    }
    walk(node, disabled)
    return result
  }

  // Whether a definition contains a password role or an unknown part. Decoded nodes form a
  // DAG without cycles (cycles are cut), so memoizing by identity keeps this linear.
  const sensitiveNodes = new Map<SchemaNode, boolean>()
  function sensitive(node: SchemaNode): boolean {
    let known = sensitiveNodes.get(node)
    if (known === undefined) {
      known = node.truncated === true || node.meta?.role === 'password' || Object.values(node.dict ?? {}).some(sensitive)
        || (node.list ?? []).some(sensitive) || (node.inner !== undefined && sensitive(node.inner))
      sensitiveNodes.set(node, known)
    }
    return known
  }
  // Password roles also protect values nested inside read-only arrays/dictionaries.
  // Unknown (truncated) definitions hide every value at or below their path.
  // Subtrees without either add nothing, so large ordinary data costs no protection work.
  function collectProtected(node: SchemaNode, path: string[], value: unknown): void {
    if (!sensitive(node)) return
    if (++protectionWork > MAX_VALUE_WORK || path.length > MAX_VALUE_DEPTH) throw new SchemaTooComplex()
    if (node.truncated) { unknownPaths.add(path); return }
    if (node.meta?.role === 'password') { protectedPaths.add(path); return }
    if (node.dict) for (const [key, child] of Object.entries(node.dict)) collectProtected(child, [...path, key], isObject(value) ? value[key] : undefined)
    if (node.list) for (const child of new Set(node.list)) collectProtected(child, path, value)
    if (node.inner && (isObject(value) || Array.isArray(value))) {
      if (node.inner.truncated) unknownPaths.add(path)
      else for (const [key, child] of Object.entries(value)) if (safeKey(key)) collectProtected(node.inner, [...path, key], child)
    }
  }

  // Remove protected descendants before a read-only parent can reach JSON formatting.
  function visibleValue(value: SettingValue | undefined, path: string[], depth: number): SettingValue | undefined {
    if (++valueWork > MAX_VALUE_WORK || depth > MAX_VALUE_DEPTH) throw new ValueTooLarge()
    if (protectedPaths.covers(path) || unknownPaths.covers(path)) return undefined
    if (Array.isArray(value)) return value.map((child, index) => visibleValue(child, [...path, String(index)], depth + 1) ?? null)
    if (isObject(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => safeKey(key)).flatMap(([key, child]) => {
      const visible = visibleValue(child as SettingValue, [...path, key], depth + 1)
      return visible === undefined ? [] : [[key, visible]]
    }))
    return value
  }
  function visibleAt(path: string[]): SettingValue | undefined {
    const value = valueAt(namespace.value, path)
    if (protectedPaths.covers(path) || unknownPaths.covers(path)) return undefined
    // Scalars cost nothing, so one huge collection cannot hide the ordinary fields after it.
    return value !== null && typeof value === 'object' ? visibleValue(value, path, path.length) : value
  }

  function fields(node: SchemaNode, path: string[], inheritedDisabled = false): SettingField[] {
    return members(node, inheritedDisabled).flatMap(member => member.node.type === 'object' && member.node.dict
      ? Object.entries(member.node.dict).map(([key, child], index) => field(child, [...path, key], index, member.disabled || member.node.meta?.disabled === true))
      : [field(member.node, path, 0, member.disabled)])
  }
  function field(node: SchemaNode, path: string[], index: number, inheritedDisabled: boolean): SettingField {
    if (++fieldCount > MAX_SCHEMA_FIELDS) throw new SchemaTooComplex()
    const meta = node.meta ?? {}
    const masked = protectedPaths.covers(path)
    let kind: SettingField['kind'] = masked ? 'masked'
      : unknownPaths.covers(path) ? 'readonly'
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
    const omit = (description: string) => Object.assign(result, { kind: 'readonly', omitted: true, disabled: true, description })
    // Masked fields never carry a stored value into the view model.
    if (kind === 'masked') {
      const status = namespace.secrets?.find(entry => containsPath(entry.path, path))
      result.registered = status ? status.set : valueAt(namespace.value, path) !== undefined
      return result
    }
    // An unknown definition at or below a read-only value may hide a password role.
    if (kind !== 'group' && (unknownPaths.covers(path) || unknownPaths.touches(path))) return omit(unknownDescription)
    if (kind === 'group') {
      result.children = fields(node, path, result.disabled)
      return result
    }
    try { result.value = visibleAt(path) } catch (error) {
      if (!(error instanceof ValueTooLarge)) throw error
      return omit(largeValueDescription)
    }
    if (kind === 'select') result.options = node.list!.map((child, optionIndex) => ({
      value: child.value as string | number | boolean | null,
      label: japanese(child.meta?.description) ?? japanese(child.meta?.title) ?? (typeof child.value === 'boolean' ? child.value ? '有効' : '無効' : child.value === null ? '指定しない' : String(child.value ?? `選択肢 ${optionIndex + 1}`)),
    }))
    return result
  }

  if (schema.meta?.role === 'password') protectedPaths.add([])
  if (protectedPaths.covers([])) return [field(schema, [], 0, false)]
  if (schema.truncated) return [notice(0)]

  // Top-level items in display order: the same walk as fields(schema, []).
  interface Item { node: SchemaNode; path: string[]; index: number; disabled: boolean }
  const items: Item[] = members(schema, false).flatMap(member => member.node.type === 'object' && member.node.dict
    ? Object.entries(member.node.dict).map(([key, child], index) => ({ node: child, path: [key], index, disabled: member.disabled || member.node.meta?.disabled === true }))
    : [{ node: member.node, path: [], index: 0, disabled: member.disabled }])

  // Collect protection per top-level key (all intersection members of a key together),
  // so a shown key never misses a password role declared by a later member.
  const safeKeys = new Set<string>()
  let protectionComplete = false
  try {
    for (const item of items) if (!item.path.length) collectProtected(item.node, [], namespace.value)
    const byKey = new Map<string, Item[]>()
    for (const item of items) if (item.path.length) byKey.set(item.path[0]!, [...byKey.get(item.path[0]!) ?? [], item])
    for (const [key, group] of byKey) {
      for (const item of group) collectProtected(item.node, item.path, valueAt(namespace.value, item.path))
      safeKeys.add(key)
    }
    protectionComplete = true
  } catch (error) { if (!(error instanceof SchemaTooComplex)) throw error }

  const result: SettingField[] = []
  for (const item of items) {
    // A root-level member shows the whole value, so it needs every key checked.
    const safe = item.path.length ? safeKeys.has(item.path[0]!) : protectionComplete
    if (safe) try { result.push(field(item.node, item.path, item.index, item.disabled)); continue } catch (error) {
      if (!(error instanceof SchemaTooComplex)) throw error
    }
    result.push(notice(result.length))
    break
  }
  return result
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
  if (!matchesNumberStep(value, field.min, field.step)) return { ok: false, message: `${field.step} 刻みで入力してください。` }
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
    const value = field?.value
    if (typeof value !== 'string' || value === '') return 'プリセット：未設定'
    const matched = field?.options?.find(option => Object.is(option.value, value))?.label
    if (matched !== undefined) return matched
    // No loaded catalog: show the built-in Japanese name, or Custom for an unmatched value.
    const name = presetDisplayName(value, '')
    return name === value ? 'カスタム' : name
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
  const counts = { registered: 0, missing: 0, unnecessary: 0, unknown: 0, unset: 0 }
  for (const row of state.rows) counts[row.status]++
  return [
    counts.registered && `登録済み ${counts.registered}`,
    counts.missing && `未登録 ${counts.missing}`,
    counts.unset && `未設定 ${counts.unset}`,
    counts.unnecessary && `キー不要 ${counts.unnecessary}`,
    counts.unknown && `未確認 ${counts.unknown}`,
  ].filter(Boolean).join('・')
}
