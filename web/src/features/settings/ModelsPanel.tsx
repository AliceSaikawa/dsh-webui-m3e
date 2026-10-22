import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eCheckbox } from '@m3e/react/checkbox'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eOption } from '@m3e/react/option'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eSwitch, type M3eSwitchElement } from '@m3e/react/switch'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { PROVIDER_EVENTS } from './providers.ts'
import { composerApi, type ModelCatalog, type ModelSelection } from '../composer/api.ts'
// composerApi throws its own failures as LocalizedError; errorText shows only those and Host failures.
import { errorText } from '../composer/localized-error.ts'
import { reasoningEffortLabel } from '../composer/helpers.ts'
import { modelChoices, modelValue } from '../composer/model-picker.ts'
import {
  canEnableSubagent, canToggleAllowedModel, chooseModel, effortSelectionState,
  modelResetOperations, modelSaveOperations, modelSelectionState, savedModel,
  subagentResetOperations, subagentSelection, toggleAllowedModel, withReasoningEffort,
  type SubagentSelection,
} from './model-settings.ts'
import { namespaceTitle } from './schema.ts'
import type { SettingsNamespace } from './schema.ts'
import { fieldKey, type SettingsState, type SettingsStore } from './store.ts'
import { useMessages } from '../../i18n/index.ts'
import { modelMessages, settingsSchemaMessages } from './messages.ts'
import type { ModelSettingsTexts } from './model-settings.ts'

type ModelTexts = ReturnType<typeof useMessages<typeof modelMessages.ja>>

interface PanelProps { namespaces: SettingsNamespace[]; state: SettingsState; store: SettingsStore }
type CatalogState = { phase: 'loading' | 'ready' | 'error'; catalog?: ModelCatalog; error?: string }


export function ModelsPanel({ namespaces, state, store }: PanelProps) {
  const text = useMessages(modelMessages)
  const schemaText = useMessages(settingsSchemaMessages)
  const { remote, connection } = useDsh()
  const connectionState = useSnapshot(connection.state)
  const api = useMemo(() => composerApi(remote), [remote])
  const [catalog, setCatalog] = useState<CatalogState>({ phase: 'loading' })
  const request = useRef(0)
  function load() {
    const ticket = ++request.current
    setCatalog(previous => ({ ...previous, phase: 'loading', error: undefined }))
    void api.modelCatalog().then(value => {
      if (ticket === request.current) setCatalog({ phase: 'ready', catalog: value })
    }).catch(cause => {
      if (ticket === request.current) setCatalog(previous => ({ ...previous, phase: 'error', error: errorText(cause, text.catalogFailed) }))
    })
  }
  useEffect(() => {
    if (connectionState !== 'connected') { setCatalog(previous => ({ ...previous, phase: 'loading' })); return }
    const stops = PROVIDER_EVENTS.map(event => onRemoteEvent(remote, event, load))
    load()
    return () => { request.current++; stops.forEach(stop => stop()) }
  }, [api, remote, connectionState])
  const choices = catalog.catalog ? modelChoices(catalog.catalog) : []
  return <>
    {catalog.phase === 'loading' && <p role="status">{text.loading}</p>}
    {catalog.phase === 'error' && <div className="settings-notice">
      <p role="alert">{catalog.error}</p>
      <M3eButton onClick={load}>{text.reload}</M3eButton>
    </div>}
    {catalog.catalog && catalog.catalog.failures.length > 0 && <div className="settings-notice" role="status">
      <p>{text.partial}</p>
      {catalog.catalog.failures.map(item => <p key={item.id}>{text.failureRow(item.name, text.catalogFailed)}</p>)}
      <M3eButton onClick={load}>{text.reload}</M3eButton>
    </div>}
    {namespaces.map(namespace => <section className="settings-namespace" key={namespace.ns}>
      <h2>{namespaceTitle(namespace.ns, schemaText)}</h2>
      <div className="settings-fields" key={`${namespace.ns}:${state.generation[namespace.ns] ?? 0}`}>
        {namespace.ns === 'agent-default-model'
          ? <DefaultModel namespace={namespace} state={state} store={store} choices={choices} available={catalog.phase === 'ready'} loading={catalog.phase === 'loading'} text={text} schemaText={schemaText} />
          : <SubagentModels namespace={namespace} state={state} store={store} choices={choices} available={catalog.phase === 'ready'} loading={catalog.phase === 'loading'} text={text} schemaText={schemaText} />}
      </div>
    </section>)}
  </>
}

