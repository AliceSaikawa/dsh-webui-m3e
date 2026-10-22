import { decodeSchema, valueAt, type SettingsNamespace, type SettingObject, type SettingValue, type SchemaNode } from './schema.ts'
import { settingFieldAccess } from './field-access.ts'
import { matchesNumberStep } from './number-step.ts'
import type { SettingsOperation } from './store.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import { customProviderMessages } from './messages.ts'

export type CustomProviderTexts = Translation<typeof customProviderMessages.ja>
const customText = (): CustomProviderTexts => messagesOf(customProviderMessages, currentLocale())

export const CUSTOM_NS = 'llm-pi-ai'
export const objectValue = (value: unknown): value is SettingObject => value !== null && typeof value === 'object' && !Array.isArray(value)
export const providerRef = (id: string) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
const text = (value: unknown) => typeof value === 'string' ? value : ''
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
let nextRow = 0
export interface ModelInputs { id: string; name: string; contextWindow: string; maxTokens: string; input: string[]; inheritedInput: boolean }
export interface ModelDraft extends ModelInputs { row: string; original: SettingObject; initial: ModelInputs }
export interface CustomDraft { id: string; displayName: string; baseURL: string; api: string; models: ModelDraft[] }
export type CustomErrors = Record<string, string>
export function validBaseURL(value: string): boolean {
  const url = value.trim()
  if (!/^https?:\/\//i.test(url)) return false
  try { return ['http:', 'https:'].includes(new URL(url).protocol) && Boolean(new URL(url).hostname) } catch { return false }
}

export function protocolChoices(namespace: SettingsNamespace): string[] {
  return (decodeSchema(namespace.schema).dict?.providers?.inner?.dict?.api?.list ?? [])
    .flatMap(node => node.type === 'const' && typeof node.value === 'string' ? [node.value] : [])
}
export function modelDraft(source: SettingObject = {}): ModelDraft {
  const initial: ModelInputs = { id: text(source.id), name: text(source.name),
    contextWindow: typeof source.contextWindow === 'number' ? String(source.contextWindow) : '',
    maxTokens: typeof source.maxTokens === 'number' ? String(source.maxTokens) : '',
    input: Array.isArray(source.input) ? source.input.filter((v): v is string => typeof v === 'string') : [],
    inheritedInput: !Array.isArray(source.input) || source.input.length === 0 }
  return { ...structuredClone(initial), row: `model-${++nextRow}`, original: structuredClone(source), initial }
}
export function customDraft(namespace: SettingsNamespace, id?: string): CustomDraft {
  const value = id ? valueAt(namespace.value, ['providers', id]) : undefined
  const profile = objectValue(value) ? value : {}
  return { id: id ?? '', displayName: text(profile.displayName), baseURL: text(profile.baseURL),
    api: text(profile.api) || (id ? '' : protocolChoices(namespace)[0] ?? ''),
    models: id ? (Array.isArray(profile.models) ? profile.models.filter(objectValue).map(modelDraft) : []) : [modelDraft()] }
}
export function customFieldWritable(namespace: SettingsNamespace, id: string, key: string): boolean {
  const path = ['providers', id, key]
  if (!settingFieldAccess(namespace, { path, kind: 'readonly', label: '', description: '', overridden: true, disabled: false, required: false }).reset) return false
  const blocked = (node: SchemaNode) => node.truncated || node.meta?.disabled || node.meta?.role === 'password'
  let node: SchemaNode | undefined = decodeSchema(namespace.schema)
  for (const part of path) {
    if (node && blocked(node)) return false
    node = node?.dict?.[part] ?? node?.inner
  }
  const containsBlocked = (node: SchemaNode): boolean => Boolean(blocked(node)) || Object.values(node.dict ?? {}).some(containsBlocked)
    || Boolean(node.inner && containsBlocked(node.inner)) || Boolean(node.list?.some(containsBlocked))
  return !node || !containsBlocked(node)
}
export function validateCustom(draft: CustomDraft, choices: readonly string[], taken: readonly string[], editing: boolean, namespace?: SettingsNamespace,
  text: CustomProviderTexts = customText()): CustomErrors {
  const errors: CustomErrors = {}
  const id = draft.id
  if (!editing) {
    if (!id) errors.id = text.errIDRequired
    else if (['__proto__', 'constructor', 'prototype'].includes(id)) errors.id = text.errIDReserved
    else if (taken.includes(id)) errors.id = text.errIDTaken
  }
  if (!draft.baseURL.trim()) errors.baseURL = text.errBaseURLRequired
  else if (!validBaseURL(draft.baseURL)) errors.baseURL = text.errBaseURLInvalid
  if (!choices.includes(draft.api)) errors.api = text.errAPIRequired
  if (!draft.models.length) errors.models = text.errModelsRequired
  const ids = new Set<string>()
  for (const model of draft.models) {
    const name = model.id
    if (!name) errors[`${model.row}.id`] = text.errModelIDRequired
    else if (ids.has(name)) errors[`${model.row}.id`] = text.errModelIDDuplicate
    ids.add(name)
    for (const key of ['contextWindow', 'maxTokens'] as const) {
      if (!model[key].trim()) continue
      const number = Number(model[key])
      if (!Number.isFinite(number) || number < 1 || !Number.isInteger(number) || !matchesNumberStep(number, 1, 1)) errors[`${model.row}.${key}`] = text.errNotPositiveInteger
    }
    if (!model.inheritedInput && (!model.input.length || model.input.some(v => !['text', 'image'].includes(v)))) errors[`${model.row}.input`] = text.errInputKindsRequired
  }
  if (editing && namespace) {
    for (const key of ['baseURL', 'api']) if (!customFieldWritable(namespace, draft.id, key)) delete errors[key]
    if (!customFieldWritable(namespace, draft.id, 'models')) {
      delete errors.models
      for (const model of draft.models) for (const key of Object.keys(errors)) if (key.startsWith(`${model.row}.`)) delete errors[key]
    }
  }
  return errors
}
export function modelValue(model: ModelDraft): SettingObject {
  const result = structuredClone(model.original)
  for (const key of ['id', 'name', 'contextWindow', 'maxTokens'] as const) {
    if (equal(model[key], model.initial[key]) && Object.hasOwn(model.original, key)) continue
    const raw = key === 'id' || key === 'name' ? model[key] : model[key].trim()
    if (!raw && key !== 'id') delete result[key]
    else result[key] = key === 'contextWindow' || key === 'maxTokens' ? Number(raw) : raw
  }
  if (!equal(model.input, model.initial.input) || model.inheritedInput !== model.initial.inheritedInput) {
    if (model.inheritedInput) delete result.input
    else result.input = [...model.input]
  }
  return result
}
export function customOperations(namespace: SettingsNamespace, initial: CustomDraft, draft: CustomDraft, editing: boolean, withKey = false,
  text: CustomProviderTexts = customText()): SettingsOperation[] {
  const id = editing ? initial.id : draft.id
  const path = ['providers', id]
  const profile = valueAt(namespace.value, path)
  const reference = objectValue(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv ? profile.apiKeyEnv : undefined
  if (!editing) return [{ op: 'set', path, value: {
    ...(draft.displayName ? { displayName: draft.displayName } : {}),
    api: draft.api, baseURL: draft.baseURL.trim(), models: draft.models.map(modelValue),
    ...(withKey ? { apiKeyEnv: providerRef(id) } : {}),
  } }]
  const ops: SettingsOperation[] = []
  const put = (key: string, value?: SettingValue) => {
    if (!customFieldWritable(namespace, id, key)) throw new Error(text.errFieldProtected)
    ops.push(value === undefined ? { op: 'unset', path: [...path, key] } : { op: 'set', path: [...path, key], value })
  }
  for (const key of ['displayName', 'baseURL', 'api'] as const) {
    if (draft[key] !== initial[key]) put(key, (key === 'baseURL' ? draft[key].trim() : draft[key]) || undefined)
  }
  const models = draft.models.map(modelValue)
  if (!equal(models, initial.models.map(modelValue))) put('models', models)
  if (withKey && !reference) put('apiKeyEnv', providerRef(id))
  return ops
}
