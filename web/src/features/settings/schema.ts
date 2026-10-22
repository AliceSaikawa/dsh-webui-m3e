import type { ProviderState } from './providers.ts'
import type { PermissionCatalog } from '../composer/api.ts'
import { presetDisplayName } from '../../dsh/permission-presets.ts'
import { permissionPresetMessages } from '../../dsh/messages.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { formatNumber } from '../../i18n/format.ts'
import type { Locale } from '../../i18n/locale.ts'
import { matchesNumberStep } from './number-step.ts'
import { settingsSchemaMessages } from './messages.ts'

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
  { id: 'models', icon: 'smart_toy' },
  { id: 'permission', icon: 'shield' },
  { id: 'agent', icon: 'tune' },
  { id: 'providers', icon: 'key' },
  { id: 'tools', icon: 'travel_explore' },
  { id: 'other', icon: 'tune' },
] as const
export type SettingsPage = typeof settingsPages[number]['id']

/** The texts these functions use; tests may pass another language's catalog. */
export type SettingsSchemaTexts = Translation<typeof settingsSchemaMessages.ja>

const schemaText = (): SettingsSchemaTexts => messagesOf(settingsSchemaMessages, 'ja')

const NAME_KEYS: Readonly<Record<string, keyof SettingsSchemaTexts>> = {
  'agent-default-model': 'nameAgentDefaultModel', 'subagent-model-selection-settings': 'nameSubagentModel',
  permission: 'namePermission', 'agent-loop': 'nameAgentLoop',
  'web-search-deepseek': 'nameWebSearch', web: 'nameWeb', 'web-deepseek-api': 'nameWebApi',
  'bash-sandbox': 'nameShell', 'pwsh-sandbox': 'nameShell',
  defaultPreset: 'nameDefaultPreset',
  timeoutMs: 'nameTimeout', maxOutputBytes: 'nameMaxOutputBytes',
  enabled: 'nameEnabled', model: 'nameModel', default: 'nameDefault', provider: 'nameProvider',
  name: 'nameName', mode: 'nameMode', maxSteps: 'nameMaxSteps', timeout: 'nameTimeout',
  maxRetries: 'nameMaxRetries', count: 'nameCount', temperature: 'nameTemperature',
  retry: 'nameRetry', interval: 'nameInterval', command: 'nameCommand', language: 'nameLanguage',
  searchProvider: 'nameSearchProvider', fetchProvider: 'nameFetchProvider',
  apiKey: 'nameApiKey', apiKeyEnv: 'nameApiKeyEnv', baseURL: 'nameBaseURL', sendOriginalQuestion: 'nameSendOriginalQuestion',
  reasoningEffort: 'nameReasoningEffort',
}

const PAGE_KEYS: Readonly<Record<SettingsPage, keyof SettingsSchemaTexts>> = {
  models: 'pageModels', permission: 'pagePermission', agent: 'pageAgent',
  providers: 'pageProviders', tools: 'pageTools', other: 'pageOther',
}

function knownName(name: string, text: SettingsSchemaTexts): string | undefined {
  const key = Object.hasOwn(NAME_KEYS, name) ? NAME_KEYS[name] : undefined
  return key === undefined ? undefined : text[key] as string
}

export function namespaceTitle(ns: string, text: SettingsSchemaTexts = schemaText()): string {
  return knownName(ns, text) ?? ns
}

export function settingsPageTitle(page: SettingsPage, text: SettingsSchemaTexts = schemaText()): string {
  return text[PAGE_KEYS[page]] as string
}

// Some DSH fields carry neither a title nor a description, so their names alone
// would be opaque. Add what this UI knows about the value of the Web provider
// selection (the stock page writes `deepseek-official`/`deepseek-search-api` and
// `http`/`deepseek-fetch-api`) so the plain text fields stay usable without it.
const FIELD_NOTE_KEYS: Readonly<Record<string, keyof SettingsSchemaTexts>> = {
  'web.searchProvider': 'noteWebSearchProvider',
  'web.fetchProvider': 'noteWebFetchProvider',
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key)

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/u
const KANA = /[\u3040-\u30ff]/u
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/u
const ASCII_LETTER = /[A-Za-z]/u

