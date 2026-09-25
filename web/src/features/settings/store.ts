import type { ConnectionState, RemoteResult } from '../../dsh/services.ts'
import { buildPatch, buildReset, schemaFields, type SettingField, type SettingPath, type SettingValue, type SettingsDescription, type SettingsNamespace } from './schema.ts'

export interface SettingsApi {
  describe(): Promise<RemoteResult<SettingsDescription>>
  update(ns: string, patch: Record<string, SettingValue>, revision: number): Promise<RemoteResult<SettingsNamespace>>
  mutate(ns: string, ops: ReturnType<typeof buildReset>, revision: number): Promise<RemoteResult<SettingsNamespace>>
}
export interface SettingsState extends SettingsDescription {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  busy: Record<string, boolean>
  fieldErrors: Record<string, string>
  generation: Record<string, number>
}
export const fieldKey = (ns: string, path: SettingPath): string => JSON.stringify([ns, ...path])
const failureMessage = '設定を読み込めませんでした。接続を確認して、もう一度お試しください。'

/** Owns revisions and serializes edits so two controls cannot race each other. */
export function createSettingsStore(api: SettingsApi) {
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
  function allowed(row: SettingsNamespace, path: SettingPath): boolean {
    const leaves = (fields: SettingField[]): SettingField[] => fields.flatMap(field => field.children ? leaves(field.children) : field)
    return leaves(schemaFields(row)).some(field => fieldKey(row.ns, field.path) === fieldKey(row.ns, path) && !field.disabled && !['readonly', 'masked', 'group'].includes(field.kind))
  }
  async function reload(): Promise<boolean> {
    if (connectionState !== undefined && connectionState !== 'connected') return false
    const ticket = ++sequence
    const epoch = connectionEpoch
    try {
      const result = await api.describe()
      if (ticket !== sequence || epoch !== connectionEpoch) return false
      if (!result.ok) { publish({ phase: 'error', error: failureMessage, writable: false }); return false }
      const generation = { ...state.generation }
      const namespaces = result.value.namespaces.map(row => {
        const previous = find(row.ns)
        // Revisions are monotonic only while the same server connection lasts.
        if (revisionEpoch === epoch && previous && row.revision < previous.revision) return previous
        if (previous && row.revision !== previous.revision) generation[row.ns] = (generation[row.ns] ?? 0) + 1
        return row
      })
      revisionEpoch = epoch
      publish({ phase: 'ready', error: null, writable: result.value.writable, namespaces, generation })
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
    if (revisionEpoch === connectionEpoch && typeof revision === 'number' && revision <= (find(ns)?.revision ?? -1)) return
    if (saving) { reloadAfterSave = true; return }
    void reload()
  }
  async function edit(ns: string, path: SettingPath, value?: SettingValue): Promise<boolean> {
    const key = fieldKey(ns, path)
    const generation = state.generation[ns] ?? 0
    const epoch = connectionEpoch
    let accepted = false
    const operation = async () => {
      const row = find(ns)
      if (epoch !== connectionEpoch || !row || !state.writable || !allowed(row, path) || generation !== (state.generation[ns] ?? 0)) return
      saving++
      const fieldErrors = { ...state.fieldErrors }
      delete fieldErrors[key]
      publish({ busy: { ...state.busy, [ns]: true }, fieldErrors })
      try {
        const result = value === undefined
          ? await api.mutate(ns, buildReset(path), row.revision)
          : await api.update(ns, buildPatch(path, value), row.revision)
        if (epoch !== connectionEpoch) return
        if (result.ok) {
          // In-flight describes must never replace this accepted revision.
          sequence++
          const current = find(ns)
          if (!current || result.value.revision >= current.revision) publish({ namespaces: state.namespaces.map(item => item.ns === ns ? result.value : item) })
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
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    subscribeNotice(listener: (message: string) => void) { notices.add(listener); return () => { notices.delete(listener) } },
    reload, edit, documentUpdated, connectionChanged,
  }
}
export type SettingsStore = ReturnType<typeof createSettingsStore>
