import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import type { SettingObject, SettingsDescription, SettingsNamespace, SettingValue } from './schema.ts'
import type { ProviderAddress, ProviderEntry } from './providers.ts'
import { validMockOperations, validMockPatch, validMockValue } from './mock-validation.ts'
import { settingsFixtures } from './mock-fixtures.ts'

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
const validRef = (ref: unknown): ref is string =>
  typeof ref === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)

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

export function extendMock(kit: MockKit): void {
  const namespaces = new Map(settingsFixtures().map(row => [row.ns, row]))
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
    { provider: 'local', displayName: 'ローカル', settingsNs: 'example-extension', settingsPath: ['localProvider'] },
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
    const next = merge(current.base ?? {}, user)
    if (!validMockValue(current, next)) return failure('settings/rejected', '公開された設定の型に合わない変更です。')
    current.user = user
    current.value = merge(current.base ?? {}, user)
    current.revision++
    await kit.emit('settings/document-updated', current.ns, { additionalArgs: [current.revision] })
    return success(current)
  }

  const remote: SettingsMockRemote = {
    async describe() { return success({ writable, namespaces: [...namespaces.values()] }) },
    async update(ns, patch, expectedRevision) {
      const result = checkWrite(ns, expectedRevision)
      if (!result.ok) return result
      if (!validMockPatch(result.value, patch)) {
        return failure('settings/rejected', '公開されていない設定項目か、不正な値です。')
      }
      return commit(result.value, merge(result.value.user ?? {}, patch))
    },
    async mutate(ns, operations, expectedRevision) {
      const result = checkWrite(ns, expectedRevision)
      if (!result.ok) return result
      if (operations.some(operation => !['set', 'unset'].includes(operation.op) || !operation.path.length || operation.path.some(key => !key || !allowedKey(key)))) {
        return failure('settings/rejected', '設定項目の場所が不正です。')
      }
      const user = structuredClone(result.value.user ?? {})
      if (!validMockOperations(result.value, operations)) {
        return failure('settings/rejected', '公開されていない設定項目か、不正な値です。')
      }
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
      if (!Array.isArray(refs) || refs.length > 64 || refs.some(ref => !validRef(ref))) {
        return failure('gateway/bad-request', '参照名を確認してください。')
      }
      if (keyLookupFails) return failure('credential/unavailable', '登録状況を読み込めません。')
      return success(Object.fromEntries(refs.map(ref => [ref, { configured: registeredKeys.has(ref), writable: writable && keysWritable }])))
    },
    async set(ref: string, value: string) {
      if (!validRef(ref) || typeof value !== 'string' || !value.length) {
        return failure('gateway/bad-request', '参照名と値を確認してください。')
      }
      if (!writable || !keysWritable || rejectWrites || !value.trim()) return failure('credential/rejected', 'キーを登録できません。')
      registeredKeys.add(ref)
      await kit.emit('credentials/reference-updated', ref)
      await kit.emit('credentials/record-updated', undefined)
      return success(undefined)
    },
    async unset(ref: string) {
      if (!validRef(ref)) return failure('gateway/bad-request', '参照名を確認してください。')
      if (!writable || !keysWritable || rejectWrites) return failure('credential/rejected', '登録を消せません。')
      registeredKeys.delete(ref)
      await kit.emit('credentials/reference-updated', ref)
      await kit.emit('credentials/record-updated', undefined)
      return success(undefined)
    },
  })
  kit.scenario('settings-readonly', () => { writable = false })
  kit.scenario('settings-conflict', () => { firstWriteConflict = true })
  kit.scenario('settings-rejected', () => { rejectWrites = true })
  kit.scenario('settings-unset', () => {
    const row = namespaces.get('example-extension')!
    unset(row.base ?? {}, ['mode'])
    unset(row.user ?? {}, ['mode'])
    row.value = merge(row.base ?? {}, row.user ?? {})
  })
  kit.scenario('settings-keys-readonly', () => { keysWritable = false })
  kit.scenario('settings-keys-unavailable', () => { keyLookupFails = true })
}
