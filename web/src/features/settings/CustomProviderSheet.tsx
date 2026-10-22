import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eFormField } from '@m3e/react/form-field'
import { Icon } from '../../app/icons/Icon.tsx'
import { showSnackbar, useOverlays } from '../../app/overlay/index.ts'
import { customFieldWritable, customOperations, modelDraft, providerRef, type ModelInputs } from './custom-provider.ts'
import type { CustomProviderStore } from './custom-provider-store.ts'
import { providerStatusText, type ProviderStore } from './providers.ts'
import { validKeyReference, invalidKeyReferenceMessage } from './provider-key-refs.ts'
import { useMessages } from '../../i18n/index.ts'
import { customProviderMessages, providerMessages } from './messages.ts'

function Field({ label, value, onChange, disabled, error, type = 'text', inputMode, fieldKey }: {
  label: string; value: string; onChange(value: string): void; disabled: boolean; error?: string; type?: string; inputMode?: 'numeric' | 'url'; fieldKey?: string
}) {
  const id = useId()
  return <div className="custom-field"><M3eFormField variant="outlined" error={Boolean(error)}>
    <label slot="label" htmlFor={id}>{label}</label>
    <input id={id} value={value} type={type} disabled={disabled} inputMode={inputMode} data-custom-field={fieldKey}
      autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => onChange(event.currentTarget.value)} />
  </M3eFormField>{error && <p id={`${id}-error`} className="settings-error" role="alert">{error}</p>}</div>
}

/**
 * The key stays in the input's value property only (as in the list's key
 * sheet, Issue #27): a controlled React input would also copy it into the
 * `value` attribute, that is into the page's markup. The store's draft is
 * written back to the property whenever it differs, so every clear by the
 * store (send start, cancel, disconnect, reload) empties the field.
 */
function KeyField({ draft, visible, disabled, error, present, store, label }: {
  draft: string; visible: boolean; disabled: boolean; error?: string; present: boolean; label: string
  store: { input(value: string): void; getSnapshot(): { draft: string } }
}) {
  const id = useId()
  const field = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const element = field.current
    if (element && element.value !== draft) element.value = draft
  }, [draft])
  // Closing disposes the store without publishing; empty the field as well.
  useLayoutEffect(() => { if (!present && field.current) field.current.value = '' }, [present])
  useLayoutEffect(() => {
    const element = field.current
    return () => { if (element) element.value = '' }
  }, [])
  return <div className="custom-field"><M3eFormField variant="outlined" error={Boolean(error)}>
    <label slot="label" htmlFor={id}>{label}</label>
    <input ref={field} id={id} type={visible ? 'text' : 'password'} disabled={disabled} data-custom-field="key"
      autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => {
        const element = event.currentTarget
        store.input(element.value)
        // The store ignores input while it is busy or closed; keep the field equal to it.
        const stored = store.getSnapshot().draft
        if (element.value !== stored) element.value = stored
      }} />
  </M3eFormField>{error && <p id={`${id}-error`} className="settings-error" role="alert">{error}</p>}</div>
}

