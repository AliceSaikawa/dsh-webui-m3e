import type { ConnectionState, RemoteResult } from '../../dsh/services.ts'
import { buildPatch, buildReset, parseFieldInput, type SettingField, type SettingPath, type SettingValue, type SettingsDescription, type SettingsNamespace } from './schema.ts'
import { findSettingField, settingFieldAccess } from './field-access.ts'
import { createSettingInput } from './input.ts'
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
const failureMessage = '設定を読み込めませんでした。接続を確認して、もう一度お試しください。'
const interruptedMessage = '接続が切れたため保存を中断しました。入力は残っています。接続が戻ったら保存済みの値を確認して、もう一度保存してください。'
const changedMessage = 'ほかの場所で設定が変わりました。入力は残っています。保存済みの値を確認して、もう一度保存してください。'
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
          const result = parseFieldInput(field, String(value ?? ''))
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
  async function reload(): Promise<boolean> {
    if (connectionState !== undefined && connectionState !== 'connected') return false
    const ticket = ++sequence
    const epoch = connectionEpoch
    try {
      const [result, permissionCatalog] = await Promise.all([api.describe(), readPermissions?.().catch(() => undefined)])
      if (ticket !== sequence || epoch !== connectionEpoch) return false
      if (!result.ok) { publish({ phase: 'error', error: failureMessage, writable: false }); return false }
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
      for (const row of namespaces) syncInputs(row, updated.has(row.ns) ? changedMessage : undefined)
      for (const entry of inputs.values()) if (!find(entry.ns)) entry.input.replace(undefined)
      return true
    } catch {
      if (ticket === sequence && epoch === connectionEpoch) publish({ phase: 'error', error: failureMessage, writable: false })
      return false
    }
  }
  async function connectionChanged(next: ConnectionState): Promise<boolean> {
    if (connectionState === next) return false
    connectionState = next
    connectionEpoch++
    sequence++
    revisionEpoch = -1
    // Old requests may never settle. They must not block a new connection's edits.
    queue = Promise.resolve()
    saving = 0
    reloadAfterSave = false
    const generation = { ...state.generation }
    for (const row of state.namespaces) generation[row.ns] = (generation[row.ns] ?? 0) + 1
    publish({ phase: 'loading', error: null, writable: false, busy: {}, fieldErrors: {}, generation, resetting: {} })
    for (const entry of inputs.values()) entry.input.interrupt(interruptedMessage)
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
          // In-flight describes must never replace this accepted revision.
          sequence++
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
          for (const entry of inputs.values()) if (entry.ns === ns) entry.input.interrupt(changedMessage)
          const loaded = await reload()
          if (epoch === connectionEpoch) notices.forEach(notice => notice(loaded ? 'ほかの場所で設定が変わりました。読み直しました' : 'ほかの場所で設定が変わりました。読み直せなかったため、再読み込みしてください。'))
        } else {
          const reason = result.error.code === 'settings/rejected' && /[\u3040-\u30ff\u3400-\u9fff]/.test(result.error.message)
            ? result.error.message : 'この変更は保存できませんでした。入力内容と接続を確認してください。'
          if (editVersion === (edits.get(key) ?? 0) && find(ns)?.revision === row.revision) publish({ fieldErrors: { ...state.fieldErrors, [key]: reason } })
        }
      } catch {
        if (epoch === connectionEpoch && editVersion === (edits.get(key) ?? 0) && find(ns)?.revision === row.revision) publish({ fieldErrors: { ...state.fieldErrors, [key]: '設定を保存できませんでした。接続を確認してください。' } })
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
          ? api.mutate(ns, buildReset(path), row.revision)
          : ns === 'permission' && path.length === 1 && path[0] === 'defaultPreset'
            ? api.mutate(ns, [{ op: 'set', path: [...path], value }], row.revision)
            : api.update(ns, buildPatch(path, value), row.revision),
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
