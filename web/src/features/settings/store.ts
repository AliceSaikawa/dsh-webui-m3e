import type { ConnectionState, RemoteResult } from '../../dsh/services.ts'
import { messagesOf } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import type { Locale } from '../../i18n/locale.ts'
import { buildPatch, buildReset, parseFieldInput, type SettingField, type SettingPath, type SettingValue, type SettingsDescription, type SettingsNamespace } from './schema.ts'
import { findSettingField, settingFieldAccess } from './field-access.ts'
import { createSettingInput } from './input.ts'
import { settingsSchemaMessages, settingsStoreMessages } from './messages.ts'
import type { PermissionCatalog } from '../composer/api.ts'

export interface SettingsApi {
  describe(): Promise<RemoteResult<SettingsDescription>>
  update(ns: string, patch: Record<string, SettingValue>, revision: number): Promise<RemoteResult<SettingsNamespace>>
  mutate(ns: string, ops: SettingsOperation[], revision: number): Promise<RemoteResult<SettingsNamespace>>
}
export type SettingsOperation = { op: 'set'; path: string[]; value: SettingValue } | { op: 'unset'; path: string[] }
export interface SettingsState extends SettingsDescription {
  permissionCatalog?: PermissionCatalog
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  busy: Record<string, boolean>
  fieldErrors: Record<string, string>
  generation: Record<string, number>
  resetting: Record<string, number>
}
export const fieldKey = (ns: string, path: SettingPath): string => JSON.stringify([ns, ...path])
const storeText = () => messagesOf(settingsStoreMessages, currentLocale())
const schemaText = () => messagesOf(settingsSchemaMessages, currentLocale())

const JAPANESE_REASON = /^[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff01\uff08\uff09\uff1a\uff1f]+$/u
const JAPANESE_REASON_LETTER = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u
const CHINESE_REASON = /^[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff01\uff08\uff09\uff0c\uff1a\uff1f]+$/u
const CHINESE_REASON_HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/u

/**
 * A rejection reason written for people (for example an administrator's
 * policy) is shown as is. Japanese and Chinese accept only their letters and
 * punctuation: ASCII or full-width letters and digits, paths and other symbols
 * may carry input values or internal details, so such reasons get a fixed
 * message. English reasons cannot be told apart from such details, so English
 * always gets the fixed message.
 */
export function displayableRejection(message: unknown, locale: Locale = 'ja'): string {
  const text = messagesOf(settingsStoreMessages, locale)
  if (typeof message !== 'string' || message.length > 200) return text.rejected
  if (locale === 'zh') return CHINESE_REASON.test(message) && CHINESE_REASON_HAN.test(message) ? message : text.rejected
  if (locale === 'en') return text.rejected
  return JAPANESE_REASON.test(message) && JAPANESE_REASON_LETTER.test(message) ? message : text.rejected
}
const within = (path: SettingPath, parent: SettingPath) => parent.every((part, index) => path[index] === part)
const inputValue = (field: SettingField) => ['text', 'number'].includes(field.kind)
  ? typeof field.value === 'string' || typeof field.value === 'number' ? String(field.value) : '' : field.value