type Choice = ReturnType<typeof modelChoices>[number]
interface EditorProps { namespace: SettingsNamespace; state: SettingsState; store: SettingsStore; choices: Choice[]; available: boolean; loading: boolean }
function EditStatus({ namespace, state, saving, saved, reset, text, schemaText }: {
  namespace: SettingsNamespace; state: SettingsState; saving: boolean; saved: boolean; reset(): void
  text: ModelTexts; schemaText: ReturnType<typeof useMessages<typeof settingsSchemaMessages.ja>>
}) {
  const key = fieldKey(namespace.ns, namespace.ns === 'agent-default-model' ? ['model'] : ['enabled'])
  const error = state.fieldErrors[key]
  const overridden = Object.keys(namespace.user ?? {}).length > 0
  return <div className="settings-field">
    <p className="settings-field-help">{text.appliedImmediately}</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {overridden && <M3eButton variant="text" className="settings-reset" disabled={!state.writable || saving}
      onClick={reset} aria-label={text.resetLabel(namespaceTitle(namespace.ns, schemaText))}>{text.resetToDefault}</M3eButton>}
    {saving && <div className="settings-saving" role="status">{text.saving}</div>}
    {saved && !saving && !error && <div className="settings-saving" role="status">{text.saved}</div>}
  </div>
}

function DefaultModel({ namespace, state, store, choices, available, text, schemaText }: EditorProps & { text: ModelTexts; schemaText: ReturnType<typeof useMessages<typeof settingsSchemaMessages.ja>> }) {
  const modelId = useId()
  const effortId = useId()
  const [draft, setDraft] = useState<ModelSelection | undefined>(() => savedModel(namespace.value))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const modelSelect = useRef<M3eSelectElement>(null)
  const effortSelect = useRef<M3eSelectElement>(null)
  const current = draft
  const selection = modelSelectionState(current, choices, text as ModelSettingsTexts)
  const choice = choices.find(item => item.value === selection.value)
  const reasoning = choice?.model.reasoning
  const effort = effortSelectionState(current, choice, text as ModelSettingsTexts)
  const error = state.fieldErrors[fieldKey(namespace.ns, ['model'])]
  useEffect(() => { if (!saving) setDraft(savedModel(namespace.value)) }, [namespace.value, saving])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (modelSelect.current) modelSelect.current.value = selection.value
      if (effortSelect.current) effortSelect.current.value = effort.value
    })
    return () => cancelAnimationFrame(frame)
  }, [selection.value, effort.value, choices.length, Boolean(reasoning)])
  async function save(next: ModelSelection) {
    if (saving || !state.writable || !available) return
    setDraft(next); setSaved(false); setSaving(true)
    try { setSaved(await store.editModelSettings('agent-default-model', () => modelSaveOperations(next))) }
    finally {
      setDraft(savedModel(store.getSnapshot().namespaces.find(row => row.ns === namespace.ns)?.value ?? {}))
      setSaving(false)
    }
  }
  async function reset() {
    if (saving || !state.writable) return
    setSaved(false); setSaving(true)
    try { setSaved(await store.editModelSettings('agent-default-model', () => modelResetOperations, true)) }
    finally {
      setDraft(savedModel(store.getSnapshot().namespaces.find(row => row.ns === namespace.ns)?.value ?? {}))
      setSaving(false)
    }
  }
  return <>
    <div className="settings-field"><M3eFormField variant="outlined" error={Boolean(error)}>
      <label slot="label" htmlFor={modelId}>{text.modelLabel}</label>
      <M3eSelect ref={modelSelect} id={modelId} aria-label={text.modelLabel}
        disabled={!state.writable || saving || !available || choices.length === 0}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          const selected = choices.find(item => item.value === value)
          if (selected) void save(chooseModel(selected))
        }}>
        {!current && <M3eOption value="" disabled>{text.modelUnset}</M3eOption>}
        {selection.unknownLabel && <span slot="value">{selection.unknownLabel}</span>}
        {selection.unknownLabel && <M3eOption value={selection.value} disabled>{selection.unknownLabel}</M3eOption>}
        {choices.map(item => <M3eOption key={item.value} value={item.value}>{item.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField></div>
    <div className="settings-field" hidden={!reasoning}><M3eFormField variant="outlined" floatLabel="always" error={Boolean(error)}>
      <label slot="label" htmlFor={effortId}>{text.reasoningEffort}</label>
      <M3eSelect ref={effortSelect} id={effortId} aria-label={text.reasoningEffort} disabled={!state.writable || saving || !available}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value ?? ''
          if (current && typeof value === 'string' && (value === '' || reasoning?.efforts.some(item => item.id === value)))
            void save(withReasoningEffort(current, value))
        }}>
        {!effort.value && <span slot="value">{text.effortDefault}</span>}
        <M3eOption value="">{text.effortDefault}</M3eOption>
        {effort.unknownLabel && <span slot="value">{effort.unknownLabel}</span>}
        {effort.unknownLabel && <M3eOption value={effort.value} disabled>{effort.unknownLabel}</M3eOption>}
        {reasoning?.efforts.map((item, index) => <M3eOption key={item.id} value={item.id}>{reasoningEffortLabel(item.id, index)}</M3eOption>)}
      </M3eSelect>
    </M3eFormField></div>
    <EditStatus namespace={namespace} state={state} saving={saving} saved={saved} reset={() => { void reset() }} text={text} schemaText={schemaText} />
  </>
}

