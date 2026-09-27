import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eCheckbox } from '@m3e/react/checkbox'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eOption } from '@m3e/react/option'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eSwitch, type M3eSwitchElement } from '@m3e/react/switch'
import { useDsh } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { composerApi, type ModelCatalog, type ModelSelection } from '../composer/api.ts'
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

interface PanelProps { namespaces: SettingsNamespace[]; state: SettingsState; store: SettingsStore }
type CatalogState = { phase: 'loading' | 'ready' | 'error'; catalog?: ModelCatalog; error?: string }

function catalogError(cause: unknown): string {
  if (cause instanceof Error && /[\u3040-\u30ff\u3400-\u9fff]/.test(cause.message)) return cause.message
  return remoteErrorMessage(cause, 'モデル一覧を取得できませんでした。接続を確認してください。')
}

export function ModelsPanel({ namespaces, state, store }: PanelProps) {
  const { remote } = useDsh()
  const api = useMemo(() => composerApi(remote), [remote])
  const [catalog, setCatalog] = useState<CatalogState>({ phase: 'loading' })
  const request = useRef(0)
  function load() {
    const ticket = ++request.current
    setCatalog(previous => ({ ...previous, phase: 'loading', error: undefined }))
    void api.modelCatalog().then(value => {
      if (ticket === request.current) setCatalog({ phase: 'ready', catalog: value })
    }).catch(cause => {
      if (ticket === request.current) setCatalog(previous => ({ ...previous, phase: 'error', error: catalogError(cause) }))
    })
  }
  useEffect(() => { load(); return () => { request.current++ } }, [api])
  const choices = catalog.catalog ? modelChoices(catalog.catalog) : []
  return <>
    {catalog.phase === 'loading' && <p role="status">モデル一覧を読み込み中…</p>}
    {catalog.phase === 'error' && <div className="settings-notice">
      <p role="alert">{catalog.error}</p>
      <M3eButton onClick={load}>もう一度読み込む</M3eButton>
    </div>}
    {catalog.catalog && catalog.catalog.failures.length > 0 && <div className="settings-notice" role="status">
      <p>一部のモデル一覧を取得できませんでした。</p>
      {catalog.catalog.failures.map(item => <p key={item.id}>{item.name}：{catalogError(new Error(item.message))}</p>)}
      <M3eButton onClick={load}>もう一度読み込む</M3eButton>
    </div>}
    {namespaces.map(namespace => <section className="settings-namespace" key={namespace.ns}>
      <h2>{namespaceTitle(namespace.ns)}</h2>
      <div className="settings-fields" key={`${namespace.ns}:${state.generation[namespace.ns] ?? 0}`}>
        {namespace.ns === 'agent-default-model'
          ? <DefaultModel namespace={namespace} state={state} store={store} choices={choices} available={catalog.phase === 'ready'} loading={catalog.phase === 'loading'} />
          : <SubagentModels namespace={namespace} state={state} store={store} choices={choices} available={catalog.phase === 'ready'} loading={catalog.phase === 'loading'} />}
      </div>
    </section>)}
  </>
}

type Choice = ReturnType<typeof modelChoices>[number]
interface EditorProps { namespace: SettingsNamespace; state: SettingsState; store: SettingsStore; choices: Choice[]; available: boolean; loading: boolean }
const timing = (row: SettingsNamespace) => row.applies === 'restart' ? 'DSH の再起動後に反映されます' : 'すぐ反映されます'

function EditStatus({ namespace, state, saving, saved, reset }: {
  namespace: SettingsNamespace; state: SettingsState; saving: boolean; saved: boolean; reset(): void
}) {
  const key = fieldKey(namespace.ns, namespace.ns === 'agent-default-model' ? ['model'] : ['enabled'])
  const error = state.fieldErrors[key]
  const overridden = Object.keys(namespace.user ?? {}).length > 0
  return <div className="settings-field">
    <p className="settings-field-help">{timing(namespace)}</p>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {overridden && <M3eButton variant="text" className="settings-reset" disabled={!state.writable || saving}
      onClick={reset} aria-label={`${namespaceTitle(namespace.ns)}を既定値に戻す`}>既定値に戻す</M3eButton>}
    {saving && <div className="settings-saving" role="status">保存しています…</div>}
    {saved && !saving && !error && <div className="settings-saving" role="status">保存しました</div>}
  </div>
}