export function CustomProviderSheet({ controller, keys, close, overlayKey, released }: {
  controller: CustomProviderStore; keys: ProviderStore; close(): void; overlayKey: string; released(): void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const key = useSyncExternalStore(controller.input.subscribe, controller.input.getSnapshot, controller.input.getSnapshot)
  const providers = useSyncExternalStore(keys.subscribe, keys.getSnapshot, keys.getSnapshot)
  const text = useMessages(customProviderMessages)
  const providerText = useMessages(providerMessages)
  const root = useRef<HTMLFormElement>(null)
  const entries = useOverlays()
  const present = entries.some(entry => entry.interactionKey === overlayKey)
  useEffect(() => {
    controller.activate(); void controller.load()
    const sheet = root.current?.closest('m3e-bottom-sheet')
    let frame = 0
    const focusHeading = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!controller.isActive() || !sheet?.matches(':popover-open')) return
        const active = document.activeElement
        if (active && root.current?.contains(active)) return
        root.current?.querySelector('h2')?.focus({ preventScroll: true })
      })
    }
    sheet?.addEventListener('opened', focusHeading)
    sheet?.addEventListener('toggle', focusHeading)
    focusHeading()
    return () => {
      cancelAnimationFrame(frame); sheet?.removeEventListener('opened', focusHeading); sheet?.removeEventListener('toggle', focusHeading)
      controller.dispose()
    }
  }, [controller])
  useLayoutEffect(() => { if (!present) { controller.dispose(); released() } }, [present, controller])
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach(field => {
      const details = field.closest('details')
      if (details) details.open = true
    })
  }, [state.errors])
  const saving = state.phase === 'savingSettings' || state.phase === 'savingKey'
  const disabled = state.phase !== 'editing'
  const draft = state.draft
  const provider = providers.rows.find(row => row.id === draft?.id)
  const keyRefInvalid = draft && !validKeyReference(provider?.ref ?? providerRef(draft.id))
  const fieldDisabled = (name: string) => disabled || Boolean(state.editing && state.namespace && !customFieldWritable(state.namespace, draft?.id ?? '', name))
  const leave = () => { controller.dispose(); close() }
  async function submit() {
    if (await controller.submit()) {
      const message = controller.getSnapshot().message ?? text.saved
      leave(); showSnackbar(message)
    } else requestAnimationFrame(() => {
      const field = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      field?.focus(); field?.scrollIntoView({ block: 'center' })
    })
  }
  const changed = !state.editing || Boolean(state.namespace && state.initial && draft && customOperations(state.namespace, state.initial, draft, true).length)
  const changeModel = (row: string, patch: Partial<ModelInputs>) => controller.change(current => ({ ...current, models: current.models.map(model => model.row === row ? { ...model, ...patch } : model) }))
  return <form ref={root} className="custom-provider-form" onSubmit={event => event.preventDefault()}
    onBlur={event => {
      // Inserting an error during pointer-down can move the action before click.
      if ((event.relatedTarget as Element | null)?.closest('m3e-button, m3e-icon-button')) return
      const field = (event.target as HTMLElement).dataset.customField
      if (field && state.phase === 'editing') controller.validate(field)
    }}>
    <header className="custom-provider-header"><h2 ref={heading => { heading?.setAttribute('autofocus', '') }} tabIndex={-1}>{state.editing ? text.titleEdit : text.titleAdd}</h2>
      <M3eIconButton aria-label={text.close} onClick={leave}><Icon name="close" /></M3eIconButton></header>
    {state.phase === 'loading' && <p role="status">{text.loading}</p>}
    {state.message && <div className="settings-notice"><p role="alert">{state.message}</p>
      {['blocked', 'stale', 'unknown'].includes(state.phase) && <>
        <p>{text.discardOnReload}</p><M3eButton onClick={() => { void controller.load() }}>{state.phase === 'unknown' ? text.checkResult : text.reload}</M3eButton>
      </>}
    </div>}
    {draft && <>
      <p className="muted">{text.unsavedHint}</p>
      <Field label={text.idLabel} fieldKey="id" value={draft.id} disabled={disabled || state.editing} error={state.errors.id}
        onChange={id => controller.change(current => ({ ...current, id }))} />
      <p className="settings-field-help">{text.idHelp}</p>
      <Field label={text.displayNameLabel} value={draft.displayName} disabled={fieldDisabled('displayName')} error={state.errors.displayName}
        onChange={displayName => controller.change(current => ({ ...current, displayName }))} />
      <Field label={text.baseURLLabel} fieldKey="baseURL" value={draft.baseURL} disabled={fieldDisabled('baseURL')} error={state.errors.baseURL} inputMode="url"
        onChange={baseURL => controller.change(current => ({ ...current, baseURL }))} />
      <p className="settings-field-help">{text.baseURLHelp}</p>
      <div className="custom-field"><label>{text.apiLabel}<select aria-label={text.apiLabel} value={draft.api} disabled={fieldDisabled('api')} aria-invalid={Boolean(state.errors.api)}
        onChange={event => controller.change(current => ({ ...current, api: event.target.value }))}>
        {!state.protocols.includes(draft.api) && <option value={draft.api}>{text.apiMissing}</option>}
        {state.protocols.map(api => <option key={api} value={api}>{text.protocol(api)}</option>)}
      </select></label>{state.errors.api && <p role="alert" className="settings-error">{state.errors.api}</p>}</div>
      <section aria-label={text.modelsLabel} className="custom-models" tabIndex={-1} aria-invalid={Boolean(state.errors.models)}><h3>{text.modelsLabel}</h3>
        {fieldDisabled('models') && state.phase === 'editing' && <p>{text.modelsProtected}</p>}
        {draft.models.map((model, index) => <fieldset key={model.row} className="custom-model-row" disabled={fieldDisabled('models')}>
          <legend>{text.modelNumber(String(index + 1))}</legend>
          <Field label={text.modelIDLabel} fieldKey={`${model.row}.id`} value={model.id} disabled={fieldDisabled('models')} error={state.errors[`${model.row}.id`]} onChange={id => changeModel(model.row, { id })} />
          <Field label={text.modelNameLabel} value={model.name} disabled={fieldDisabled('models')} onChange={name => changeModel(model.row, { name })} />
          <details><summary>{text.details}</summary>
            <Field label={text.contextWindowLabel} fieldKey={`${model.row}.contextWindow`} value={model.contextWindow} disabled={fieldDisabled('models')} inputMode="numeric" error={state.errors[`${model.row}.contextWindow`]} onChange={contextWindow => changeModel(model.row, { contextWindow })} />
            <Field label={text.maxTokensLabel} fieldKey={`${model.row}.maxTokens`} value={model.maxTokens} disabled={fieldDisabled('models')} inputMode="numeric" error={state.errors[`${model.row}.maxTokens`]} onChange={maxTokens => changeModel(model.row, { maxTokens })} />
            <p className="settings-field-help">{text.blankUsesDefault}</p>
            <div className="custom-modalities" tabIndex={-1} aria-invalid={Boolean(state.errors[`${model.row}.input`])}><p>{text.inputKinds}</p><label><input type="checkbox" checked={model.inheritedInput} onChange={e => changeModel(model.row, { inheritedInput: e.target.checked })} />{text.inheritInput}</label>
              {!model.inheritedInput && ['text', 'image'].map(value => <label key={value}><input type="checkbox" checked={model.input.includes(value)}
                onChange={e => changeModel(model.row, { input: e.target.checked ? [...model.input, value] : model.input.filter(v => v !== value) })} />{value === 'text' ? text.inputText : text.inputImage}</label>)}
              {state.errors[`${model.row}.input`] && <p role="alert" className="settings-error">{state.errors[`${model.row}.input`]}</p>}
            </div>
          </details>
          <M3eButton variant="text" disabled={fieldDisabled('models')} onClick={() => controller.change(current => ({ ...current, models: current.models.filter(item => item.row !== model.row) }))}>{text.removeModel}</M3eButton>
        </fieldset>)}
        {state.errors.models && <p role="alert" className="settings-error">{state.errors.models}</p>}
        <M3eButton variant="outlined" disabled={fieldDisabled('models')} onClick={() => controller.change(current => ({ ...current, models: [...current.models, modelDraft()] }))}>{text.addModel}</M3eButton>
      </section>
      <KeyField draft={key.draft} visible={key.visible} disabled={saving || !['editing', 'keyFailed'].includes(state.phase)} error={state.errors.key}
        present={present} store={controller.input} label={text.keyLabel} />
      <p>{providerStatusText(providers.rows.find(row => row.id === draft.id)?.status ?? 'unknown', false, providerText)}</p>
      {keyRefInvalid && !state.errors.key && <p className="settings-field-help">{invalidKeyReferenceMessage(providerText)} {text.keyEmptyHelp}</p>}
      {provider?.keyNoticeKey && <p className="settings-field-help">{providerText[provider.keyNoticeKey]}</p>}
      <M3eButton variant="text" disabled={saving} aria-pressed={key.visible} onClick={controller.input.toggle}>{key.visible ? text.keyToggleHide : text.keyToggleShow}</M3eButton>
      <p className="settings-field-help">{text.keySaveHelp}</p>
      {saving && <p role="status">{text.saving}</p>}
      <p className="settings-field-help">{text.revertHelp}</p>
    </>}
    <div className="custom-provider-actions"><M3eButton variant="outlined" onClick={leave}>{text.cancel}</M3eButton>
      <M3eButton variant="filled" disabled={!['editing', 'keyFailed'].includes(state.phase) || (!changed && !key.draft.trim())} onClick={() => { void submit() }}>{state.phase === 'keyFailed' ? text.saveKey : text.save}</M3eButton>
    </div>
  </form>
}
