import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, openFullSheet, openSheet, showSnackbar, useOverlays } from '../../app/overlay/index.ts'
import { getOverlays } from '../../app/overlay/store.ts'
import { CustomProviderSheet } from './CustomProviderSheet.tsx'
import { createCustomProviderStore, type CustomProviderStore } from './custom-provider-store.ts'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { createProviderStore, PROVIDER_EVENTS, providerStatusText, type ProviderRemote, type ProviderRow, type ProviderStore, type ProviderStoreTexts } from './providers.ts'
import { useMessages } from '../../i18n/index.ts'
import { customProviderMessages, providerMessages } from './messages.ts'

function KeyEntry({ row, store, close, overlayKey }: { row: ProviderRow; store: ProviderStore; close(): void; overlayKey: string }) {
  const text = useMessages(providerMessages)
  const id = useId()
  const { connection } = useDsh()
  const input = useRef<HTMLInputElement>(null)
  const lifetime = useRef({ active: false, revision: 0, busy: false })
  // The key lives only in the uncontrolled input, never in React state or markup.
  const [state, setState] = useState({ hasInput: false, visible: false, busy: false, error: null as string | null })
  const present = useOverlays().some(entry => entry.interactionKey === overlayKey)
  const providers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const current = providers.rows.find(item => item.id === row.id)
  const canWrite = present && current?.writable === true && current.ref === row.ref && !providers.busy
  function clearInput() {
    if (input.current) { input.current.value = ''; input.current.type = 'password' }
  }
  function discard() {
    lifetime.current.revision++; lifetime.current.busy = false
    clearInput()
    setState({ hasInput: false, visible: false, busy: false, error: null })
  }
  useLayoutEffect(() => {
    lifetime.current.active = true
    const changed = () => { if (connection.state.getSnapshot() !== 'connected') discard() }
    const off = connection.state.subscribe(changed)
    // Invalidate at close start, including a temporarily covered sheet.
    const sheet = input.current?.closest('m3e-bottom-sheet')
    sheet?.addEventListener('closing', discard)
    changed()
    return () => {
      off(); sheet?.removeEventListener('closing', discard)
      lifetime.current.active = false; lifetime.current.revision++
      clearInput()
    }
  }, [connection])
  useLayoutEffect(() => { if (!present) discard() }, [present])
  async function save() {
    const revision = lifetime.current.revision
    const canSend = () => lifetime.current.active && lifetime.current.revision === revision
      && connection.state.getSnapshot() === 'connected'
      && getOverlays().some(entry => entry.interactionKey === overlayKey)
      && (input.current?.closest('m3e-bottom-sheet') as (HTMLElement & { open: boolean }) | null)?.open === true
    if (!canWrite || lifetime.current.busy || !canSend()) return
    let value = input.current?.value.trim() ?? ''
    if (!value) return
    lifetime.current.busy = true
    clearInput()
    setState({ hasInput: false, visible: false, busy: true, error: null })
    try {
      const pending = store.save(row, value, { canSend })
      value = ''
      const outcome = await pending
      if (!canSend()) return
      if (outcome.ok) { close(); showSnackbar(text.saved) }
      else setState({ hasInput: false, visible: false, busy: false, error: outcome.message })
    } catch {
      if (canSend()) setState({ hasInput: false, visible: false, busy: false, error: text.saveFailed })
    } finally {
      value = ''
      if (lifetime.current.revision === revision) lifetime.current.busy = false
    }
  }
  return <div className="settings-sheet">
    <h2>{text.keySheetTitle}</h2>
    <p className="muted">{text.keySheetHint}</p>
    <M3eFormField variant="outlined" error={Boolean(state.error)} className="settings-key-input">
      <label slot="label" htmlFor={id}>{text.keyLabel}</label>
      <input ref={input} id={id} type={state.visible ? 'text' : 'password'}
        autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={state.busy || !canWrite}
        aria-describedby={`${id}-error`} onChange={event => {
          const hasInput = Boolean(event.currentTarget.value.trim())
          setState(current => ({ ...current, hasInput, error: null }))
        }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} />
      <M3eIconButton slot="suffix" aria-label={state.visible ? text.keyHidden : text.keyShown}
        aria-pressed={state.visible} disabled={state.busy || !canWrite} onClick={() => setState(current => ({ ...current, visible: !current.visible }))}>
        <Icon name={state.visible ? 'visibility_off' : 'visibility'} />
      </M3eIconButton>
    </M3eFormField>
    {state.error && <p role="alert" className="settings-error" id={`${id}-error`}>{state.error}</p>}
    {state.busy && <p role="status" className="settings-saving">{text.saving}</p>}
    <div className="settings-key-actions">
      <M3eButton variant="outlined" disabled={state.busy || !canWrite || current?.status !== 'registered'} onClick={() => {
        // Covering the sheet clears its input before confirmation; cancelling
        // returns to an empty, masked field.
        openDialog(dismiss => <RemoveKey row={row} store={store} close={dismiss} removed={close} />, { label: text.removeLabel })
      }}>{text.removeButton}</M3eButton>
      <M3eButton variant="filled" disabled={state.busy || !canWrite || !state.hasInput} onClick={() => { void save() }}>{text.save}</M3eButton>
    </div>
  </div>
}