/**
 * A Host title or description is shown only when it is written in the page
 * language. Japanese keeps the original test; Chinese accepts Han characters
 * without kana; English accepts printable ASCII with at least one letter.
 */
export function hostTextInLocale(value: string | undefined, locale: Locale): string | undefined {
  if (!value) return undefined
  if (locale === 'ja') return JAPANESE_TEXT.test(value) ? value : undefined
  if (locale === 'zh') return HAN.test(value) && !KANA.test(value) ? value : undefined
  return PRINTABLE_ASCII.test(value) && ASCII_LETTER.test(value) ? value : undefined
}

interface SchemaContext {
  readonly text: SettingsSchemaTexts
  readonly locale: Locale
}

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

/**
 * Namespaces with a dedicated row in the General section (general.ts). They are
 * excluded from the generic pages; every row's namespace must be listed here.
 */
export const generalNamespaces = ['ui-settings', 'ui-chat', 'locale'] as const

export function groupNamespaces(namespaces: readonly SettingsNamespace[]): Record<SettingsPage, SettingsNamespace[]> {
  const groups: Record<SettingsPage, SettingsNamespace[]> = { models: [], permission: [], agent: [], providers: [], tools: [], other: [] }
  for (const row of namespaces) {
    // `ui-*` belongs to the stock screen. The ones M3E edits have a dedicated row in the
    // General section (general.ts) and, like the rest, never become generic forms.
    if (row.ns.startsWith('ui-') || (generalNamespaces as readonly string[]).includes(row.ns)) continue
    // The dedicated mode page owns both the roster and selectedDefault, so this
    // namespace never appears as a generic form.
    if (row.ns === 'agent-preset-registry') continue
    // Explicit M3E editors mirror the stock custom pages. Other suppressed
    // entries (including provider internals) must not become generic forms.
    if (!row.autoGenerate && !['agent-default-model', 'subagent-model-selection-settings', 'permission', 'bash-sandbox', 'pwsh-sandbox'].includes(row.ns)) continue
    const page: SettingsPage = row.ns.startsWith('llm-') ? 'providers'
      : ['agent-default-model', 'subagent-model-selection-settings'].includes(row.ns) ? 'models'
      : row.ns === 'permission' ? 'permission'
      : row.ns === 'agent-loop' ? 'agent'
      : ['web', 'web-search-deepseek', 'web-deepseek-api', 'bash-sandbox', 'pwsh-sandbox'].includes(row.ns) ? 'tools' : 'other'
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

const notice = (context: SchemaContext, shown: number): SettingField => ({
  path: [], kind: 'readonly', omitted: true, label: context.text.notShownLabel, overridden: false, disabled: true, required: false,
  description: shown
    ? context.text.notShownDescription(formatNumber(context.locale, shown, { useGrouping: false }))
    : context.text.tooComplex,
})

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
export function schemaFields(namespace: SettingsNamespace, catalog?: PermissionCatalog,
  text: SettingsSchemaTexts = schemaText(), locale: Locale = 'ja'): SettingField[] {
  const context: SchemaContext = { text, locale }
  const permissionText = messagesOf(permissionPresetMessages, locale)
  let fields: SettingField[]
  try { fields = boundedSchemaFields(namespace, context) } catch (error) {
    if (!(error instanceof SchemaTooComplex)) throw error
    // Never show an incompletely redacted value after a traversal limit.
    return [notice(context, 0)]
  }
  return fields.map(field => {
    const updated = namespace.ns === 'permission' && field.kind !== 'masked' && !field.omitted && field.path.length === 1 && field.path[0] === 'defaultPreset'
      ? { ...field, kind: 'select' as const, value: field.value ?? catalog?.defaultPreset,
          disabled: field.disabled || !catalog, options: catalog?.defaultOptions.map(option => ({ label: presetDisplayName(option.value, option.name, permissionText), value: option.value })) ?? [] }
      : field
    const noteKey = updated.path.length === 1 ? FIELD_NOTE_KEYS[`${namespace.ns}.${updated.path[0]}`] : undefined
    const note = noteKey === undefined ? undefined : text[noteKey] as string
    return note ? { ...updated, description: updated.description ? `${updated.description}\n${note}` : note } : updated
  })
}
function boundedSchemaFields(namespace: SettingsNamespace, context: SchemaContext): SettingField[] {
  const schema = decodeSchema(namespace.schema)
  let protectionWork = 0, valueWork = 0, fieldCount = 0
  const protectedPaths = new PathSet((namespace.secrets ?? []).map(entry => entry.path))
  const unknownPaths = new PathSet()
  const containsPath = (parent: SettingPath, child: SettingPath) => parent.length <= child.length && parent.every((key, index) => key === child[index])

  /**
   * Members of nested intersections, each shared definition once per disabled state. A password
   * role on an intersection protects all of its members, like `disabled` it travels down the nesting.
   */
  function members(node: SchemaNode, disabled: boolean): { node: SchemaNode; disabled: boolean; password: boolean }[] {
    const result: { node: SchemaNode; disabled: boolean; password: boolean }[] = []
    // Per disabled state: the strongest password flag a node was walked with, and its entry.
    const seen = [new Map<SchemaNode, boolean>(), new Map<SchemaNode, boolean>()]
    const entries = [new Map<SchemaNode, { node: SchemaNode; disabled: boolean; password: boolean }>(), new Map<SchemaNode, { node: SchemaNode; disabled: boolean; password: boolean }>()]
    let work = 0
    const walk = (current: SchemaNode, off: boolean, pw: boolean): void => {
      if (++work > MAX_SCHEMA_WORK) throw new SchemaTooComplex()
      pw = pw || current.meta?.role === 'password'
      const visited = seen[Number(off)]!
      const before = visited.get(current)
      // A node first walked without a password role is walked again once a password path
      // reaches it, so the entry below cannot keep the value that the later path protects.
      if (before === true || (before === false && !pw)) return
      visited.set(current, pw)
      if (current.type === 'intersect' && !current.truncated) for (const child of current.list ?? []) walk(child, off || current.meta?.disabled === true, pw)
      else {
        const known = entries[Number(off)]!.get(current)
        if (known) known.password = true
        else { const entry = { node: current, disabled: off, password: pw }; entries[Number(off)]!.set(current, entry); result.push(entry) }
      }
    }
    walk(node, disabled, false)
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
    const label = hostTextInLocale(meta.title, context.locale) ?? knownName(path.at(-1) ?? '', context.text)
      ?? context.text.itemLabel(formatNumber(context.locale, index + 1, { useGrouping: false }))
    const result: SettingField = {
      path, kind, label, description: hostTextInLocale(meta.description, context.locale)
        ?? (meta.description ? context.text.descriptionOnStandardScreen : ''),
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
    if (kind !== 'group' && (unknownPaths.covers(path) || unknownPaths.touches(path))) return omit(context.text.unknownDescription)
    if (kind === 'group') {
      result.children = fields(node, path, result.disabled)
      return result
    }
    try { result.value = visibleAt(path) } catch (error) {
      if (!(error instanceof ValueTooLarge)) throw error
      return omit(context.text.largeValueDescription)
    }
    if (kind === 'select') result.options = node.list!.map((child, optionIndex) => ({
      value: child.value as string | number | boolean | null,
      label: hostTextInLocale(child.meta?.description, context.locale) ?? hostTextInLocale(child.meta?.title, context.locale)
        ?? (typeof child.value === 'boolean' ? child.value ? context.text.optionEnabled : context.text.optionDisabled
          : child.value === null ? context.text.optionUnspecified
          : String(child.value ?? context.text.optionFallback(formatNumber(context.locale, optionIndex + 1, { useGrouping: false })))),
    }))
    return result
  }

  if (schema.meta?.role === 'password') protectedPaths.add([])
  if (protectedPaths.covers([])) return [field(schema, [], 0, false)]
  if (schema.truncated) return [notice(context, 0)]

  // Top-level items in display order: the same walk as fields(schema, []).
  interface Item { node: SchemaNode; path: string[]; index: number; disabled: boolean; password: boolean }
  // A password role on the flattened member object protects its own children, so it must
  // survive the flattening: every member of the object inherits the protection.
  const items: Item[] = members(schema, false).flatMap(member => {
    if (member.node.type === 'object' && member.node.dict)
      return Object.entries(member.node.dict).map(([key, child], index) => ({ node: child, path: [key], index, disabled: member.disabled || member.node.meta?.disabled === true, password: member.password }))
    return [{ node: member.node, path: [], index: 0, disabled: member.disabled, password: member.password }]
  })

  // Collect protection per top-level key (all intersection members of a key together),
  // so a shown key never misses a password role declared by a later member.
  const safeKeys = new Set<string>()
  let protectionComplete = false
  try {
    for (const item of items) if (!item.path.length) {
      if (item.password) protectedPaths.add([])
      else collectProtected(item.node, [], namespace.value)
    }
    const byKey = new Map<string, Item[]>()
    for (const item of items) if (item.path.length) byKey.set(item.path[0]!, [...byKey.get(item.path[0]!) ?? [], item])
    for (const [key, group] of byKey) {
      for (const item of group) {
        if (item.password) protectedPaths.add(item.path)
        else collectProtected(item.node, item.path, valueAt(namespace.value, item.path))
      }
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
    result.push(notice(context, result.length))
    break
  }
  return result
}

export function selectFieldState(field: Pick<SettingField, 'options'>, value: SettingValue | undefined,
  text: SettingsSchemaTexts = schemaText()): { index: number; placeholder?: string } {
  const index = field.options?.findIndex(option => Object.is(option.value, value)) ?? -1
  return { index, placeholder: index >= 0 ? undefined : value === undefined ? text.notSet : text.notInOptions }
}

export function parseFieldInput(field: SettingField, input: string, text: SettingsSchemaTexts = schemaText(),
  locale: Locale = 'ja'): { ok: true; value: string | number | undefined } | { ok: false; message: string } {
  if (field.kind !== 'number') {
    if (!input.trim()) return field.required
      ? { ok: false, message: text.valueRequired }
      : { ok: true, value: undefined }
    return { ok: true, value: input }
  }
  if (!input.trim()) return { ok: false, message: text.numberRequired }
  const value = Number(input)
  if (!Number.isFinite(value)) return { ok: false, message: text.numberInvalid }
  if (field.min !== undefined && value < field.min) {
    return { ok: false, message: text.numberMin(formatNumber(locale, field.min, { useGrouping: false })) }
  }
  if (field.max !== undefined && value > field.max) {
    return { ok: false, message: text.numberMax(formatNumber(locale, field.max, { useGrouping: false })) }
  }
  if (!matchesNumberStep(value, field.min, field.step)) {
    return { ok: false, message: text.numberStep(formatNumber(locale, field.step ?? 0, { useGrouping: false })) }
  }
  return { ok: true, value }
}

export function buildPatch(path: SettingPath, value: SettingValue, text: SettingsSchemaTexts = schemaText()): SettingObject {
  checkPath(path, text)
  return path.reduceRight<SettingValue>((nested, key) => ({ [key]: nested }), value) as SettingObject
}
export function buildReset(path: SettingPath, text: SettingsSchemaTexts = schemaText()): { op: 'unset'; path: string[] }[] {
  checkPath(path, text)
  return [{ op: 'unset', path: [...path] }]
}
function checkPath(path: SettingPath, text: SettingsSchemaTexts): void {
  if (!path.length || path.some(key => !key || !safeKey(key))) throw new Error(text.invalidPath)
}

export function formatSetting(value: SettingValue | undefined, text: SettingsSchemaTexts = schemaText()): string {
  if (value === undefined || value === null) return text.notSet
  if (typeof value === 'boolean') return value ? text.optionEnabled : text.optionDisabled
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

export function pageSummary(page: SettingsPage, namespaces: readonly SettingsNamespace[], catalog?: PermissionCatalog,
  text: SettingsSchemaTexts = schemaText(), locale: Locale = 'ja'): string {
  const leaves = (fields: SettingField[]): SettingField[] => fields.flatMap(field => field.children ? leaves(field.children) : field)
  const fields = new Map(namespaces.map(namespace => [namespace.ns, leaves(schemaFields(namespace, catalog, text, locale))]))
  // Select documented setting paths after redaction, never raw values or schema order.
  const fieldAt = (ns: string, key: string) => fields.get(ns)?.find(field => field.path.length === 1 && field.path[0] === key && ['text', 'select', 'number', 'switch'].includes(field.kind))
  const textAt = (ns: string, key: string) => {
    const field = fieldAt(ns, key)
    if (!field || field.value === undefined || field.value === null || field.value === '') return undefined
    return field.options?.find(option => Object.is(option.value, field.value))?.label ?? formatSetting(field.value, text)
  }
  const labeled = (label: string, value: string | undefined) => value === undefined ? undefined : text.labeled(label, value)
  const join = (values: (string | undefined)[]) => values.filter(value => value !== undefined).join(text.listSeparator) || text.summaryPlaceholder
  if (page === 'models') {
    const model = textAt('agent-default-model', 'model')
    const effort = textAt('agent-default-model', 'reasoningEffort')
    return model === undefined ? text.summaryDefaultModelUnset : join([model, labeled(text.nameReasoningEffort, effort)])
  }
  if (page === 'permission') {
    const field = fieldAt('permission', 'defaultPreset')
    const value = field?.value
    if (typeof value !== 'string' || value === '') return text.summaryPresetUnset
    const matched = field?.options?.find(option => Object.is(option.value, value))?.label
    if (matched !== undefined) return matched
    // No loaded catalog: show the built-in name in this language, or Custom for an unmatched value.
    const name = presetDisplayName(value, '', messagesOf(permissionPresetMessages, locale))
    return name === value ? text.summaryCustom : name
  }
  if (page === 'agent') return join([
    labeled(text.summaryParallelToolCalls, textAt('agent-loop', 'maxParallelToolCalls')),
  ])
  if (page === 'tools') return join([
    labeled(text.summarySearchModel, textAt('web-search-deepseek', 'model')),
    labeled(text.summarySearchMaxUses, textAt('web-search-deepseek', 'maxUses')),
  ])
  if (page === 'providers') return text.providerLoading
  return [...fields.values()].flat()
    .filter(field => ['text', 'select', 'number', 'switch'].includes(field.kind) && field.value !== undefined)
    .slice(0, 2).map(field => text.labeled(field.label, formatSetting(field.value, text))).join(text.listSeparator) || text.summaryPlaceholder
}

/** Only registration states enter the top-level summary, never key material. */
export function providerSummary(state: Pick<ProviderState, 'phase' | 'rows'>,
  text: SettingsSchemaTexts = schemaText(), locale: Locale = 'ja'): string {
  if (state.phase === 'loading') return text.providerLoading
  if (state.phase === 'error') return text.providerCheckFailed
  if (!state.rows.length) return text.providerNone
  const counts = { registered: 0, missing: 0, unnecessary: 0, unknown: 0, unset: 0 }
  for (const row of state.rows) counts[row.status]++
  const count = (value: number) => formatNumber(locale, value, { useGrouping: false })
  return [
    counts.registered && text.providerRegistered(count(counts.registered)),
    counts.missing && text.providerMissing(count(counts.missing)),
    counts.unset && text.providerUnset(count(counts.unset)),
    counts.unnecessary && text.providerUnnecessary(count(counts.unnecessary)),
    counts.unknown && text.providerUnknown(count(counts.unknown)),
  ].filter(Boolean).join(text.listSeparator)
}