function SubagentModels({ namespace, state, store, choices, available, loading, text, schemaText }: EditorProps & { text: ModelTexts; schemaText: ReturnType<typeof useMessages<typeof settingsSchemaMessages.ja>> }) {
  const [draft, setDraft] = useState<SubagentSelection>(() => subagentSelection(namespace.value))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const pending = useRef(0)
  useEffect(() => { if (pending.current === 0) setDraft(subagentSelection(namespace.value)) }, [namespace.value])
  const known = new Set(choices.map(item => item.value))
  const unknown = draft.allowedModels.filter(item => !known.has(modelValue(item)))
  function commit(ops: Parameters<SettingsStore['editModelSettings']>[1]) {
    pending.current++
    setSaving(true); setSaved(false)
    void store.editModelSettings('subagent-model-selection-settings', ops).then(ok => {
      if (ok) setSaved(true)
    }).finally(() => {
      pending.current--
      if (pending.current === 0) {
        setDraft(subagentSelection(store.getSnapshot().namespaces.find(row => row.ns === namespace.ns)?.value ?? {}))
        setSaving(false)
      }
    })
  }
  function changeEnabled(enabled: boolean) {
    if (!state.writable || !available || (enabled && !canEnableSubagent(draft))) return
    setDraft(current => ({ ...current, enabled }))
    commit(row => {
      if (enabled && !canEnableSubagent(subagentSelection(row.value))) return []
      return [{ op: 'set', path: ['enabled'], value: enabled }]
    })
  }
  function changeAllowed(target: { provider: string; model: string }, checked: boolean) {
    if (!state.writable || !available || !canToggleAllowedModel(draft, target, checked)) return
    setDraft(current => ({ ...current, allowedModels: toggleAllowedModel(current.allowedModels, target, checked) }))
    commit(row => {
      const latest = subagentSelection(row.value)
      if (!canToggleAllowedModel(latest, target, checked)) return []
      return [{ op: 'set', path: ['allowedModels'], value: toggleAllowedModel(latest.allowedModels, target, checked)
        .map(item => ({ provider: item.provider, model: item.model })) }]
    })
  }
  function reset() {
    if (saving || !state.writable) return
    setDraft(subagentSelection(namespace.base ?? {}))
    pending.current++
    setSaving(true); setSaved(false)
    void store.editModelSettings('subagent-model-selection-settings', () => subagentResetOperations, true).then(ok => {
      if (ok) setSaved(true)
    }).finally(() => {
      pending.current--
      setDraft(subagentSelection(store.getSnapshot().namespaces.find(row => row.ns === namespace.ns)?.value ?? {}))
      setSaving(false)
    })
  }
  const checked = (target: { provider: string; model: string }) => draft.allowedModels.some(item => item.provider === target.provider && item.model === target.model)
  return <>
    <div className="settings-field settings-switch-row">
      <div><span>{text.enable}</span>
        {!draft.enabled && !canEnableSubagent(draft) && <p className="settings-field-help">{text.allowFirst}</p>}
      </div>
      <M3eSwitch aria-label={text.subagentSwitch} checked={draft.enabled}
        disabled={!state.writable || !available || (!draft.enabled && !canEnableSubagent(draft))}
        onChange={event => changeEnabled((event.currentTarget as M3eSwitchElement).checked)} />
    </div>
    <div className="settings-field">
      <h3>{text.allowedModels}</h3>
      {loading && <p className="settings-field-help">{text.loading}</p>}
      {available && choices.length === 0 && <p className="settings-field-help">{text.noChoices}</p>}
      {draft.enabled && draft.allowedModels.length === 1 && <p className="settings-field-help">{text.keepOne}</p>}
      <div className="settings-model-options">
        {choices.map(item => <label className="settings-model-option" key={item.value}>
          <M3eCheckbox aria-label={item.label} checked={checked({ provider: item.provider, model: item.model.id })}
            disabled={!state.writable || !available || !canToggleAllowedModel(draft, { provider: item.provider, model: item.model.id }, false) && checked({ provider: item.provider, model: item.model.id })}
            onChange={event => changeAllowed({ provider: item.provider, model: item.model.id }, (event.currentTarget as HTMLElement & { checked: boolean }).checked)} />
          <span>{item.label}</span>
        </label>)}
        {unknown.map(item => <label className="settings-model-option" key={modelValue(item)}>
          <M3eCheckbox aria-label={text.unknownModel(item.provider, item.model)} checked
            disabled={!state.writable || !available || !canToggleAllowedModel(draft, item, false)}
            onChange={event => changeAllowed(item, (event.currentTarget as HTMLElement & { checked: boolean }).checked)} />
          <span>{text.unknownModel(item.provider, item.model)}</span>
        </label>)}
      </div>
    </div>
    <EditStatus namespace={namespace} state={state} saving={saving} saved={saved} reset={reset} text={text} schemaText={schemaText} />
  </>
}