function DefaultModel({ namespace, state, store, choices, available }: EditorProps) {
  const modelId = useId()
  const effortId = useId()
  const [draft, setDraft] = useState<ModelSelection | undefined>(() => savedModel(namespace.value))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const modelSelect = useRef<M3eSelectElement>(null)
  const effortSelect = useRef<M3eSelectElement>(null)
  const current = draft
  const selection = modelSelectionState(current, choices)
  const choice = choices.find(item => item.value === selection.value)
  const reasoning = choice?.model.reasoning
  const effort = effortSelectionState(current, choice)
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
      <label slot="label" htmlFor={modelId}>モデル</label>
      <M3eSelect ref={modelSelect} id={modelId} aria-label="モデル"
        disabled={!state.writable || saving || !available || choices.length === 0}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          const selected = choices.find(item => item.value === value)
          if (selected) void save(chooseModel(selected))
        }}>
        {!current && <M3eOption value="" disabled>未設定</M3eOption>}
        {selection.unknownLabel && <span slot="value">{selection.unknownLabel}</span>}
        {selection.unknownLabel && <M3eOption value={selection.value} disabled>{selection.unknownLabel}</M3eOption>}
        {choices.map(item => <M3eOption key={item.value} value={item.value}>{item.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField></div>
    <div className="settings-field" hidden={!reasoning}><M3eFormField variant="outlined" error={Boolean(error)}>
      <label slot="label" htmlFor={effortId}>推論の強さ</label>
      <M3eSelect ref={effortSelect} id={effortId} aria-label="推論の強さ" disabled={!state.writable || saving || !available}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value ?? ''
          if (current && typeof value === 'string' && (value === '' || reasoning?.efforts.some(item => item.id === value)))
            void save(withReasoningEffort(current, value))
        }}>
        {!effort.value && <span slot="value">既定（モデルに任せる）</span>}
        <M3eOption value="">既定（モデルに任せる）</M3eOption>
        {effort.unknownLabel && <span slot="value">{effort.unknownLabel}</span>}
        {effort.unknownLabel && <M3eOption value={effort.value} disabled>{effort.unknownLabel}</M3eOption>}
        {reasoning?.efforts.map((item, index) => <M3eOption key={item.id} value={item.id}>{reasoningEffortLabel(item.id, index)}</M3eOption>)}
      </M3eSelect>
    </M3eFormField></div>
    <EditStatus namespace={namespace} state={state} saving={saving} saved={saved} reset={() => { void reset() }} />
  </>
}

function SubagentModels({ namespace, state, store, choices, available, loading }: EditorProps) {
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
    void store.editModelSettings('subagent-model-selection', ops).then(ok => {
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
    void store.editModelSettings('subagent-model-selection', () => subagentResetOperations, true).then(ok => {
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
      <div><span>有効にする</span>
        {!draft.enabled && !canEnableSubagent(draft) && <p className="settings-field-help">先に使ってよいモデルを 1 つ以上選んでください</p>}
      </div>
      <M3eSwitch aria-label="サブエージェントのモデルを有効にする" checked={draft.enabled}
        disabled={!state.writable || !available || (!draft.enabled && !canEnableSubagent(draft))}
        onChange={event => changeEnabled((event.currentTarget as M3eSwitchElement).checked)} />
    </div>
    <div className="settings-field">
      <h3>使わせてよいモデル</h3>
      {loading && <p className="settings-field-help">モデル一覧を読み込み中…</p>}
      {available && choices.length === 0 && <p className="settings-field-help">選べるモデルがありません。</p>}
      {draft.enabled && draft.allowedModels.length === 1 && <p className="settings-field-help">有効の間は 1 つ以上必要です</p>}
      <div className="settings-model-options">
        {choices.map(item => <label className="settings-model-option" key={item.value}>
          <M3eCheckbox aria-label={item.label} checked={checked({ provider: item.provider, model: item.model.id })}
            disabled={!state.writable || !available || !canToggleAllowedModel(draft, { provider: item.provider, model: item.model.id }, false) && checked({ provider: item.provider, model: item.model.id })}
            onChange={event => changeAllowed({ provider: item.provider, model: item.model.id }, (event.currentTarget as HTMLElement & { checked: boolean }).checked)} />
          <span>{item.label}</span>
        </label>)}
        {unknown.map(item => <label className="settings-model-option" key={modelValue(item)}>
          <M3eCheckbox aria-label={`一覧にないモデル：${item.provider} / ${item.model}`} checked
            disabled={!state.writable || !available || !canToggleAllowedModel(draft, item, false)}
            onChange={event => changeAllowed(item, (event.currentTarget as HTMLElement & { checked: boolean }).checked)} />
          <span>一覧にないモデル：{item.provider} / {item.model}</span>
        </label>)}
      </div>
    </div>
    <EditStatus namespace={namespace} state={state} saving={saving} saved={saved} reset={reset} />
  </>
}
