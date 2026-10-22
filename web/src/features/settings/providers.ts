import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import { buildPatch, valueAt, type SettingsDescription } from './schema.ts'
import type { SettingsApi } from './store.ts'
import type { ModelCatalog } from '../composer/api.ts'
import { providerMessages } from './messages.ts'
import type { KeyReferenceReasonKey } from './provider-key-refs.ts'

/** The texts the provider store produces; tests may pass another language's catalog. */
export type ProviderStoreTexts = Translation<typeof providerMessages.ja>
const storeText = (): ProviderStoreTexts => messagesOf(providerMessages, currentLocale())
/** The two messages a key draft itself produces; the custom provider form has its own catalog with both. */
export type KeyDraftTexts = { keyRequired: string; saveFailed: string }
/** The line that states one row's registration status, including the read-only note. */
export const providerStatusText = (status: ProviderRow['status'], writable: boolean, text: ProviderStoreTexts): string => {
  const label = { registered: text.statusRegistered, missing: text.statusMissing, unnecessary: text.statusUnnecessary,
    unknown: text.statusUnknown, unset: text.statusUnset }[status]
  return writable ? label : text.statusReadOnly(label)
}

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
  /** A text the list and the form show as it is (the current language's). */
  keyNotice?: string
  /** The same notice as a catalog key, so a form translates it when it draws. */
  keyNoticeKey?: 'pendingKeyReference'
  needsReference: boolean
  status: 'registered' | 'missing' | 'unnecessary' | 'unknown' | 'unset'
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
/**
 * A failed key operation. `message` is the text to show, in the language of
 * the call; `code` names the catalog key so a form that draws later can
 * translate it again, and `reason` is the text the operation took from an
 * option called with another catalog. `keyReason` holds a `keyReferenceReason`
 * key so the caller can build its own sentence.
 */
/** A failure from the custom provider form itself, which owns its own catalog. */
export type CustomKeyFailure = { ok: false; message: string; code: 'custom'; keyReason?: KeyReferenceReasonKey }
export type KeyOutcome = { ok: true } | { ok: false; message: string; code: keyof ProviderStoreTexts; reason?: string; keyReason?: KeyReferenceReasonKey } | CustomKeyFailure
/** `requireMissing`: the caller has just assigned this reference name, so a key registered meanwhile is someone else's. */
export interface KeySaveOptions { canSend?(): boolean; requireMissing?: boolean }
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
    const withoutReference = custom && !named
    const ref = native || withoutReference ? undefined : named ?? derivedRef(entry.provider)
    return {
      id: entry.provider, name: entry.displayName, custom, ns: entry.settingsNs, path: [...entry.settingsPath],
      revision: namespace?.revision, ref,
      needsReference: !named && !native && !custom,
      status: withoutReference ? 'unset' : native ? 'unnecessary' : 'unknown', writable: false,
    }
  })
}

export function createProviderStore(remote: ProviderRemote, text: ProviderStoreTexts = storeText()) {
  let state: ProviderState = { phase: 'loading', rows: [], error: null, busy: false }
  let sequence = 0
  let epoch = 0
  let connected = true
  let refreshVersion = 0
  let pendingChange: { generation: number; done: Promise<void>; finish(): void } | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ProviderState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
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
          ...(row.custom && status && !status.configured ? { keyNotice: text.pendingKeyReference, keyNoticeKey: 'pendingKeyReference' as const } : {}),
          // A derived reference is useful for status everywhere. Only pi-ai's
          // missing-reference write contract has been confirmed.
          writable: (!row.needsReference || row.ns === 'llm-pi-ai') && settings.value.writable && status?.writable === true }
      })
      const incomplete = resolved.some(row => row.status === 'unknown')
      publish({ phase: 'ready', rows: resolved, settingsWritable: settings.value.writable,
        customAvailable: settings.value.namespaces.some(row => row.ns === 'llm-pi-ai'),
        error: incomplete ? text.incomplete : null })
      return true
    } catch {
      if (request === sequence && generation === epoch) publish({ phase: 'error', error: text.unavailable, rows: state.rows.map(row => ({ ...row, writable: false })) })
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
  async function change(target: ProviderRow, value?: string, options: KeySaveOptions = {}): Promise<KeyOutcome> {
    if (state.busy || !connected) return { ok: false, code: 'busy', message: text.busy }
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
        if (!await read() || generation !== epoch) return { ok: false, code: 'unavailable', message: text.unavailable }
      } while (validatedVersion !== refreshVersion)
      if (options.canSend?.() === false) return { ok: false, code: 'closed', message: text.closed }
      const row = state.rows.find(item => item.id === target.id)
      if (!row?.ref || !row.writable || row.ref !== target.ref || row.ns !== target.ns || JSON.stringify(row.path) !== JSON.stringify(target.path)) {
        return { ok: false, code: 'changed', message: text.changed }
      }
      if (value !== undefined && !value.trim()) return { ok: false, code: 'keyRequired', message: text.keyRequired }
      if (value !== undefined && row.needsReference) {
        if (row.revision === undefined) return { ok: false, code: 'rereadProvider', message: text.rereadProvider }
        const named = await remote.settings.update(row.ns, buildPatch([...row.path, 'apiKeyEnv'], row.ref), row.revision)
        if (!named.ok || generation !== epoch) return { ok: false, code: 'referenceFailed', message: text.referenceFailed }
        referenceWritten = true
      }
      if (options.canSend?.() === false) return { ok: false, code: 'closed', message: text.closed }
      if (options.requireMissing && row.status !== 'missing') return { ok: false, code: 'keyRegisteredMeanwhile', message: text.keyRegisteredMeanwhile }
      const result = value === undefined ? await remote.credentials.unset(row.ref) : await remote.credentials.set(row.ref, value)
      value = undefined
      if (generation !== epoch) return { ok: false, code: 'connectionChanged', message: text.connectionChanged }
      if (!result.ok) {
        if (referenceWritten) return { ok: false, code: 'referenceSetKeyFailed', message: text.referenceSetKeyFailed }
        return { ok: false, code: 'rejected', message: text.rejected }
      }
      await read()
      if (generation !== epoch) return { ok: false, code: 'connectionChanged', message: text.connectionChanged }
      return { ok: true }
    } catch {
      return { ok: false, code: 'changeFailed', message: text.changeFailed }
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
    save: (row: ProviderRow, value: string, options?: KeySaveOptions) => change(row, value, options),
    remove: (row: ProviderRow) => change(row),
  }
}
export type ProviderStore = ReturnType<typeof createProviderStore>

/** A write-only draft. Submission consumes the input, including failed writes. */
export function createKeyDraft(save: (value: string) => Promise<KeyOutcome>, text: () => KeyDraftTexts = () => storeText()) {
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
      if (!state.draft.trim()) { publish({ error: text().keyRequired }); return false }
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
        if (active && generation === epoch) publish({ busy: false, error: text().saveFailed })
        return false
      } finally { value = '' }
    },
    dispose() { active = false; epoch++; state = { draft: '', visible: false, busy: false, error: null }; listeners.clear() },
  }
}
