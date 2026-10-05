import type { RemoteResult } from '../../dsh/services.ts'
import { buildPatch, valueAt, type SettingsDescription } from './schema.ts'
import type { SettingsApi } from './store.ts'
import type { ModelCatalog } from '../composer/api.ts'

/** Broadcasts after which the provider list and key state must be read again. */
export const PROVIDER_EVENTS = ['credentials/reference-updated', 'credentials/record-updated', 'llm/adapters-updated', 'settings/document-updated'] as const

export interface ProviderEntry { id: string; name: string }
export interface ProviderAddress { provider: string; displayName: string; settingsNs: string; settingsPath: string[]; declared?: boolean }
export interface KeyInfo { configured: boolean; writable: boolean }
export interface ProviderRemote {
  session?: { modelCatalog(): Promise<RemoteResult<ModelCatalog>> }
  llm: {
    listProviders(): Promise<RemoteResult<ProviderEntry[]>>
    listConfigurableProviders(): Promise<RemoteResult<ProviderAddress[]>>
  }
  settings: SettingsApi
  credentials: {
    describe(refs: string[]): Promise<RemoteResult<Record<string, unknown>>>
    set(ref: string, value: string): Promise<RemoteResult<unknown>>
    unset(ref: string): Promise<RemoteResult<unknown>>
  }
}
export interface ProviderRow {
  id: string
  name: string
  custom?: boolean
  ns: string
  path: string[]
  revision?: number
  ref?: string
  needsReference: boolean
  status: 'registered' | 'missing' | 'unnecessary' | 'unknown'
  writable: boolean
}
export interface ProviderState {
  phase: 'loading' | 'ready' | 'error'
  rows: ProviderRow[]
  error: string | null
  busy: boolean
  settingsWritable?: boolean
  customAvailable?: boolean
}
export type KeyOutcome = { ok: true } | { ok: false; message: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const derivedRef = (id: string) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

/** Keep only the two documented booleans; never propagate a server value. */
export function keyInfo(value: unknown): KeyInfo | undefined {
  return object(value) && typeof value.configured === 'boolean' && typeof value.writable === 'boolean'
    ? { configured: value.configured, writable: value.writable } : undefined
}

export function providerRows(registered: ProviderEntry[], directory: ProviderAddress[], settings: SettingsDescription, accountAvailable = false): ProviderRow[] {
  const live = new Set(registered.map(provider => provider.id))
  const entries = [...directory]
  for (const provider of registered) if (!entries.some(entry => entry.provider === provider.id)) {
    entries.push({ provider: provider.id, displayName: provider.name, settingsNs: '', settingsPath: [] })
  }
  return entries.filter(entry => entry.provider !== 'deepseek-account' || accountAvailable).map(entry => {
    const namespace = settings.namespaces.find(item => item.ns === entry.settingsNs)
    const profile = namespace && valueAt(namespace.value, entry.settingsPath)
    const named = object(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : undefined
    // The existing UI treats active routes without a named reference as using
    // provider-native authentication (including local gateways).
    const custom = entry.declared === true && entry.settingsNs === 'llm-pi-ai'
    const native = entry.provider === 'deepseek-account' || !custom && !named && live.has(entry.provider)
    return {
      id: entry.provider, name: entry.displayName, custom, ns: entry.settingsNs, path: [...entry.settingsPath],
      revision: namespace?.revision, ref: native ? undefined : named ?? derivedRef(entry.provider),
      needsReference: !named && !native,
      status: native ? 'unnecessary' : 'unknown', writable: false,
    }
  })
}

export function createProviderStore(remote: ProviderRemote) {
  let state: ProviderState = { phase: 'loading', rows: [], error: null, busy: false }
  let sequence = 0
  let epoch = 0
  let connected = true
  let refreshVersion = 0
  let pendingChange: { generation: number; done: Promise<void>; finish(): void } | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ProviderState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const unavailable = '提供元と API キーの登録状況を読み込めませんでした。もう一度お試しください。'
  async function read(): Promise<boolean> {
    const request = ++sequence
    const generation = epoch
    if (!connected) return false
    try {
      const [registered, directory, settings] = await Promise.all([
        remote.llm.listProviders(), remote.llm.listConfigurableProviders(), remote.settings.describe(),
      ])
      if (request !== sequence || generation !== epoch) return false
      if (!registered.ok || !directory.ok || !settings.ok) throw new Error('unavailable')
      let accountAvailable = false
      if ([...registered.value.map(row => row.id), ...directory.value.map(row => row.provider)].includes('deepseek-account')) {
        const catalog = await remote.session?.modelCatalog()
        accountAvailable = catalog?.ok === true && catalog.value.groups.some(group => group.id === 'deepseek-account' && group.models.length > 0)
      }
      if (request !== sequence || generation !== epoch) return false
      const rows = providerRows(registered.value, directory.value, settings.value, accountAvailable)
      const refs = [...new Set(rows.flatMap(row => row.ref ? [row.ref] : []))]
      const answer = refs.length ? await remote.credentials.describe(refs) : { ok: true as const, value: {} as Record<string, unknown> }
      if (request !== sequence || generation !== epoch) return false
      const info = answer.ok ? answer.value : {}
      const resolved = rows.map(row => {
        if (!row.ref) return row
        const status = keyInfo(Object.hasOwn(info, row.ref) ? info[row.ref] : undefined)
        return { ...row, status: status ? status.configured ? 'registered' as const : 'missing' as const : 'unknown' as const,
          // A derived reference is useful for status everywhere. Only pi-ai's
          // missing-reference write contract has been confirmed.
          writable: (!row.needsReference || row.ns === 'llm-pi-ai') && settings.value.writable && status?.writable === true }
      })
      const incomplete = resolved.some(row => row.status === 'unknown')
      publish({ phase: 'ready', rows: resolved, settingsWritable: settings.value.writable,
        customAvailable: settings.value.namespaces.some(row => row.ns === 'llm-pi-ai'),
        error: incomplete ? '一部の API キーの登録状況を確認できません。再読み込みしてください。' : null })
      return true
    } catch {
      if (request === sequence && generation === epoch) publish({ phase: 'error', error: unavailable, rows: state.rows.map(row => ({ ...row, writable: false })) })
      return false
    }
  }
  async function load(): Promise<boolean> {
    const generation = epoch
    // Event refreshes cannot supersede the operation's own validation read.
    // Remember them so validation can repeat if its snapshot became outdated.
    while (pendingChange?.generation === generation) {
      refreshVersion++
      await pendingChange.done
      if (generation !== epoch) return false
    }
    return read()
  }
  function connectionChanged(isConnected: boolean): void {
    if (connected === isConnected) return
    connected = isConnected; epoch++; sequence++
    publish({ phase: 'loading', rows: [], error: null, busy: false })
    if (connected) void load()
  }
  async function change(target: ProviderRow, value?: string): Promise<KeyOutcome> {
    if (state.busy || !connected) return { ok: false, message: '接続と処理中の操作を確認してください。' }
    const generation = epoch
    let finish!: () => void
    const operation = { generation, done: new Promise<void>(resolve => { finish = resolve }), finish: () => finish() }
    pendingChange = operation
    publish({ busy: true })
    let referenceWritten = false
    try {
      let validatedVersion: number
      do {
        validatedVersion = refreshVersion
        if (!await read() || generation !== epoch) return { ok: false, message: unavailable }
      } while (validatedVersion !== refreshVersion)
      const row = state.rows.find(item => item.id === target.id)
      if (!row?.ref || !row.writable || row.ref !== target.ref || row.ns !== target.ns || JSON.stringify(row.path) !== JSON.stringify(target.path)) {
        return { ok: false, message: '設定が変わったか、このキーは変更できません。入力画面を開き直してください。' }
      }
      if (value !== undefined && !value.trim()) return { ok: false, message: 'API キーを入力してください。' }
      if (value !== undefined && row.needsReference) {
        if (row.revision === undefined) return { ok: false, message: '提供元の設定を読み直してください。' }
        const named = await remote.settings.update(row.ns, buildPatch([...row.path, 'apiKeyEnv'], row.ref), row.revision)
        if (!named.ok || generation !== epoch) return { ok: false, message: '参照先を設定できませんでした。提供元の設定を読み直してください。' }
        referenceWritten = true
      }
      const result = value === undefined ? await remote.credentials.unset(row.ref) : await remote.credentials.set(row.ref, value)
      value = undefined
      if (generation !== epoch) return { ok: false, message: '接続が変わりました。登録状況を確認してください。' }
      if (!result.ok) return { ok: false, message: referenceWritten ? '参照先を設定しましたが、キーを保存できませんでした。入力し直してください。' : 'API キーの変更が拒否されました。登録状況を確認してください。' }
      await read()
      if (generation !== epoch) return { ok: false, message: '接続が変わりました。登録状況を確認してください。' }
      return { ok: true }
    } catch {
      return { ok: false, message: 'API キーを変更できませんでした。接続と登録状況を確認してください。' }
    } finally {
      value = undefined
      if (pendingChange === operation) pendingChange = undefined
      if (generation === epoch) publish({ busy: false })
      operation.finish()
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    load, connectionChanged,
    save: (row: ProviderRow, value: string) => change(row, value),
    remove: (row: ProviderRow) => change(row),
  }
}
export type ProviderStore = ReturnType<typeof createProviderStore>

/** A write-only draft. Submission consumes the input, including failed writes. */
export function createKeyDraft(save: (value: string) => Promise<KeyOutcome>) {
  let state = { draft: '', visible: false, busy: false, error: null as string | null }
  let active = true
  let epoch = 0
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; if (active) listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    activate() { active = true },
    clear() { epoch++; publish({ draft: '', visible: false, busy: false, error: null }) },
    input(draft: string) { if (active && !state.busy) publish({ draft, error: null }) },
    toggle() { if (active && !state.busy) publish({ visible: !state.visible }) },
    async submit(): Promise<boolean> {
      if (!active || state.busy) return false
      if (!state.draft.trim()) { publish({ error: 'API キーを入力してください。' }); return false }
      const generation = epoch
      let value = state.draft.trim()
      publish({ draft: '', visible: false, busy: true, error: null })
      try {
        const pending = save(value)
        value = ''
        const outcome = await pending
        if (active && generation === epoch) publish({ busy: false, error: outcome.ok ? null : outcome.message })
        return active && generation === epoch && outcome.ok
      } catch {
        if (active && generation === epoch) publish({ busy: false, error: 'API キーを保存できませんでした。入力し直してください。' })
        return false
      } finally { value = '' }
    },
    dispose() { active = false; epoch++; state = { draft: '', visible: false, busy: false, error: null }; listeners.clear() },
  }
}
