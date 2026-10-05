import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, openFullSheet, openSheet, showSnackbar } from '../../app/overlay/index.ts'
import { CustomProviderSheet } from './CustomProviderSheet.tsx'
import { createCustomProviderStore, type CustomProviderStore } from './custom-provider-store.ts'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { createKeyDraft, createProviderStore, PROVIDER_EVENTS, type ProviderRemote, type ProviderRow, type ProviderStore } from './providers.ts'

const statusLabels = {
  registered: 'API キー：登録済み', missing: 'API キー：未登録',
  unnecessary: 'キーは不要', unknown: '登録状況を確認できません',
}

function KeyEntry({ row, store, close }: { row: ProviderRow; store: ProviderStore; close(): void }) {
  const id = useId()
  const draft = useMemo(() => createKeyDraft(value => store.save(row, value)), [row, store])
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
  const providers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const current = providers.rows.find(item => item.id === row.id)
  const canWrite = current?.writable === true && current.ref === row.ref && !providers.busy
  useEffect(() => { draft.activate(); return () => draft.dispose() }, [draft])
  async function save() {
    if (canWrite && await draft.submit()) { close(); showSnackbar('API キーを保存しました') }
  }
  return <div className="settings-sheet">
    <h2>API キー</h2>
    <p className="muted">保存すると、あとから表示できません</p>
    <M3eFormField variant="outlined" error={Boolean(state.error)} className="settings-key-input">
      <label slot="label" htmlFor={id}>API キー</label>
      <input id={id} type={state.visible ? 'text' : 'password'} value={state.draft}
        autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={state.busy || !canWrite}
        aria-describedby={`${id}-error`} onChange={event => draft.input(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} />
      <M3eIconButton slot="suffix" aria-label={state.visible ? '入力したキーを隠す' : '入力したキーを表示する'}
        aria-pressed={state.visible} disabled={state.busy || !canWrite} onClick={draft.toggle}>
        <Icon name={state.visible ? 'visibility_off' : 'visibility'} />
      </M3eIconButton>
    </M3eFormField>
    {state.error && <p role="alert" className="settings-error" id={`${id}-error`}>{state.error}</p>}
    {state.busy && <p role="status" className="settings-saving">保存しています…</p>}
    <div className="settings-key-actions">
      <M3eButton variant="outlined" disabled={state.busy || !canWrite || current?.status !== 'registered'} onClick={() => {
        // Keep the sheet entry in the stack. The host disposes this draft while
        // confirming and mounts an empty input sheet again after cancellation.
        openDialog(dismiss => <RemoveKey row={row} store={store} close={dismiss} removed={close} />, { label: 'API キーの登録を消す確認' })
      }}>登録を消す</M3eButton>
      <M3eButton variant="filled" disabled={state.busy || !canWrite || !state.draft.trim()} onClick={() => { void save() }}>保存</M3eButton>
    </div>
  </div>
}

function RemoveKey({ row, store, close, removed }: { row: ProviderRow; store: ProviderStore; close(): void; removed(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const providers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const current = providers.rows.find(item => item.id === row.id)
  const canWrite = current?.writable === true && current.ref === row.ref
  async function remove() {
    if (busy || !canWrite) return
    setBusy(true); setError(null)
    const outcome = await store.remove(row)
    if (outcome.ok) { close(); removed(); showSnackbar('API キーの登録を消しました') }
    else { setError(outcome.message); setBusy(false) }
  }
  return <>
    <h2>API キーの登録を消す</h2>
    <p>{row.name} のキーの登録を消します。同じキーを使うほかの提供元にも影響する場合があります。</p>
    {error && <p role="alert" className="settings-error">{error}</p>}
    <div className="actions settings-actions">
      <M3eButton variant="text" disabled={busy} onClick={close}>キャンセル</M3eButton>
      <M3eButton disabled={busy || !canWrite} onClick={() => { void remove() }}>{busy ? '登録を消しています…' : '登録を消す'}</M3eButton>
    </div>
  </>
}

export function ProvidersPanel() {
  const { remote, connection } = useDsh()
  const store = useMemo(() => createProviderStore(remote as unknown as ProviderRemote), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const editors = useRef(new Set<CustomProviderStore>())
  const [editorBusy, setEditorBusy] = useState(false)
  const editorSequence = useRef(0)
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
      { label: id ? 'カスタムプロバイダーを編集' : 'カスタムプロバイダーを追加', interactionKey: overlayKey })
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
    <h2 id="settings-providers">提供元と登録状況</h2>
    <M3eButton variant="outlined" disabled={state.phase !== 'ready' || state.settingsWritable !== true || !state.customAvailable || editorBusy}
      onClick={() => editCustom()}>カスタムプロバイダーを追加</M3eButton>
    {state.phase === 'ready' && state.settingsWritable === false && <p>この DSH では設定を変更できません</p>}
    {state.phase === 'ready' && !state.customAvailable && <p>この DSH ではカスタムプロバイダーを設定できません。</p>}
    {state.phase === 'loading' && <p role="status">登録状況を読み込んでいます…</p>}
    {state.error && <div className="settings-notice"><p role="alert">{state.error}</p><M3eButton onClick={() => { void store.load() }}>再読み込み</M3eButton></div>}
    {state.phase === 'ready' && state.rows.length === 0 && <p>提供元が登録されていません。</p>}
    <M3eActionList className="settings-card">
      {state.rows.map(row => row.custom ? <div className="custom-provider-row" role="group" aria-label={row.name} key={row.id}>
        <div><strong>{row.name}</strong><span>{row.id}</span><span>{statusLabels[row.status]}</span></div>
        <div className="custom-row-actions"><M3eButton variant="text" disabled={state.phase !== 'ready' || !state.settingsWritable || editorBusy} onClick={() => editCustom(row.id)}>編集</M3eButton>
          <M3eButton variant="text" disabled={!row.writable || state.busy || editorBusy} onClick={() => openSheet(close => <KeyEntry row={row} store={store} close={close} />, { label: `${row.name} の API キー` })}>API キー</M3eButton></div>
      </div> : <M3eListAction key={row.id} disabled={!row.writable || state.busy}
        onClick={() => { if (row.writable && !state.busy) openSheet(close => <KeyEntry row={row} store={store} close={close} />, { label: `${row.name} の API キー` }) }}>
        <span slot="leading"><Icon name={row.status === 'unnecessary' ? 'dns' : 'key'} /></span>{row.name}
        <span slot="supporting-text">{statusLabels[row.status]}{row.ref && !row.writable && row.status !== 'unknown' ? '（変更できません）' : ''}</span>
        {row.writable && <span slot="trailing"><Icon name="chevron_right" /></span>}
      </M3eListAction>)}
    </M3eActionList>
  </section>
}
