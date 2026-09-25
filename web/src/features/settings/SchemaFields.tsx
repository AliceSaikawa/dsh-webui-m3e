import { useEffect, useId, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eSwitch, type M3eSwitchElement } from '@m3e/react/switch'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eOption } from '@m3e/react/option'
import { M3eFormField } from '@m3e/react/form-field'
import { formatSetting, parseFieldInput, type SettingField, type SettingValue, type SettingsNamespace } from './schema.ts'
import { fieldKey, type SettingsState, type SettingsStore } from './store.ts'

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
    </fieldset>
    : <FieldEditor key={`${field.path.join('/')}:${index}`} field={field} {...props} />)}</>
}

function FieldEditor({ field, namespace, state, store }: Omit<FieldsProps, 'fields'> & { field: SettingField }) {
  const id = useId()
  const original = typeof field.value === 'string' || typeof field.value === 'number' ? String(field.value) : ''
  const [draft, setDraft] = useState(original)
  const [choice, setChoice] = useState(field.value)
  const [validation, setValidation] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(draft)
  const sending = useRef(false)
  const deferred = useRef(false)
  const disabled = !state.writable || field.disabled || Boolean(state.busy[namespace.ns])
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const error = validation ?? state.fieldErrors[fieldKey(namespace.ns, field.path)]
  const timing = namespace.applies === 'restart' ? 'DSH の再起動後に反映されます' : 'すぐ反映されます'
  useEffect(() => {
    setDraft(original); latest.current = original; dirty.current = false
    setChoice(field.value)
  }, [original, field.value])
  useEffect(() => () => { clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!disabled && deferred.current) {
      deferred.current = false
      void flush()
    }
  }, [disabled])
  function cancelTimer() { clearTimeout(timer.current); timer.current = undefined }
  async function flush() {
    cancelTimer()
    if (!dirty.current || sending.current) return
    if (disabledRef.current) { deferred.current = true; return }
    const parsed = parseFieldInput(field, latest.current)
    if (!parsed.ok) { setValidation(parsed.message); return }
    setValidation(null)
    sending.current = true
    dirty.current = false
    const accepted = await store.edit(namespace.ns, field.path, parsed.value)
    sending.current = false
    dirty.current = !accepted
    setSaved(accepted)
  }
  function changeText(input: string) {
    latest.current = input; setDraft(input); setSaved(false); setValidation(null)
    dirty.current = input !== original
    cancelTimer()
    if (dirty.current) timer.current = setTimeout(() => { void flush() }, 600)
  }
  async function changeChoice(value: SettingValue) {
    if (disabled || sending.current) return
    setSaved(false); setChoice(value); sending.current = true
    const accepted = await store.edit(namespace.ns, field.path, value)
    sending.current = false
    setSaved(accepted)
    if (!accepted) setChoice(field.value)
  }
  async function reset() {
    cancelTimer(); dirty.current = false; setValidation(null); setSaved(false)
    const accepted = await store.edit(namespace.ns, field.path)
    setSaved(accepted)
  }
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = `${helpId}${error ? ` ${errorId}` : ''}`
  const readonly = field.kind === 'readonly' || field.kind === 'masked'
  return <div className="settings-field">
    {field.kind === 'switch' ? <div className="settings-switch-row">
      <span id={`${id}-label`}>{field.label}</span>
      <M3eSwitch aria-label={field.label} aria-describedby={describedBy} disabled={disabled}
        checked={choice === true} onChange={event => { void changeChoice((event.currentTarget as M3eSwitchElement).checked) }} />
    </div> : field.kind === 'select' ? <M3eFormField variant="outlined" error={Boolean(error)}>
      <label slot="label" htmlFor={id}>{field.label}</label>
      <M3eSelect id={id} aria-label={field.label} aria-describedby={describedBy} disabled={disabled}
        value={String(field.options?.findIndex(option => Object.is(option.value, choice)) ?? -1)}
        onChange={event => {
          const index = Number((event.currentTarget as M3eSelectElement).value)
          const option = field.options?.[index]
          if (option) void changeChoice(option.value)
        }}>
        {!field.options?.some(option => Object.is(option.value, choice)) && <M3eOption value="-1" disabled>現在の値は選択肢にありません</M3eOption>}
        {field.options?.map((option, index) => <M3eOption key={index} value={String(index)}>{option.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField> : readonly ? <>
      <h3>{field.label}</h3>
      <pre className="settings-value">{field.kind === 'masked' ? '値は表示しません' : formatSetting(field.value)}</pre>
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
    {!readonly && field.overridden && <M3eButton variant="text" className="settings-reset" disabled={disabled}
      onClick={() => { void reset() }} aria-label={`${field.label}を既定値に戻す`}>既定値に戻す</M3eButton>}
    {saved && !error && <div className="settings-saving" role="status">保存しました</div>}
  </div>
}
