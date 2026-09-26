import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eSwitch, type M3eSwitchElement } from '@m3e/react/switch'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eOption } from '@m3e/react/option'
import { M3eFormField } from '@m3e/react/form-field'
import { formatSetting, parseFieldInput, selectFieldState, type SettingField, type SettingValue, type SettingsNamespace } from './schema.ts'
import { fieldKey, type SettingsState, type SettingsStore } from './store.ts'
import { createSettingInput } from './input.ts'
import { findSettingField, settingFieldAccess } from './field-access.ts'

interface FieldsProps {
  fields: SettingField[]
  namespace: SettingsNamespace
  state: SettingsState
  store: SettingsStore
}
export function SchemaFields({ fields, ...props }: FieldsProps) {
  return <>{fields.map((field, index) => field.kind === 'group'
    ? <fieldset className="settings-group" key={`${field.path.join('/')}:${index}`}>
      <legend>{field.label}</legend>
      {field.description && <p className="settings-field-help">{field.description}</p>}
      <SchemaFields fields={field.children ?? []} {...props} />
      <GroupReset field={field} {...props} />
    </fieldset>
    : <FieldEditor key={`${field.path.join('/')}:${index}`} field={field} {...props} />)}</>
}

function GroupReset({ field, namespace, state, store }: Omit<FieldsProps, 'fields'> & { field: SettingField }) {
  const [saving, setSaving] = useState(false)
  const access = settingFieldAccess(namespace, field)
  const error = state.fieldErrors[fieldKey(namespace.ns, field.path)]
  if (!field.overridden || !field.path.length) return null
  async function reset() {
    if (saving) return
    setSaving(true)
    try { await store.edit(namespace.ns, field.path) } finally { setSaving(false) }
  }
  return <div>
    <M3eButton variant="text" className="settings-reset" disabled={!state.writable || !access.reset || saving}
      onClick={() => { void reset() }} aria-label={`${field.label}を既定値に戻す`}>既定値に戻す</M3eButton>
    {access.resetBlocked && <p className="settings-field-help">保護された項目や変更できない項目があるため、まとめて既定値に戻せません。</p>}
    {saving && <div className="settings-saving" role="status">保存しています…</div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </div>
}

function FieldEditor({ field, namespace, state, store }: Omit<FieldsProps, 'fields'> & { field: SettingField }) {
  const id = useId()
  const [validation, setValidation] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const currentField = useRef(field)
  currentField.current = field
  const disabled = !state.writable || field.disabled
  const [input] = useState(() => {
    const generation = state.generation[namespace.ns] ?? 0
    return createSettingInput<SettingValue | undefined>(inputValue(field, field.value), {
      canSave: () => store.getSnapshot().writable && !currentField.current.disabled
        && (store.getSnapshot().generation[namespace.ns] ?? 0) === generation,
      async save(value, reset) {
        const latestField = currentField.current
        let next = value
        if (!reset && ['text', 'number'].includes(latestField.kind)) {
          const parsed = parseFieldInput(latestField, String(value ?? ''))
          if (!parsed.ok) { setValidation(parsed.message); return { ok: false } }
          next = parsed.value
        }
        setValidation(null)
        const accepted = await store.edit(namespace.ns, latestField.path, reset ? undefined : next)
        if (!accepted) return { ok: false }
        const row = store.getSnapshot().namespaces.find(item => item.ns === namespace.ns)
        return { ok: true, value: inputValue(latestField, row && findSettingField(row, latestField.path)?.value) }
      },
    })
  })
  const editing = useSyncExternalStore(input.subscribe, input.getSnapshot, input.getSnapshot)
  const draft = String(editing.value ?? '')
  const choice = editing.value
  const selection = selectFieldState(field, choice)
  const error = validation ?? state.fieldErrors[fieldKey(namespace.ns, field.path)]
  const timing = namespace.applies === 'restart' ? 'DSH の再起動後に反映されます' : 'すぐ反映されます'
  useEffect(() => {
    input.receive(inputValue(field, field.value))
  }, [input, field.kind, field.value])
  useEffect(() => {
    input.setActive(true)
    return () => { clearTimeout(timer.current); input.setActive(false) }
  }, [input])
  function cancelTimer() { clearTimeout(timer.current); timer.current = undefined }
  function flush() {
    cancelTimer()
    return input.flush()
  }
  function changeText(input: string) {
    changeDraft(input)
    cancelTimer()
    timer.current = setTimeout(() => { void flush() }, 600)
  }
  function changeDraft(value: SettingValue) {
    input.change(value)
    setValidation(null)
  }
  function changeChoice(value: SettingValue) {
    if (disabled) return
    changeDraft(value)
    return input.flush()
  }
  function reset() {
    cancelTimer(); setValidation(null)
    return input.reset()
  }
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = `${helpId}${error ? ` ${errorId}` : ''}`
  const readonly = field.kind === 'readonly' || field.kind === 'masked'
  const access = settingFieldAccess(namespace, field)
  return <div className="settings-field">
    {field.kind === 'switch' ? <div className="settings-switch-row">
      <span id={`${id}-label`}>{field.label}</span>
      <M3eSwitch aria-label={field.label} aria-describedby={describedBy} disabled={disabled}
        checked={choice === true} onChange={event => { void changeChoice((event.currentTarget as M3eSwitchElement).checked) }} />
    </div> : field.kind === 'select' ? <M3eFormField variant="outlined" error={Boolean(error)}>
      <label slot="label" htmlFor={id}>{field.label}</label>
      <M3eSelect id={id} aria-label={field.label} aria-describedby={describedBy} disabled={disabled}
        value={String(selection.index)}
        onChange={event => {
          const index = Number((event.currentTarget as M3eSelectElement).value)
          const option = field.options?.[index]
          if (option) void changeChoice(option.value)
        }}>
        {selection.placeholder && <M3eOption value="-1" disabled>{selection.placeholder}</M3eOption>}
        {field.options?.map((option, index) => <M3eOption key={index} value={String(index)}>{option.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField> : readonly ? <>
      <h3>{field.label}</h3>
      <pre className="settings-value">{field.kind === 'masked' ? field.registered ? '登録済み' : '未登録' : formatSetting(field.value)}</pre>
      <p className="settings-field-help">この項目は今の画面で編集してください</p>
    </> : <M3eFormField variant="outlined" error={Boolean(error)}>
      <label slot="label" htmlFor={id}>{field.label}</label>
      <input id={id} type={field.kind === 'number' ? 'number' : 'text'} value={draft}
        min={field.min} max={field.max} step={field.step ?? 'any'} required={field.required}
        disabled={disabled} aria-describedby={describedBy} aria-invalid={Boolean(error)}
        onChange={event => changeText(event.currentTarget.value)} onBlur={() => { void flush() }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void flush() } }} />
    </M3eFormField>}
    <p className="settings-field-help" id={helpId}>{[field.description, timing].filter(Boolean).join('\n')}</p>
    {error && <p className="settings-error" role="alert" id={errorId}>{error}</p>}
    {field.kind !== 'masked' && field.overridden && field.path.length > 0 && <M3eButton variant="text" className="settings-reset" disabled={!state.writable || !access.reset || editing.saving}
      onClick={() => { void reset() }} aria-label={`${field.label}を既定値に戻す`}>既定値に戻す</M3eButton>}
    {access.resetBlocked && <p className="settings-field-help">保護された項目や変更できない項目があるため、まとめて既定値に戻せません。</p>}
    {editing.saving && <div className="settings-saving" role="status">保存しています…</div>}
    {editing.saved && !editing.saving && !error && <div className="settings-saving" role="status">保存しました</div>}
  </div>
}

function inputValue(field: Pick<SettingField, 'kind'>, value: SettingValue | undefined): SettingValue | undefined {
  return ['text', 'number'].includes(field.kind)
    ? typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    : value
}