function RemoveKey({ row, store, close, removed }: { row: ProviderRow; store: ProviderStore; close(): void; removed(): void }) {
  const text = useMessages(providerMessages)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const current = providers.rows.find(item => item.id === row.id)
  const canWrite = current?.writable === true && current.ref === row.ref
  async function remove() {
    if (busy || !canWrite) return
    setBusy(true); setError(null)
    const outcome = await store.remove(row)
    if (outcome.ok) { close(); removed(); showSnackbar(text.removed) }
    else { setError(outcome.message); setBusy(false) }
  }
  return <>
    <h2>{text.removeTitle}</h2>
    <p>{text.removeConfirm(row.name)}</p>
    {error && <p role="alert" className="settings-error">{error}</p>}
    <div className="actions settings-actions">
      <M3eButton variant="text" disabled={busy} onClick={close}>{text.cancel}</M3eButton>
      <M3eButton disabled={busy || !canWrite} onClick={() => { void remove() }}>{busy ? text.removeBusy : text.removeButton}</M3eButton>
    </div>
  </>
}

export function ProvidersPanel() {
  const text: ProviderStoreTexts = useMessages(providerMessages)
  const customText = useMessages(customProviderMessages)
  const { remote, connection } = useDsh()
  const store = useMemo(() => createProviderStore(remote as unknown as ProviderRemote), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const editors = useRef(new Set<CustomProviderStore>())
  const [editorBusy, setEditorBusy] = useState(false)
  const editorSequence = useRef(0)
  const keySequence = useRef(0)
  function enterKey(row: ProviderRow) {
    const overlayKey = `provider-key-${++keySequence.current}`
    openSheet(close => <KeyEntry row={row} store={store} close={close} overlayKey={overlayKey} />,
      { label: text.sheetLabel(row.name), interactionKey: overlayKey })
  }
  function editCustom(id?: string) {
    if ([...editors.current].some(editor => editor.isSaving())) return
    const controller = createCustomProviderStore(remote as unknown as ProviderRemote, store, id, () => {
      if (!controller.isActive()) editors.current.delete(controller)
      setEditorBusy(false)
      void store.load()
    })
    editors.current.add(controller)
    const overlayKey = `custom-provider-${++editorSequence.current}`
    const release = () => { if (!controller.isSaving()) editors.current.delete(controller) }
    openFullSheet(close => <CustomProviderSheet controller={controller} keys={store} close={close} overlayKey={overlayKey} released={release} />,
      { label: id ? customText.titleEdit : customText.titleAdd, interactionKey: overlayKey })
    controller.subscribe(() => setEditorBusy(controller.isSaving()))
  }
  useEffect(() => {
    let active = true
    const read = () => { if (active) void store.load() }
    const changed = () => {
      const connected = connection.state.getSnapshot() === 'connected'
      store.connectionChanged(connected)
      editors.current.forEach(editor => editor.connectionChanged(connected))
    }
    const offConnection = connection.state.subscribe(changed)
    changed()
    const stops = PROVIDER_EVENTS.map(event => onRemoteEvent(remote, event, read))
    const offSettings = onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => editors.current.forEach(editor => editor.updated(ns, revision)))
    read()
    return () => { active = false; offConnection(); offSettings(); stops.forEach(stop => stop()); editors.current.forEach(editor => editor.dispose()); editors.current.clear(); store.connectionChanged(false) }
  }, [remote, connection, store])
  return <section className="settings-section" aria-labelledby="settings-providers">
    <h2 id="settings-providers">{text.heading}</h2>
    <M3eButton variant="outlined" disabled={state.phase !== 'ready' || state.settingsWritable !== true || !state.customAvailable || editorBusy}
      onClick={() => editCustom()}>{text.addCustom}</M3eButton>
    {state.phase === 'ready' && state.settingsWritable === false && <p>{text.notWritable}</p>}
    {state.phase === 'ready' && !state.customAvailable && <p>{text.customUnavailable}</p>}
    {state.phase === 'loading' && <p role="status">{text.loading}</p>}
    {state.error && <div className="settings-notice"><p role="alert">{state.error}</p><M3eButton onClick={() => { void store.load() }}>{text.reload}</M3eButton></div>}
    {state.phase === 'ready' && state.rows.length === 0 && <p>{text.none}</p>}
    <M3eActionList className="settings-card">
      {state.rows.map(row => row.custom ? <div className="custom-provider-row" role="group" aria-label={row.name} key={row.id}>
        <div><strong>{row.name}</strong><span>{row.id}</span><span>{providerStatusText(row.status, !row.ref || row.writable || row.status === 'unknown', text)}</span>{!row.ref && <span>{text.keyFromEdit}</span>}{row.keyNoticeKey && <span>{text[row.keyNoticeKey]}</span>}</div>
        <div className="custom-row-actions"><M3eButton variant="text" disabled={state.phase !== 'ready' || editorBusy} onClick={() => editCustom(row.id)}>{text.editCustom}</M3eButton>
          {row.ref && <M3eButton variant="text" disabled={!row.writable || state.busy || editorBusy} onClick={() => enterKey(row)}>{text.apiKeyButton}</M3eButton>}</div>
      </div> : <M3eListAction key={row.id} disabled={!row.writable || state.busy}
        onClick={() => { if (row.writable && !state.busy) enterKey(row) }}>
        <span slot="leading"><Icon name={row.status === 'unnecessary' ? 'dns' : 'key'} /></span>{row.name}
        <span slot="supporting-text">{providerStatusText(row.status, !row.ref || row.writable || row.status === 'unknown', text)}</span>
        {row.writable && <span slot="trailing"><Icon name="chevron_right" /></span>}
      </M3eListAction>)}
    </M3eActionList>
  </section>
}
