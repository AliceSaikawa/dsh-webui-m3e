import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eOption } from '@m3e/react/option'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eSwitch } from '@m3e/react/switch'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useSession } from '../../dsh/session.ts'
import { presetDescription, presetDisplayName } from '../../dsh/permission-presets.ts'
import { remoteErrorMessage, remoteFailureOf, RemoteCallError, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { InboxState, QueueAction } from '../../dsh/services.ts'
import { queueFromInbox } from '../../dsh/inbox.ts'
import { useMessages } from '../../i18n/index.ts'
import type { ModelCatalog, ModelSelection, ModelSelectionProjection, PermissionProjection, PermissionSelection } from './api.ts'
import type { ComposerTarget } from './Composer.tsx'
import { readDraft, subscribeDraft } from './drafts.ts'
import { reasoningEffortLabel, visibleQueue } from './helpers.ts'
import { composerMessages, composerText, type ComposerMessages } from './messages.ts'
import { effortValue, modelChoices, modelValue, reasoningForSelection, selectionFromModelValue, type ModelApplyController } from './model-picker.ts'
import { queueEditPrompt } from './queue-edit.ts'
import { permissionIcon } from './presentation.ts'
import { usePermissionCatalog } from './use-permission-catalog.ts'

/**
 * The visible text for a failure. A local error already carries its message in
 * the page language, so only a Host failure goes through the shared translator.
 */
export function errorText(error: unknown, fallback?: string, text: ComposerMessages = composerText()): string {
  if (error instanceof RemoteCallError || remoteFailureOf(error) !== undefined) return remoteErrorMessage(error, fallback)
  if (error instanceof Error && error.name === 'AbortError') return remoteErrorMessage(error, fallback)
  if (error instanceof Error) return error.message || fallback || text.errorFailed
  return fallback ?? text.errorFailed
}
export function SheetRow({ icon, trailingIcon, children, detail, selected, disabled, onClick }: {
  icon?: string; trailingIcon?: string; children: ReactNode; detail?: string; selected?: boolean; disabled?: boolean; onClick(): void
}) {
  const endIcon = selected ? 'check' : trailingIcon
  return <button type="button" className="composer-sheet-row" disabled={disabled} onClick={onClick} aria-pressed={selected}>
    {icon && <Icon name={icon} className="composer-sheet-icon" />}<span className="composer-sheet-copy">{children}{detail && <small>{detail}</small>}</span>{endIcon && <Icon name={endIcon} className="composer-sheet-icon" />}
  </button>
}

export interface ModelPickerProps {
  initialCatalog?: ModelCatalog
  target: ComposerTarget
  draftKey: string
  modelApply: ModelApplyController
  loadCatalog(force?: boolean): Promise<ModelCatalog>
  applyModel(selection: ModelSelection): Promise<ModelSelection>
}

export function PlusSheet({ close, plan, onImage, onReference, onCommand, onPlan, ...modelProps }: {
  close(): void; plan: boolean
  onImage(): void; onReference(): void; onCommand(): void; onPlan(active: boolean): Promise<void>
} & ModelPickerProps) {
  const { connected } = useConnection()
  const text = useMessages(composerMessages)
  const applyState = useSyncExternalStore(modelProps.modelApply.subscribe, modelProps.modelApply.getSnapshot, modelProps.modelApply.getSnapshot)
  const disabled = !connected || applyState.composerBusy || applyState.pending
  const [active, setActive] = useState(plan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choose = (action: () => void) => { close(); action() }
  async function toggle() {
    if (busy || disabled) return
    setBusy(true); setError('')
    try { await onPlan(!active); setActive(!active) } catch (error) { setError(errorText(error, undefined, text)) }
    finally { setBusy(false) }
  }
  return <div className="composer-sheet"><h2>{text.plusTitle}</h2>
    <SheetRow icon="image" onClick={() => choose(onImage)}>{text.attachImage}</SheetRow>
    <SheetRow icon="alternate_email" detail={text.referenceDetail} onClick={() => choose(onReference)}>{text.referenceFile}</SheetRow>
    <SheetRow icon="terminal" detail={text.commandDetail} onClick={() => choose(onCommand)}>{text.command}</SheetRow>
    <div className="composer-switch-row"><Icon name="checklist" className="composer-sheet-icon" /><span className="composer-sheet-copy">{text.planMode}</span><M3eSwitch aria-label={text.planMode} checked={active} disabled={disabled || busy} onChange={() => { void toggle() }} /></div>
    <ModelPicker {...modelProps} extraDisabled={busy} />
    {error && <p role="alert">{error}</p>}
  </div>
}

export function ModelPickerSheet(props: ModelPickerProps) {
  const text = useMessages(composerMessages)
  return <div className="composer-sheet"><h2>{text.modelSheetLabel}</h2><ModelPicker {...props} /></div>
}

function ModelPicker({ initialCatalog, target, draftKey, modelApply, loadCatalog, applyModel, extraDisabled = false }: ModelPickerProps & { extraDisabled?: boolean }) {
  const text = useMessages(composerMessages)
  const { connected } = useConnection()
  const sessionId = target.kind === 'session' ? target.sessionId : ''
  const { face, snapshot, projection } = useSession(sessionId)
  const modelSelection = projection<ModelSelectionProjection>('modelSelection')
  const subscribe = useCallback((listener: () => void) => subscribeDraft(draftKey, listener), [draftKey])
  const draftSnapshot = useCallback(() => readDraft(draftKey), [draftKey])
  const draft = useSyncExternalStore(subscribe, draftSnapshot, draftSnapshot)
  const applyState = useSyncExternalStore(modelApply.subscribe, modelApply.getSnapshot, modelApply.getSnapshot)
  const [catalog, setCatalog] = useState(initialCatalog)
  const observed = target.kind === 'new' ? draft.model ?? catalog?.default : modelSelection?.next ?? catalog?.default
  const [current, setCurrent] = useState<ModelSelection | undefined>(() => observed ?? applyState.selected)
  const [loading, setLoading] = useState(!initialCatalog)
  const [error, setError] = useState('')
  const busy = applyState.pending
  const disabled = extraDisabled || !connected || applyState.composerBusy || busy
    || (target.kind === 'session' && (!face || snapshot.removed || snapshot.openState !== 'open'))
  const modelSelect = useRef<M3eSelectElement>(null)
  const effortSelect = useRef<M3eSelectElement>(null)
  const modelId = useId()
  const effortId = useId()
  const choices = catalog ? modelChoices(catalog) : []
  const reasoning = reasoningForSelection(current, choices)
  const selectedEffort = effortValue(current, choices)
  const observedKey = observed ? `${modelValue(observed)}:${observed.reasoningEffort ?? ''}` : ''
  useEffect(() => {
    if (initialCatalog) return
    let active = true
    void loadCatalog().then(value => { if (active) { setCatalog(value); setCurrent(previous => previous ?? value.default); setLoading(false) } })
      .catch(cause => { if (active) { setError(errorText(cause, text.modelListFailed, text)); setLoading(false) } })
    return () => { active = false }
  }, [initialCatalog, loadCatalog])
  useEffect(() => {
    if (!connected || catalog || loading) return
    let active = true
    setLoading(true); setError('')
    void loadCatalog(true).then(value => { if (active) { setCatalog(value); setLoading(false) } })
      .catch(cause => { if (active) { setError(errorText(cause, text.modelListFailed, text)); setLoading(false) } })
    return () => { active = false }
  }, [connected])
  useEffect(() => { if (!busy) setCurrent(observed ?? applyState.selected) }, [observedKey])
  // The shared controller outlives this view; only a result that arrives while
  // mounted may replace the observed draft or session model.
  const seenSelection = useRef(applyState.selected)
  useEffect(() => {
    if (applyState.selected === seenSelection.current) return
    seenSelection.current = applyState.selected
    if (applyState.selected) setCurrent(applyState.selected)
  }, [applyState.selected])
  useEffect(() => { if (!busy && applyState.error) setCurrent(observed) }, [busy, applyState.error])
  useEffect(() => {
    if (!selectedEffort) return
    const frame = requestAnimationFrame(() => {
      if (effortSelect.current) effortSelect.current.value = selectedEffort
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedEffort])
  async function retry() {
    setLoading(true); setError('')
    try { const value = await loadCatalog(true); setCatalog(value); setCurrent(previous => previous ?? value.default) }
    catch (cause) { setError(errorText(cause, text.modelListFailed, text)) }
    finally { setLoading(false) }
  }
  async function choose(selection: ModelSelection) {
    if (disabled || loading) return
    try { setCurrent(await applyModel(selection)) }
    catch {
      if (modelSelect.current) modelSelect.current.value = modelValue(current)
      if (effortSelect.current) effortSelect.current.value = selectedEffort
    }
  }
  return <div className="composer-model-picker">
    <M3eFormField variant="outlined">
      <label slot="label" htmlFor={modelId}>{text.modelLabel}</label>
      <M3eSelect ref={modelSelect} id={modelId} aria-label={text.modelLabel} value={modelValue(current)} disabled={disabled || busy || loading || choices.length === 0}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          const selection = typeof value === 'string' ? selectionFromModelValue(value, choices) : undefined
          if (selection) void choose(selection)
        }}>
        {loading && <M3eOption value="" disabled>{text.loading}</M3eOption>}
        {!loading && choices.length === 0 && <M3eOption value="" disabled>{text.noModels}</M3eOption>}
        {choices.map(choice => <M3eOption key={choice.value} value={choice.value}>{choice.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField>
    {loading && <p role="status">{text.modelListLoading}</p>}
    {catalog && catalog.failures.length > 0 && <div role="status">
      <p>{text.someModelListsFailed}</p>
      {catalog.failures.map(failure => <p key={failure.id}>{text.modelFailureLine(failure.name, errorText(new Error(failure.message), text.modelListFailed, text))}</p>)}
    </div>}
    {reasoning && <M3eFormField variant="outlined">
      <label slot="label" htmlFor={effortId}>{text.reasoningDepth}</label>
      <M3eSelect ref={effortSelect} id={effortId} aria-label={text.reasoningDepth} value={selectedEffort} disabled={disabled || busy || loading}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          if (current && typeof value === 'string' && reasoning.efforts.some(effort => effort.id === value)) void choose({ ...current, reasoningEffort: value })
        }}>
        {!selectedEffort && <><span slot="value">{text.defaultEffort}</span><M3eOption value="" disabled>{text.defaultEffort}</M3eOption></>}
        {reasoning.efforts.map((effort, index) => <M3eOption key={effort.id} value={effort.id}>{reasoningEffortLabel(effort.id, index)}</M3eOption>)}
      </M3eSelect>
    </M3eFormField>}
    {busy && <p role="status">{text.applying}</p>}
    {(error || applyState.error !== undefined) && <p role="alert">{error || errorText(applyState.error, text.modelSwitchFailed, text)}</p>}
    {!loading && (!catalog || catalog.failures.length > 0) && <M3eButton disabled={disabled} onClick={() => { void retry() }}>{text.reload}</M3eButton>}
  </div>
}

export function PermissionSheet({ permissions, defaults = false, sessionId = '', apply, close }: {
  permissions: PermissionProjection; defaults?: boolean; sessionId?: string; apply(value: string): Promise<void>; close(): void
}) {
  const catalogState = usePermissionCatalog()
  const text = useMessages(composerMessages)
  const { catalog } = catalogState
  const { projection } = useSession(sessionId)
  // Another client can change the preset while this sheet stays open, so compare
  // against the live projection rather than the value captured when it opened.
  const liveValue = defaults ? undefined : projection<PermissionSelection>('permissions')?.currentValue
  const currentValue = liveValue ?? permissions.currentValue
  // The caller already loaded these rows. Keep the pre-migration sheet while
  // refreshing; an actual failed read invalidates them and uses the alert.
  const options = catalogState.status === 'error' ? []
    : (defaults ? catalog?.defaultOptions : catalog?.options) ?? permissions.options
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function choose(value: string) {
    if (busy || !options.some(option => option.value === value)) return
    // The stock UI does nothing when the current preset is picked again.
    if (value === currentValue) { close(); return }
    setBusy(true); setError('')
    try { await apply(value); close() } catch (error) { setError(errorText(error, undefined, text)); setBusy(false) }
  }
  return <div className="composer-sheet"><h2>{text.permissionPickTitle}</h2>
    {options.filter(option => option.value !== 'custom').map(option => <SheetRow key={option.value} icon={permissionIcon(option.value)} selected={option.value === currentValue} detail={presetDescription(option.value, option.description)} disabled={busy} onClick={() => { void choose(option.value) }}>{presetDisplayName(option.value, option.name)}</SheetRow>)}
    {(error || catalogState.status === 'error') && <p role="alert">{error || (catalogState.status === 'error' ? errorText(catalogState.error, undefined, text) : '')}</p>}
  </div>
}

export function QueueSheet({ sessionId, close }: { sessionId: string; close(): void }) {
  const text = useMessages(composerMessages)
  const { face, snapshot, projection } = useSession(sessionId)
  const items = visibleQueue(queueFromInbox(projection<InboxState>('inbox')))
  const [selectedId, setSelectedId] = useState<string | undefined>(items.length === 1 ? items[0]?.id : undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = items.find(item => item.id === selectedId)
  async function act(action: QueueAction) {
    if (!face || !selected || busy) return
    setBusy(true); setError('')
    try { unwrapRemoteResult(await face.updateQueue(selected.id, action)); close() }
    catch (error) { setError(errorText(error, undefined, text)); setBusy(false) }
  }
  return <div className="composer-sheet"><h2>{text.queueSheetLabel}</h2>
    {!items.length && <p>{text.queueEmpty}</p>}
    {!selected ? items.map(item => <SheetRow key={item.id} detail={item.placement === 'steering' ? text.queueStateSteering : text.queueStateQueued} onClick={() => setSelectedId(item.id)}>{item.preview || item.text || text.queueImageOnly}</SheetRow>) : <>
      <p className="composer-queue-preview">{selected.preview || selected.text || text.queueImageOnly}</p>
      <SheetRow icon="edit" disabled={busy || !face} onClick={() => { if (!face) return; close(); openDialog(done => <TextPromptDialog {...queueEditPrompt(face, selected, done, text)} />, { label: text.queueEditTitle }) }}>{text.editAction}</SheetRow>
      <SheetRow icon="bolt" disabled={busy || !face || selected.placement !== 'queued' || !snapshot.running} onClick={() => { void act({ kind: 'steer' }) }}>{text.steerNow}</SheetRow>
      <SheetRow icon="delete" disabled={busy || !face} onClick={() => { void act({ kind: 'remove' }) }}>{text.removeAction}</SheetRow>
      {items.length > 1 && <M3eButton onClick={() => setSelectedId(undefined)}>{text.backToList}</M3eButton>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}