/** Owns revisions and serializes edits so two controls cannot race each other. */
export function createSettingsStore(api: SettingsApi, readPermissions?: () => Promise<PermissionCatalog>) {
  let state: SettingsState = { phase: 'loading', error: null, writable: false, namespaces: [], busy: {}, fieldErrors: {}, generation: {}, resetting: {} }
  let sequence = 0
  let connectionState: ConnectionState | undefined
  let connectionEpoch = 0
  let revisionEpoch = -1
  let queue = Promise.resolve()
  let saving = 0
  let reloadAfterSave = false
  const inputs = new Map<string, { ns: string; path: SettingPath; input: ReturnType<typeof createSettingInput<SettingValue | undefined>> }>()
  const resets = new Map<string, { ns: string; path: SettingPath; version: number }>()
  const edits = new Map<string, number>()
  const listeners = new Set<() => void>()
  const notices = new Set<(message: string) => void>()
  const publish = (patch: Partial<SettingsState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const find = (ns: string) => state.namespaces.find(row => row.ns === ns)
  const invalidate = (ns: string) => ({ ...state.generation, [ns]: (state.generation[ns] ?? 0) + 1 })
  const resetVersion = (ns: string, path: SettingPath) => [...resets.values()].reduce((sum, reset) =>
    sum + (reset.ns === ns && within(path, reset.path) ? reset.version : 0), 0)
  const isResetting = (ns: string, path: SettingPath) => Object.entries(state.resetting).some(([key, count]) => {
    const [name, ...parts] = JSON.parse(key) as string[]
    return count > 0 && name === ns && within(path, parts)
  })
  function clearErrors(ns: string, path: SettingPath = []) {
    return Object.fromEntries(Object.entries(state.fieldErrors).filter(([key]) => {
      const [name, ...parts] = JSON.parse(key) as string[]
      return name !== ns || !within(parts, path)
    }))
  }
  function changed(ns: string, path: SettingPath) {
    const key = fieldKey(ns, path)
    edits.set(key, (edits.get(key) ?? 0) + 1)
    if (state.fieldErrors[key]) publish({ fieldErrors: clearErrors(ns, path) })
  }
  function syncInputs(row: SettingsNamespace, interrupted?: string, resetPath?: SettingPath) {
    for (const entry of inputs.values()) {
      if (entry.ns !== row.ns) continue
      const field = findSettingField(row, entry.path, state.permissionCatalog)
      if (!field || !settingFieldAccess(row, field).edit) {
        // Removed, masked or newly read-only fields cannot retain editable values.
        entry.input.replace(field ? inputValue(field) : undefined)
      } else if (resetPath && within(entry.path, resetPath)) entry.input.replace(inputValue(field))
      else {
        if (interrupted) entry.input.interrupt(interrupted)
        entry.input.receive(inputValue(field))
      }
    }
  }
  function input(ns: string, path: SettingPath) {
    const key = fieldKey(ns, path)
    const existing = inputs.get(key)
    if (existing) return existing.input
    const row = find(ns)
    const field = row && findSettingField(row, path, state.permissionCatalog)
    const controller = createSettingInput<SettingValue | undefined>(field ? inputValue(field) : undefined, {
      changed: () => changed(ns, path),
      canChange: () => !isResetting(ns, path),
      canSave: () => {
        const current = find(ns)
        const field = current && findSettingField(current, path, state.permissionCatalog)
        const access = field && current && settingFieldAccess(current, field)
        return state.writable && !isResetting(ns, path) && !!access && (access.edit || access.reset)
      },
      async save(value, reset) {
        const row = find(ns)
        const field = row && findSettingField(row, path, state.permissionCatalog)
        if (!field) return { ok: false }
        let parsed = value
        if (!reset && ['text', 'number'].includes(field.kind)) {
          const result = parseFieldInput(field, String(value ?? ''), schemaText(), currentLocale())
          if (!result.ok) { publish({ fieldErrors: { ...state.fieldErrors, [key]: result.message } }); return { ok: false } }
          parsed = result.value
        }
        if (!await edit(ns, path, reset ? undefined : parsed)) return { ok: false }
        const current = find(ns)
        const saved = current && findSettingField(current, path, state.permissionCatalog)
        return { ok: true, value: saved ? inputValue(saved) : undefined }
      },
    })
    inputs.set(key, { ns, path: [...path], input: controller })
    return controller
  }
  /** Reads one reload run may chain for calls that join it (see `reload`). */
  const reloadReadLimit = 4
  let reloading: { promise: Promise<boolean>; reads: number } | undefined
  let trailingReload: Promise<boolean> | undefined
  let reloadAgain = false
  /**
   * Reads every namespace again with `describe()`, one read at a time.
   *
   * A call made while a run is in progress joins it: the pending read is discarded and the run reads
   * once more, so the result comes from a read that started after the call. A run chains at most
   * `reloadReadLimit` reads for such calls. Calls made during its last read do not extend it; they share
   * one fresh run that starts when it ends. A steady stream of update notifications therefore cannot
   * keep callers waiting forever, and the last notification is still read. A successful save discards a
   * pending read as well and always reads again (saves are finite, so this cannot loop).
   *
   * @returns `true` when the final read of the run this call waited for was applied. Earlier reads that
   * were discarded or merged do not count. `false` when that read failed (the store is then in the
   * error phase), or the connection was not connected or changed meanwhile.
   */
  function reload(): Promise<boolean> {
    if (reloading) {
      if (reloading.reads < reloadReadLimit) { reloadAgain = true; sequence++; return reloading.promise }
      const epoch = connectionEpoch
      return trailingReload ??= reloading.promise.then(() => {
        trailingReload = undefined
        return epoch === connectionEpoch ? reload() : false
      })
    }
    const epoch = connectionEpoch
    const flight = { promise: Promise.resolve(false), reads: 0 }
    const run = async () => {
      let loaded = false
      do {
        reloadAgain = false
        flight.reads++
        loaded = await loadOnce()
      } while (epoch === connectionEpoch && reloadAgain)
      return loaded
    }
    flight.promise = run().finally(() => { if (reloading === flight) reloading = undefined })
    reloading = flight
    return flight.promise
  }
  async function loadOnce(): Promise<boolean> {
    if (connectionState !== undefined && connectionState !== 'connected') return false
    const ticket = ++sequence
    const epoch = connectionEpoch
    try {
      const [result, permissionCatalog] = await Promise.all([api.describe(), readPermissions?.().catch(() => undefined)])
      if (ticket !== sequence || epoch !== connectionEpoch) return false
      if (!result.ok) { publish({ phase: 'error', error: storeText().loadFailed, writable: false }); return false }
      const generation = { ...state.generation }
      const updated = new Set<string>()
      const namespaces = result.value.namespaces.map(row => {
        const previous = find(row.ns)
        // A namespace may be registered again on the same connection with revision 0.
        // Request order and connection epochs, not revision size, reject stale reads.
        if (previous && row.revision !== previous.revision) {
          generation[row.ns] = (generation[row.ns] ?? 0) + 1
          updated.add(row.ns)
        }
        return row
      })
      revisionEpoch = epoch
      const fieldErrors = Object.fromEntries(Object.entries(state.fieldErrors).filter(([key]) => {
        const [ns] = JSON.parse(key) as string[]
        return !updated.has(ns!) && namespaces.some(row => row.ns === ns)
      }))
      publish({ phase: 'ready', error: null, writable: result.value.writable, namespaces, generation, permissionCatalog, fieldErrors })
      for (const row of namespaces) syncInputs(row, updated.has(row.ns) ? storeText().changed : undefined)
      for (const entry of inputs.values()) if (!find(entry.ns)) entry.input.replace(undefined)
      return true
    } catch {
      if (ticket === sequence && epoch === connectionEpoch) publish({ phase: 'error', error: storeText().loadFailed, writable: false })
      return false
    }
  }
  async function connectionChanged(next: ConnectionState): Promise<boolean> {
    if (connectionState === next) return false
    connectionState = next
    connectionEpoch++
    reloading = undefined
    trailingReload = undefined
    reloadAgain = false
    sequence++
    revisionEpoch = -1
    // Old requests may never settle. They must not block a new connection's edits.
    queue = Promise.resolve()
    saving = 0
    reloadAfterSave = false
    const generation = { ...state.generation }
    for (const row of state.namespaces) generation[row.ns] = (generation[row.ns] ?? 0) + 1
    publish({ phase: 'loading', error: null, writable: false, busy: {}, fieldErrors: {}, generation, resetting: {} })
    for (const entry of inputs.values()) entry.input.interrupt(storeText().interrupted)
    return next === 'connected' ? reload() : false
  }
  function documentUpdated(ns: unknown, revision?: unknown): void {
    if (typeof ns !== 'string') return
    if (connectionState !== undefined && connectionState !== 'connected') return
    if (revisionEpoch === connectionEpoch && typeof revision === 'number' && revision === find(ns)?.revision) return
    if (saving) { reloadAfterSave = true; return }
    void reload()
  }
  async function write(ns: string, path: SettingPath, prepare: (row: SettingsNamespace) => {
    send: () => Promise<RemoteResult<SettingsNamespace>>; resetGroup?: boolean; resetPath?: SettingPath
  } | undefined): Promise<boolean> {
    const key = fieldKey(ns, path)
    const generation = state.generation[ns] ?? 0
    const epoch = connectionEpoch
    const reset = resetVersion(ns, path)
    const editVersion = edits.get(key) ?? 0
    let accepted = false
    const operation = async () => {
      const row = find(ns)
      if (epoch !== connectionEpoch || !row || !state.writable || generation !== (state.generation[ns] ?? 0) || reset !== resetVersion(ns, path)) return
      const change = prepare(row)
      if (!change) return
      saving++
      const fieldErrors = { ...state.fieldErrors }
      delete fieldErrors[key]
      publish({ busy: { ...state.busy, [ns]: true }, fieldErrors })
      try {
        const result = await change.send()
        if (epoch !== connectionEpoch) return
        if (result.ok) {
          // In-flight describes must never replace this accepted revision. They may still carry
          // other namespaces' updates whose notifications were already consumed, and a save of an
          // unchanged value emits none, so the reload reads once more instead (#80).
          sequence++
          if (reloading) reloadAgain = true
          const current = find(ns)
          if (!current || result.value.revision >= current.revision) {
            if (change.resetPath) {
              const resetKey = fieldKey(ns, change.resetPath)
              resets.set(resetKey, { ns, path: [...change.resetPath], version: (resets.get(resetKey)?.version ?? 0) + 1 })
            }
            publish({
              namespaces: state.namespaces.map(item => item.ns === ns ? result.value : item),
              // Model editors retain their namespace-wide reset contract.
              ...(change.resetGroup ? { generation: invalidate(ns) } : {}),
              ...(change.resetPath ? { fieldErrors: clearErrors(ns, change.resetPath) } : {}),
            })
            syncInputs(result.value, undefined, change.resetPath)
          }
          accepted = true
        } else if (result.error.code === 'settings/conflict') {
          publish({ generation: invalidate(ns) })
          for (const entry of inputs.values()) if (entry.ns === ns) entry.input.interrupt(storeText().changed)
          const loaded = await reload()
          if (epoch === connectionEpoch) notices.forEach(notice => notice(loaded ? storeText().conflictReloaded : storeText().conflictReloadFailed))
        } else {
          const reason = result.error.code === 'settings/rejected'
            ? displayableRejection(result.error.message, currentLocale()) : storeText().changeRejected
          if (editVersion === (edits.get(key) ?? 0) && find(ns)?.revision === row.revision) publish({ fieldErrors: { ...state.fieldErrors, [key]: reason } })
        }
      } catch {
        if (epoch === connectionEpoch && editVersion === (edits.get(key) ?? 0) && find(ns)?.revision === row.revision) publish({ fieldErrors: { ...state.fieldErrors, [key]: storeText().saveFailed } })
      } finally {
        if (epoch === connectionEpoch) {
          saving--
          publish({ busy: { ...state.busy, [ns]: false } })
          if (!saving && reloadAfterSave) { reloadAfterSave = false; await reload() }
        }
      }
    }
    const next = queue.then(operation)
    queue = next.catch(() => {})
    await next
    return accepted
  }
  function edit(ns: string, path: SettingPath, value?: SettingValue): Promise<boolean> {
    const row = find(ns)
    const resettingGroup = value === undefined && row && findSettingField(row, path, state.permissionCatalog)?.kind === 'group'
    const key = fieldKey(ns, path)
    const epoch = connectionEpoch
    if (resettingGroup) publish({ resetting: { ...state.resetting, [key]: (state.resetting[key] ?? 0) + 1 } })
    const result = write(ns, path, row => {
      const field = findSettingField(row, path, state.permissionCatalog)
      if (!field) return undefined
      const access = settingFieldAccess(row, field)
      if (!(value === undefined ? access.edit || access.reset : access.edit)) return undefined
      if (value !== undefined && field.kind === 'select' && !field.options?.some(option => Object.is(option.value, value))) return undefined
      return {
        send: () => value === undefined
          ? api.mutate(ns, buildReset(path, schemaText()), row.revision)
          : ns === 'permission' && path.length === 1 && path[0] === 'defaultPreset'
            ? api.mutate(ns, [{ op: 'set', path: [...path], value }], row.revision)
            : api.update(ns, buildPatch(path, value, schemaText()), row.revision),
        resetPath: value === undefined && field.kind === 'group' ? path : undefined,
      }
    })
    return result.finally(() => {
      if (resettingGroup && epoch === connectionEpoch) {
        const resetting = { ...state.resetting }
        if ((resetting[key] ?? 0) <= 1) delete resetting[key]
        else resetting[key] = resetting[key]! - 1
        publish({ resetting })
      }
    })
  }
  /** Build model edits only when their turn reaches the queue, using the latest saved value. */
  function editModelSettings(ns: 'agent-default-model' | 'subagent-model-selection-settings',
    ops: (row: SettingsNamespace) => SettingsOperation[], reset = false): Promise<boolean> {
    const path = ns === 'agent-default-model' ? ['model'] : ['enabled']
    return write(ns, path, row => {
      const operations = ops(row)
      if (!operations.length) return undefined
      return { send: () => api.mutate(ns, operations, row.revision), resetGroup: reset }
    })
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    subscribeNotice(listener: (message: string) => void) { notices.add(listener); return () => { notices.delete(listener) } },
    reload, edit, editModelSettings, documentUpdated, connectionChanged, input, isResetting,
  }
}
export type SettingsStore = ReturnType<typeof createSettingsStore>
