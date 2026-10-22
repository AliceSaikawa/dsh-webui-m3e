import { createKeyDraft, providerRows, type ProviderRemote, type ProviderStore, type KeyOutcome } from './providers.ts'
import { CUSTOM_NS, customDraft, customOperations, objectValue, protocolChoices, providerRef, validateCustom, type CustomDraft, type CustomErrors } from './custom-provider.ts'
import { valueAt, type SettingsNamespace } from './schema.ts'
import { validKeyReference, invalidKeyReferenceMessage, keyReferenceReason, keyReferenceError, providerText } from './provider-key-refs.ts'
import { inspectCustomKey, type KeyReferenceReader } from './custom-provider-key.ts'
import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import { customProviderMessages } from './messages.ts'

export type CustomStoreTexts = Translation<typeof customProviderMessages.ja>
const customText = (): CustomStoreTexts => messagesOf(customProviderMessages, currentLocale())

type Phase = 'loading' | 'editing' | 'blocked' | 'savingSettings' | 'savingKey' | 'keyFailed' | 'stale' | 'unknown' | 'saved'
export interface CustomState {
  phase: Phase; draft?: CustomDraft; initial?: CustomDraft; namespace?: SettingsNamespace
  editing: boolean; writable: boolean; taken: string[]; protocols: string[]; errors: CustomErrors; message: string | null
}
// After the key check refused a reference this form had assigned: the outcome
// of taking that name back out of this provider's settings.
const detachKeys = { saved: 'detachSaved', stale: 'detachStale', keyFailed: 'detachKeyFailed', unknown: 'detachUnknown' } as const
/**
 * `text` is read for each message, in the language current at that moment: the
 * form can stay open while the language changes.
 */
