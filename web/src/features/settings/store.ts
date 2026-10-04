import type { ConnectionState, RemoteResult } from '../../dsh/services.ts'
import { buildPatch, buildReset, type SettingPath, type SettingValue, type SettingsDescription, type SettingsNamespace } from './schema.ts'
import { findSettingField, settingFieldAccess } from './field-access.ts'
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
}
export const fieldKey = (ns: string, path: SettingPath): string => JSON.stringify([ns, ...path])
const failureMessage = '設定を読み込めませんでした。接続を確認して、もう一度お試しください。'

/** Owns revisions and serializes edits so two controls cannot race each other. */
export function createSettingsStore(api: SettingsApi, readPermissions?: () => Promise<PermissionCatalog>) {
  let state: SettingsState = { phase: 'loading', error: null, writable: false, namespaces: [], busy: {}, fieldErrors: {}, generation: {} }
  let sequence = 0
  let connectionState: ConnectionState | undefined
  let connectionEpoch = 0
  let revisionEpoch = -1
  let queue = Promise.resolve()
  let saving = 0
  let reloadAfterSave = false
  const listeners = new Set<() => void>()
  const notices = new Set<(message: string) => void>()
  const publish = (patch: Partial<SettingsState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const find = (ns: string) => state.namespaces.find(row => row.ns === ns)
  const invalidate = (ns: string) => ({ ...state.generation, [ns]: (state.generation[ns] ?? 0) + 1 })
  async function reload(): Promise<boolean> {
    if (connectionState !== undefined && connectionState !== 'connected') return false
    const ticket = ++sequence
    const epoch = connectionEpoch
    try {
      const [result, permissionCatalog] = await Promise.all([api.describe(), readPermissions?.().catch(() => undefined)])
      if (ticket !== sequence || epoch !== connectionEpoch) return false
      if (!result.ok) { publish({ phase: 'error', error: failureMessage, writable: false }); return false }
      const generation = { ...state.generation }
      const namespaces = result.value.namespaces.map(row => {
        const previous = find(row.ns)
        // A namespace may be registered again on the same connection with revision 0.
        // Request order and connection epochs, not revision size, reject stale reads.
        if (previous && row.revision !== previous.revision) generation[row.ns] = (generation[row.ns] ?? 0) + 1
        return row
      })
      revisionEpoch = epoch
      publish({ phase: 'ready', error: null, writable: result.value.writable, namespaces, generation, permissionCatalog })
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
    publish({ phase: 'loading', error: null, writable: false, busy: {}, fieldErrors: {}, generation })
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
    send: () => Promise<RemoteResult<SettingsNamespace>>; resetGroup?: boolean
  } | undefined): Promise<boolean> {
    const key = fieldKey(ns, path)
    const generation = state.generation[ns] ?? 0
    const epoch = connectionEpoch
    let accepted = false
    const operation = async () => {
      const row = find(ns)
      if (epoch !== connectionEpoch || !row || !state.writable || generation !== (state.generation[ns] ?? 0)) return
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
          if (!current || result.value.revision >= current.revision) publish({
            namespaces: state.namespaces.map(item => item.ns === ns ? result.value : item),
            // Child drafts from before a group reset must not restore overrides.
            ...(change.resetGroup ? { generation: invalidate(ns) } : {}),
          })
          accepted = true
        } else if (result.error.code === 'settings/conflict') {
          publish({ generation: invalidate(ns) })
          const loaded = await reload()
          if (epoch === connectionEpoch) notices.forEach(notice => notice(loaded ? 'ほかの場所で設定が変わりました。読み直しました' : 'ほかの場所で設定が変わりました。読み直せなかったため、再読み込みしてください。'))
        } else {
          const reason = result.error.code === 'settings/rejected' && /[\u3040-\u30ff\u3400-\u9fff]/.test(result.error.message)
            ? result.error.message : 'この変更は保存できませんでした。入力内容と接続を確認してください。'
          publish({ fieldErrors: { ...state.fieldErrors, [key]: reason } })
        }
      } catch {
        if (epoch === connectionEpoch) publish({ fieldErrors: { ...state.fieldErrors, [key]: '設定を保存できませんでした。接続を確認してください。' } })
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
    return write(ns, path, row => {
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
        resetGroup: value === undefined && field.kind === 'group',
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
    reload, edit, editModelSettings, documentUpdated, connectionChanged,
  }
}
export type SettingsStore = ReturnType<typeof createSettingsStore>
