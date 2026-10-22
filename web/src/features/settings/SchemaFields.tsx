import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eSwitch, type M3eSwitchElement } from '@m3e/react/switch'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eOption } from '@m3e/react/option'
import { M3eFormField } from '@m3e/react/form-field'
import { showSnackbar } from '../../app/overlay/index.ts'
import { currentLocale, messagesOf, useMessages } from '../../i18n/index.ts'
import { formatSetting, selectFieldState, type SettingField, type SettingValue, type SettingsNamespace } from './schema.ts'
import { fieldKey, type SettingsState, type SettingsStore } from './store.ts'
import { settingFieldAccess } from './field-access.ts'
import type { FieldDisplay } from './general.ts'
import { settingsFieldMessages, settingsSchemaMessages } from './messages.ts'

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
    : field.omitted ? <OmittedField key={`${field.path.join('/')}:${index}`} field={field} />
    : <FieldEditor key={`${field.path.join('/')}:${index}`} field={field} {...props} />)}</>
}

/** A definition or value beyond a limit: no value, no editing, only the way to the stock page. */
function OmittedField({ field }: { field: SettingField }) {
  return <div className="settings-field settings-omitted">
    <h3>{field.label}</h3>
    <p className="settings-field-help" role="note">{field.description}</p>
  </div>
}

function GroupReset({ field, namespace, state, store }: Omit<FieldsProps, 'fields'> & { field: SettingField }) {
  const text = useMessages(settingsFieldMessages)
  const saving = store.isResetting(namespace.ns, field.path)
  const access = settingFieldAccess(namespace, field)
  const error = state.fieldErrors[fieldKey(namespace.ns, field.path)]
  if (!field.overridden || !field.path.length) return null
  async function reset() {
    if (store.isResetting(namespace.ns, field.path)) return
    await store.edit(namespace.ns, field.path)
  }
  return <div>
    <M3eButton variant="text" className="settings-reset" disabled={!state.writable || !access.reset || saving || store.isResetting(namespace.ns, field.path)}
      onClick={() => { void reset() }} aria-label={text.resetAria(field.label)}>{text.resetToDefault}</M3eButton>
    {access.resetBlocked && <p className="settings-field-help">{text.resetBlocked}</p>}
    {saving && <div className="settings-saving" role="status">{text.saving}</div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </div>
}

export function FieldEditor({ field: stored, display, namespace, state, store }: Omit<FieldsProps, 'fields'> & { field: SettingField; display?: FieldDisplay }) {
  const id = useId()
  const text = useMessages(settingsFieldMessages)
  const schemaText = useMessages(settingsSchemaMessages)
  const field: SettingField = display
    ? { ...stored, kind: display.kind, label: display.label, description: display.description, ...(display.choices ? { options: display.choices.map(choice => ({ ...choice })) } : {}) }
    : stored
  const disabled = !state.writable || field.disabled || store.isResetting(namespace.ns, field.path)
  const [input] = useState(() => store.input(namespace.ns, field.path))
  const editing = useSyncExternalStore(input.subscribe, input.getSnapshot, input.getSnapshot)
  const draft = String(editing.value ?? '')
  const choice = display?.effective ? display.effective(editing.value) : editing.value
  const selection = selectFieldState(field, choice, schemaText)
  // m3e-select applies each `value` asynchronously, and two applications close together (a language change
  // that also changes the stored language re-renders twice) can leave no option selected. Once they have
  // settled, compare the options actually selected with the wanted one and set it again if they differ.
  const selectRef = useRef<M3eSelectElement>(null)
  const optionLabels = field.options?.map(option => option.label).join('\u0000')
  useEffect(() => {
    const timer = setTimeout(() => {
      const select = selectRef.current
      const wanted = String(selection.index)
      if (select && select.selected.map(option => option.value).join(',') !== wanted) select.value = wanted
    }, 0)
    return () => clearTimeout(timer)
  }, [optionLabels, selection.index])
  const error = state.fieldErrors[fieldKey(namespace.ns, field.path)]
  const timing = display ? '' : text.appliedImmediately
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(leaveTimer.current)
    leaveTimer.current = undefined
    return () => {
      // StrictMode replays this cleanup right after mounting; defer the leave so
      // the next setup cancels it, while a real unmount still saves the input.
      leaveTimer.current = setTimeout(() => {
        void input.leave().then(() => {
          const left = input.getSnapshot()
          if (left.dirty || store.getSnapshot().fieldErrors[fieldKey(namespace.ns, field.path)]) {
            showSnackbar(messagesOf(settingsFieldMessages, currentLocale()).saveFailed(field.label))
          }
        })
      }, 0)
    }
  }, [input])
  function flush() { return input.flush() }
  function changeText(value: string) { input.changeDeferred(value) }
  function changeChoice(value: SettingValue) {
    if (disabled) return
    // A dedicated row's `null` choice means "no stored value".
    if (display && value === null) return input.reset()
    input.change(value)
    return input.flush()
  }
  function reset() { return input.reset() }
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
      <M3eSelect ref={selectRef} id={id} aria-label={field.label} aria-describedby={describedBy} disabled={disabled}
        value={String(selection.index)}
        onChange={event => {
          const index = Number((event.currentTarget as M3eSelectElement).value)
          const option = field.options?.[index]
          if (option) void changeChoice(option.value)
        }}>
        {selection.placeholder && <M3eOption value="-1" disabled>{selection.placeholder}</M3eOption>}
        {/* m3e-select copies its options when their child list changes, not when a text changes. A keyed span
            makes a new label (after a language change) replace a node, so the copy is made again. */}
        {field.options?.map((option, index) => <M3eOption key={index} value={String(index)}><span key={option.label}>{option.label}</span></M3eOption>)}
      </M3eSelect>
    </M3eFormField> : readonly ? <>
      <h3>{field.label}</h3>
      <pre className="settings-value">{field.kind === 'masked' ? field.registered ? text.registered : text.notRegistered : formatSetting(field.value, schemaText)}</pre>
      <p className="settings-field-help">{text.editOnCurrentScreen}</p>
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
    {editing.notice && <div className="settings-notice" role="status">
      <p>{editing.notice}</p>
      <p>{text.savedValue(formatSetting(field.value, schemaText))}</p>
      <M3eButton disabled={disabled || editing.saving} onClick={() => { void input.retry() }}>{text.saveAgain}</M3eButton>
    </div>}
    {!display && field.kind !== 'masked' && field.overridden && field.path.length > 0 && <M3eButton variant="text" className="settings-reset" disabled={!state.writable || !access.reset || editing.saving || store.isResetting(namespace.ns, field.path)}
      onClick={() => { void reset() }} aria-label={text.resetAria(field.label)}>{text.resetToDefault}</M3eButton>}
    {access.resetBlocked && <p className="settings-field-help">{text.resetBlocked}</p>}
    {editing.saving && <div className="settings-saving" role="status">{text.saving}</div>}
    {editing.saved && !editing.saving && !error && <div className="settings-saving" role="status">{text.saved}</div>}
  </div>
}