export function createCustomProviderStore(remote: Pick<ProviderRemote, 'settings' | 'llm'>,
  keys: Pick<ProviderStore, 'load' | 'save' | 'getSnapshot'>, id?: string, settled: () => void = () => {},
  inspectReference: KeyReferenceReader = ref => inspectCustomKey(remote, ref),
  text: () => CustomStoreTexts = customText) {
  let state: CustomState = { phase: 'loading', editing: id !== undefined, writable: false, taken: [], protocols: [], errors: {}, message: null }
  let target = id
  let active = true
  let connected = true
  let epoch = 0
  let ticket = 0
  let pendingKey: string | undefined
  let saving = false
  let committed = false
  // The reference name this form assigned (or tried to assign) in its own save.
  // Kept for the lifetime of the form: until its key is sent, a key found under
  // that name was registered by someone else and must not be overwritten.
  let assignedReference: string | undefined
  let references: string[] = []
  let changedDuringSave = false
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<CustomState>) => { state = { ...state, ...patch }; if (active) listeners.forEach(fn => fn()) }
  const input = createKeyDraft(value => save(value), () => ({ keyRequired: text().errKeyRequired, saveFailed: text().saveFailed }))
  async function load(): Promise<void> {
    if (!connected || saving) return
    const request = ++ticket
    const generation = epoch
    input.clear()
    publish({ phase: 'loading', message: null, errors: {} })
    try {
      const [description, directory, registered] = await Promise.all([remote.settings.describe(), remote.llm.listConfigurableProviders(), remote.llm.listProviders()])
      if (!active || request !== ticket || generation !== epoch) return
      if (!description.ok || !directory.ok || !registered.ok) throw new Error()
      const namespace = description.value.namespaces.find(row => row.ns === CUSTOM_NS)
      if (!namespace) { publish({ phase: 'blocked', writable: false, message: text().blockedCustomUnavailable }); return }
      const exists = target && objectValue(valueAt(namespace.value, ['providers', target]))
      const editable = !exists || directory.value.some(row => row.provider === target && row.declared === true && row.settingsNs === CUSTOM_NS && JSON.stringify(row.settingsPath) === JSON.stringify(['providers', target]))
      if (!editable || state.editing && !exists) { publish({ phase: 'blocked', writable: false, message: text().blockedProvider }); return }
      const editing = Boolean(exists)
      const draft = customDraft(namespace, editing ? target : undefined)
      const protocols = protocolChoices(namespace)
      const taken = [...new Set([...registered.value.map(row => row.id), ...directory.value.map(row => row.provider), ...Object.keys(objectValue(namespace.value.providers) ? namespace.value.providers : {})])]
      references = directory.value.flatMap(entry => {
        const ns = description.value.namespaces.find(row => row.ns === entry.settingsNs)
        const value = ns && valueAt(ns.value, entry.settingsPath)
        return objectValue(value) && typeof value.apiKeyEnv === 'string' ? [value.apiKeyEnv] : []
      })
      for (const value of Object.values(objectValue(namespace.value.providers) ? namespace.value.providers : {})) {
        if (objectValue(value) && typeof value.apiKeyEnv === 'string') references.push(value.apiKeyEnv)
      }
      // The list (as on main) reads and writes a derived name for a standard
      // row without one. Reserve every destination a non-custom row resolves to.
      for (const row of providerRows(registered.value, directory.value, description.value)) if (!row.custom && row.ref) references.push(row.ref)
      committed = false
      publish({ namespace, initial: structuredClone(draft), draft, editing, protocols, taken,
        writable: description.value.writable, phase: description.value.writable && protocols.length ? 'editing' : 'blocked',
        message: !description.value.writable ? text().notWritable : !protocols.length ? text().protocolsFailed : null })
      await keys.load()
    } catch {
      if (active && request === ticket && generation === epoch) publish({ phase: 'blocked', writable: false, message: text().loadFailed })
    }
  }
  function change(update: (draft: CustomDraft) => CustomDraft): void {
    if (state.phase !== 'editing' || !state.draft) return
    publish({ draft: update(state.draft), errors: {}, message: null })
  }
  function validate(field?: string): CustomErrors {
    const errors = state.draft ? validateCustom(state.draft, state.protocols, state.taken, state.editing, state.namespace, text()) : {}
    const key = input.getSnapshot().draft
    if (/[\x00-\x1f\x7f]/.test(key)) errors.key = text().errKeyControl
    const profile = state.namespace && state.draft && valueAt(state.namespace.value, ['providers', state.draft.id])
    const hasReference = objectValue(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
    const ref = hasReference ? profile.apiKeyEnv as string : providerRef(state.draft?.id ?? '')
    if (key && !validKeyReference(ref)) errors.key = invalidKeyReferenceMessage(providerText())
    else if (key && !hasReference && state.draft) {
      const reason = keyReferenceReason(references, ref)
      if (reason) errors.key = keyReferenceError(state.draft.id, ref, reason)
    }
    const displayed = field ? { ...state.errors } : errors
    if (field) { delete displayed[field]; if (errors[field]) displayed[field] = errors[field] }
    publish({ errors: displayed })
    return errors
  }
  /**
   * Take the name this form assigned back out, with a revision read now, and
   * only while the value is still that name (DSH 0.2.0-rc.2 dsh-llm-pi-ai:
   * a named route resolves exactly that credential; an unnamed declared route
   * sends no key). Never retried automatically.
   */
  async function detach(ref: string, generation: number): Promise<keyof typeof detachKeys> {
    try {
      const description = await remote.settings.describe()
      if (!active || generation !== epoch || !connected) return 'unknown'
      const namespace = description.ok ? description.value.namespaces.find(row => row.ns === CUSTOM_NS) : undefined
      if (!namespace) return 'unknown'
      const profile = valueAt(namespace.value, ['providers', target!])
      if (!objectValue(profile) || profile.apiKeyEnv !== ref) return 'stale'
      const result = await remote.settings.mutate(CUSTOM_NS, [{ op: 'unset', path: ['providers', target!, 'apiKeyEnv'] }], namespace.revision)
      if (generation !== epoch) return 'unknown'
      if (!result.ok) return result.error.code === 'settings/conflict' ? 'stale'
        : ['settings/rejected', 'gateway/bad-request'].includes(result.error.code) ? 'keyFailed' : 'unknown'
      assignedReference = undefined
      references.push(ref)
      const saved = customDraft(result.value, target)
      publish({ namespace: result.value, initial: structuredClone(saved), draft: saved })
      return 'saved'
    } catch { return 'unknown' }
  }
  async function save(keyValue?: string): Promise<KeyOutcome> {
    if (!active || !connected || saving || !state.writable || !['editing', 'keyFailed'].includes(state.phase) || !state.namespace || !state.initial || !state.draft) return { ok: false, code: 'custom', message: providerText().busy }
    const errors = validateCustom(state.draft, state.protocols, state.taken, state.editing, state.namespace)
    if (!committed && Object.keys(errors).length) { publish({ errors }); return { ok: false, code: 'custom', message: text().invalidInput } }
    saving = true
    pendingKey = keyValue
    keyValue = undefined
    changedDuringSave = false
    const generation = epoch
    const { namespace, initial, draft, editing } = state
    if (!committed) {
      target = editing ? initial.id : draft.id
    }
    try {
      if (!committed) {
        const ops = customOperations(namespace, initial, draft, editing, Boolean(pendingKey))
        publish({ phase: 'savingSettings', message: null })
        const profile = valueAt(namespace.value, ['providers', target!])
        const assigning = Boolean(pendingKey) && !(objectValue(profile) && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0)
        if (assigning) {
          const ref = providerRef(target!)
          const info = await inspectReference(ref)
          if (!active || generation !== epoch || !connected) return { ok: false, code: 'custom', message: text().unknown }
          const reason = !info ? text().keyCheckUnknown
            : info.configured ? text().keyCheckRegistered
            : !info.writable ? text().keyCheckReadOnly : undefined
          if (reason) {
            const message = keyReferenceError(target!, ref, reason)
            publish({ phase: 'editing', errors: { key: message } })
            return { ok: false, code: 'custom', message }
          }
          assignedReference = ref
        }
        if (ops.length) {
          const result = await remote.settings.mutate(CUSTOM_NS, ops, namespace.revision)
          if (generation !== epoch) return { ok: false, code: 'custom', message: text().unknown }
          if (!result.ok) {
            const conflict = result.error.code === 'settings/conflict'
            if (!conflict && !['settings/rejected', 'gateway/bad-request'].includes(result.error.code)) {
              publish({ phase: 'unknown', message: text().unknown })
              return { ok: false, code: 'custom', message: text().unknown }
            }
            publish({ phase: conflict ? 'stale' : 'editing', message: conflict ? text().conflict : text().rejected })
            return { ok: false, code: 'custom', message: state.message! }
          }
          committed = true
          const saved = customDraft(result.value, target)
          publish({ namespace: result.value, editing: true, initial: structuredClone(saved), draft: saved })
        } else committed = true
      }
      if (!active || generation !== epoch || !connected) return { ok: false, code: 'custom', message: text().unknown }
      if (pendingKey) {
        publish({ phase: 'savingKey' })
        if (!await keys.load()) {
          const message = `${text().saveFailed} ${keys.getSnapshot().error ?? text().loadStatusFailed}`
          if (active && generation === epoch) publish({ phase: 'keyFailed', message })
          return { ok: false, code: 'custom', message }
        }
        if (!active || generation !== epoch || !connected || !pendingKey) return { ok: false, code: 'custom', message: text().unknown }
        const profile = valueAt(state.namespace!.value, ['providers', target!])
        const ref = objectValue(profile) && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : providerRef(target!)
        const row = keys.getSnapshot().rows.find(row => row.id === target && row.ref === ref)
        const value = pendingKey
        pendingKey = undefined
        const outcome = row
          ? await keys.save(row, value, { canSend: () => active && connected && generation === epoch, requireMissing: ref === assignedReference })
          : { ok: false as const, message: text().referenceChanged, code: 'custom' as const }
        if (!active || generation !== epoch) return { ok: false, code: 'custom', message: text().unknown }
        if (!outcome.ok && outcome.code === 'keyRegisteredMeanwhile' && ref === assignedReference) {
          const phase = await detach(ref, generation)
          const message = `${text().saveFailed} ${outcome.message} ${text()[detachKeys[phase]]}`
          if (active && generation === epoch) publish({ phase, message })
          return { ok: false, code: 'custom', message }
        }
        if (!outcome.ok) {
          const message = `${text().saveFailed} ${outcome.message}`
          publish({ phase: 'keyFailed', message }); return { ok: false, code: 'custom', message }
        }
      }
      const refreshed = await keys.load()
      if (!active || generation !== epoch) return { ok: false, code: 'custom', message: text().unknown }
      publish({ phase: 'saved', message: refreshed ? null : text().savedReloadFailed })
      return { ok: true }
    } catch {
      if (active && generation === epoch) publish({ phase: committed ? 'keyFailed' : 'unknown', message: committed ? text().saveFailed : text().unknown })
      return { ok: false, code: 'custom', message: state.message ?? text().unknown }
    } finally {
      pendingKey = undefined
      saving = false
      settled()
      if (active && changedDuringSave && state.phase === 'editing') publish({ phase: 'stale', message: text().conflict })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    input, load, change, validate,
    activate() { active = true; input.activate() },
    isSaving: () => saving,
    isActive: () => active,
    async submit(): Promise<boolean> {
      if (saving || !active || !connected) return false
      if (Object.keys(validate()).length) return false
      if (state.phase === 'keyFailed' && !input.getSnapshot().draft.trim()) { publish({ errors: { key: text().errKeyRequired } }); return false }
      return input.getSnapshot().draft.trim() ? input.submit() : (await save()).ok
    },
    updated(ns: unknown, revision?: unknown) {
      if (ns !== CUSTOM_NS || !state.namespace || state.phase === 'saved') return
      if (saving) { changedDuringSave = true; return }
      if (revision === state.namespace.revision) return
      input.clear()
      publish({ phase: 'stale', message: text().conflict })
    },
    connectionChanged(next: boolean) {
      if (next === connected) return
      connected = next; epoch++; ticket++; pendingKey = undefined
      input.clear()
      publish({ phase: 'unknown', message: text().unknown })
    },
    dispose() { active = false; ticket++; pendingKey = undefined; input.dispose() },
  }
}
export type CustomProviderStore = ReturnType<typeof createCustomProviderStore>
