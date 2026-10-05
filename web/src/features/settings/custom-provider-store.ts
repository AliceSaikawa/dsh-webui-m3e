import { createKeyDraft, type ProviderRemote, type ProviderStore, type KeyOutcome } from './providers.ts'
import { CUSTOM_NS, customDraft, customOperations, objectValue, protocolChoices, providerRef, validateCustom, type CustomDraft, type CustomErrors } from './custom-provider.ts'
import { valueAt, type SettingsNamespace } from './schema.ts'

type Phase = 'loading' | 'editing' | 'blocked' | 'savingSettings' | 'savingKey' | 'keyFailed' | 'stale' | 'unknown' | 'saved'
export interface CustomState {
  phase: Phase; draft?: CustomDraft; initial?: CustomDraft; namespace?: SettingsNamespace
  editing: boolean; writable: boolean; taken: string[]; protocols: string[]; errors: CustomErrors; message: string | null
}
const conflictMessage = 'ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。'
const unknownMessage = '接続が切れました。保存できたか確認してから、もう一度お試しください。'
const partialMessage = '提供元の設定は保存しましたが、API キーを保存できませんでした。入力し直してください。'
export function createCustomProviderStore(remote: Pick<ProviderRemote, 'settings' | 'llm'>,
  keys: Pick<ProviderStore, 'load' | 'save' | 'getSnapshot'>, id?: string, settled: () => void = () => {}) {
  let state: CustomState = { phase: 'loading', editing: id !== undefined, writable: false, taken: [], protocols: [], errors: {}, message: null }
  let target = id
  let active = true
  let connected = true
  let epoch = 0
  let ticket = 0
  let pendingKey: string | undefined
  let saving = false
  let committed = false
  let changedDuringSave = false
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<CustomState>) => { state = { ...state, ...patch }; if (active) listeners.forEach(fn => fn()) }
  const input = createKeyDraft(value => save(value))
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
      if (!namespace) { publish({ phase: 'blocked', writable: false, message: 'この DSH ではカスタムプロバイダーを設定できません。' }); return }
      const exists = target && objectValue(valueAt(namespace.value, ['providers', target]))
      const editable = !exists || directory.value.some(row => row.provider === target && row.declared === true && row.settingsNs === CUSTOM_NS && JSON.stringify(row.settingsPath) === JSON.stringify(['providers', target]))
      if (!editable || state.editing && !exists) { publish({ phase: 'blocked', writable: false, message: 'この提供元は変更できません。提供元の一覧を読み直してください。' }); return }
      const editing = Boolean(exists)
      const draft = customDraft(namespace, editing ? target : undefined)
      const protocols = protocolChoices(namespace)
      const taken = [...new Set([...registered.value.map(row => row.id), ...directory.value.map(row => row.provider), ...Object.keys(objectValue(namespace.value.providers) ? namespace.value.providers : {})])]
      committed = false
      publish({ namespace, initial: structuredClone(draft), draft, editing, protocols, taken,
        writable: description.value.writable, phase: description.value.writable && protocols.length ? 'editing' : 'blocked',
        message: !description.value.writable ? 'この DSH では設定を変更できません' : !protocols.length ? 'API プロトコルの選択肢を取得できません。' : null })
      await keys.load()
    } catch {
      if (active && request === ticket && generation === epoch) publish({ phase: 'blocked', writable: false, message: '設定を読み込めませんでした。接続を確認して、もう一度お試しください。' })
    }
  }
  function change(update: (draft: CustomDraft) => CustomDraft): void {
    if (state.phase !== 'editing' || !state.draft) return
    publish({ draft: update(state.draft), errors: {}, message: null })
  }
  function validate(field?: string): CustomErrors {
    const errors = state.draft ? validateCustom(state.draft, state.protocols, state.taken, state.editing, state.namespace) : {}
    const key = input.getSnapshot().draft
    if (/[\x00-\x1f\x7f]/.test(key)) errors.key = 'API キーに改行や制御文字は使えません。'
    if (key && state.draft && !state.editing && state.taken.some(id => providerRef(id) === providerRef(state.draft!.id))) errors.key = '別の提供元とキーの参照名が重なります。プロバイダー ID を変更してください。'
    const displayed = field ? { ...state.errors } : errors
    if (field) { delete displayed[field]; if (errors[field]) displayed[field] = errors[field] }
    publish({ errors: displayed })
    return errors
  }
  async function save(keyValue?: string): Promise<KeyOutcome> {
    if (!active || !connected || saving || !state.writable || !['editing', 'keyFailed'].includes(state.phase) || !state.namespace || !state.initial || !state.draft) return { ok: false, message: '接続と処理中の操作を確認してください。' }
    const errors = validateCustom(state.draft, state.protocols, state.taken, state.editing, state.namespace)
    if (!committed && Object.keys(errors).length) { publish({ errors }); return { ok: false, message: '入力内容を確認してください。' } }
    saving = true
    pendingKey = keyValue
    keyValue = undefined
    changedDuringSave = false
    const generation = epoch
    const { namespace, initial, draft, editing } = state
    if (!committed) target = editing ? initial.id : draft.id
    try {
      if (!committed) {
        const ops = customOperations(namespace, initial, draft, editing, Boolean(pendingKey))
        publish({ phase: 'savingSettings', message: null })
        if (ops.length) {
          const result = await remote.settings.mutate(CUSTOM_NS, ops, namespace.revision)
          if (generation !== epoch) return { ok: false, message: unknownMessage }
          if (!result.ok) {
            const conflict = result.error.code === 'settings/conflict'
            publish({ phase: conflict ? 'stale' : 'editing', message: conflict ? conflictMessage : 'この変更は保存できませんでした。入力内容を確認してください。' })
            return { ok: false, message: state.message! }
          }
          committed = true
          const saved = customDraft(result.value, target)
          publish({ namespace: result.value, editing: true, initial: structuredClone(saved), draft: saved })
        } else committed = true
      }
      if (!active || generation !== epoch || !connected) return { ok: false, message: unknownMessage }
      if (pendingKey) {
        publish({ phase: 'savingKey' })
        if (!await keys.load()) throw new Error()
        if (!active || generation !== epoch || !connected || !pendingKey) return { ok: false, message: unknownMessage }
        const profile = valueAt(state.namespace!.value, ['providers', target!])
        const ref = objectValue(profile) && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : providerRef(target!)
        const row = keys.getSnapshot().rows.find(row => row.id === target && row.ref === ref)
        const value = pendingKey
        pendingKey = undefined
        const outcome = row ? await keys.save(row, value) : { ok: false, message: partialMessage }
        if (!active || generation !== epoch) return { ok: false, message: unknownMessage }
        if (!outcome.ok) { publish({ phase: 'keyFailed', message: partialMessage }); return { ok: false, message: partialMessage } }
      }
      const refreshed = await keys.load()
      if (!active || generation !== epoch) return { ok: false, message: unknownMessage }
      publish({ phase: 'saved', message: refreshed ? null : '保存しましたが、一覧を更新できませんでした。再読み込みしてください。' })
      return { ok: true }
    } catch {
      if (active && generation === epoch) publish({ phase: committed ? 'keyFailed' : 'unknown', message: committed ? partialMessage : unknownMessage })
      return { ok: false, message: state.message ?? unknownMessage }
    } finally {
      pendingKey = undefined
      saving = false
      settled()
      if (active && changedDuringSave && state.phase === 'editing') publish({ phase: 'stale', message: conflictMessage })
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
      if (state.phase === 'keyFailed' && !input.getSnapshot().draft.trim()) { publish({ errors: { key: 'API キーを入力してください。' } }); return false }
      return input.getSnapshot().draft.trim() ? input.submit() : (await save()).ok
    },
    updated(ns: unknown, revision?: unknown) {
      if (ns !== CUSTOM_NS || !state.namespace || state.phase === 'saved') return
      if (saving) { changedDuringSave = true; return }
      if (revision === state.namespace.revision) return
      input.clear()
      publish({ phase: 'stale', message: conflictMessage })
    },
    connectionChanged(next: boolean) {
      if (next === connected) return
      connected = next; epoch++; ticket++; pendingKey = undefined
      input.clear()
      publish({ phase: 'unknown', message: unknownMessage })
    },
    dispose() { active = false; ticket++; pendingKey = undefined; input.dispose() },
  }
}
export type CustomProviderStore = ReturnType<typeof createCustomProviderStore>
