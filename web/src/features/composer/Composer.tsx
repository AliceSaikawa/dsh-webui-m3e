import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eAssistChip } from '@m3e/react/chips'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eSplitButton } from '@m3e/react/split-button'
import { M3eTextareaAutosize, type M3eTextareaAutosizeElement } from '@m3e/react/textarea-autosize'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh, type InboxState } from '../../dsh/services.ts'
import { queueFromInbox } from '../../dsh/inbox.ts'
import { useSession } from '../../dsh/session.ts'
import { sessionAccess } from '../../dsh/session-access.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { usePermissionCatalog } from './use-permission-catalog.ts'
import type { PermissionSelection } from './api.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { composerApi, requireMatched, type CommandDescriptor, type FileReference, type ModelCatalog, type ModelSelection, type PermissionProjection, type PlanProjection } from './api.ts'
import { prepareDraftImages, readDraft, subscribeDraft, writeDraft, type Draft } from './drafts.ts'
import { filterCommands, findReferenceToken, isKnownCommand, isReferencePathSafe, replaceReference, visibleQueue } from './helpers.ts'
import { prepareImage } from './images.ts'
import { errorText, ModelPickerSheet, PermissionSheet, PlusSheet, QueueSheet, SheetRow } from './Sheets.tsx'
import { deliverDraft, pendingDelivery, type DeliveryResult } from './delivery.ts'
import { registerDeliveryDestination, handoffDeliveryDestination } from './delivery-destination.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'
import { pendingWorkspaceAttachment, retryWorkspaceAttachment, type WorkspaceRecoveryResult } from './workspace-recovery.ts'
import { commandIcon } from './presentation.ts'
import { createModelApplyController } from './model-picker.ts'
import { PROVIDER_EVENTS } from '../settings/providers.ts'
import './composer.css'

export type ComposerTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export function Composer({ target }: { target: ComposerTarget }) {
  const key = target.kind === 'session' ? `session:${target.sessionId}` : `new:${target.workspaceId}`
  return <ComposerInput key={key} target={target} draftKey={key} />
}

function ComposerInput({ target, draftKey }: { target: ComposerTarget; draftKey: string }) {
  const services = useDsh()
  const api = useMemo(() => composerApi(services.remote), [services.remote])
  const sessionId = target.kind === 'session' ? target.sessionId : ''
  const { face, snapshot, projection } = useSession(sessionId)
  const list = useSnapshot(services.sessions.list)
  const plan = projection<PlanProjection>('plan')
  const permissionValue = projection<PermissionSelection>('permissions')
  const { catalog: permissionCatalog } = usePermissionCatalog()
  const permissions = permissionValue && permissionCatalog ? { ...permissionValue, options: permissionCatalog.options } : undefined
  const { connected } = useConnection()
  const subscribe = useCallback((listener: () => void) => subscribeDraft(draftKey, listener), [draftKey])
  const snapshotOfDraft = useCallback(() => readDraft(draftKey), [draftKey])
  const draft = useSyncExternalStore(subscribe, snapshotOfDraft, snapshotOfDraft)
  const [busy, setBusy] = useState(() => Boolean(pendingDelivery(draftKey) || pendingWorkspaceAttachment(draftKey)))
  const preparing = (draft.preparingImages ?? 0) > 0
  const [auxError, setAuxError] = useState('')
  const [commands, setCommands] = useState<readonly CommandDescriptor[]>([])
  const [files, setFiles] = useState<readonly FileReference[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const catalogCache = useRef<ModelCatalog | undefined>(undefined)
  const catalogRequest = useRef<Promise<ModelCatalog> | undefined>(undefined)
  const catalogGeneration = useRef(0)
  const modelApply = useMemo(() => createModelApplyController(), [])
  const [defaults, setDefaults] = useState<PermissionProjection>()
  const [cursor, setCursor] = useState(draft.text.length)
  const [suggesting, setSuggesting] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const autosize = useRef<M3eTextareaAutosizeElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const locked = useRef(false)
  const restoreRetryFocus = useRef(false)
  const mounted = useRef(true)
  const closeSheet = useRef<(() => void) | undefined>(undefined)
  const openingPermissions = useRef(false)
  const latestModelContext = useRef({ api, services, target, sessionId, face, snapshot })
  latestModelContext.current = { api, services, target, sessionId, face, snapshot }
  const inputId = useId()
  const hintId = useId()
  const token = findReferenceToken(draft.text, cursor)
  const commandMatches = filterCommands(commands, draft.text)
  const hint = isKnownCommand(draft.text, commands) ? commands.find(command => draft.text.startsWith(`/${command.name} `))?.input?.hint : undefined
  const permission = target.kind === 'new' ? defaults && { ...defaults, currentValue: draft.permission ?? defaults.currentValue } : permissions
  const planActive = target.kind === 'new' ? draft.plan ?? false : plan ? (plan.pending ? !plan.active : plan.active) : false
  const queue = visibleQueue(queueFromInbox(projection<InboxState>('inbox')))
  const permissionName = permission ? permission.currentValue === 'custom' ? 'カスタム' : permission.options.find(option => option.value === permission.currentValue)?.name ?? 'カスタム' : '権限'
  const canSend = connected && !busy && !preparing && Boolean(draft.text.trim() || draft.images.length) && (target.kind === 'new' ? Boolean(target.workspaceId) : Boolean(face && !snapshot.removed && snapshot.openState === 'open'))
  const sendError = draft.error || (snapshot.promptError?.op === 'send' ? errorText(snapshot.promptError.error, '接続や送信内容を確認して、もう一度お試しください。') : '')

  function update(patch: Partial<Draft>) {
    const next = { ...readDraft(draftKey), ...patch }
    writeDraft(draftKey, next)
  }
  const loadCatalog = useCallback((force = false): Promise<ModelCatalog> => {
    if (!force && catalogCache.current) return Promise.resolve(catalogCache.current)
    if (catalogRequest.current) return catalogRequest.current
    const generation = ++catalogGeneration.current
    const request = api.modelCatalog().then(value => {
      if (generation === catalogGeneration.current) {
        catalogCache.current = value
        if (mounted.current) setCatalog(value)
      }
      return value
    }).finally(() => { if (catalogRequest.current === request) catalogRequest.current = undefined })
    catalogRequest.current = request
    return request
  }, [api])
  const applyModel = useCallback((selection: ModelSelection): Promise<ModelSelection> => modelApply.run(selection, async requested => {
    const current = latestModelContext.current
    if (current.services.connection.state.getSnapshot() !== 'connected') throw new Error('接続が戻ってからモデルを選んでください。')
    const commandText = readDraft(draftKey).text.trim() === '/model' ? { text: '' } : {}
    if (current.target.kind === 'new') {
      writeDraft(draftKey, { ...readDraft(draftKey), model: requested, ...commandText })
      return requested
    }
    if (!current.face || current.snapshot.removed || current.snapshot.openState !== 'open') {
      throw new Error('会話を開いてからモデルを選んでください。')
    }
    const selected = await current.api.selectModel(current.sessionId, requested)
    writeDraft(draftKey, { ...readDraft(draftKey), model: undefined, ...commandText })
    return selected
  }), [draftKey, modelApply])
  useLayoutEffect(() => {
    const origin = window.location.hash
    return registerDeliveryDestination(draftKey, reference => {
      if (window.location.hash !== origin) return
      conversationSelection(services.sessions).adopt(reference)
      navigate(`/s/${encodeURIComponent(reference.sessionId)}`, { replace: true })
    })
  }, [draftKey, services.sessions])
  useEffect(() => { modelApply.setComposerBusy(busy) }, [busy, modelApply])
  useEffect(() => {
    mounted.current = true
    const pending = pendingDelivery(draftKey)
    const recovery = pendingWorkspaceAttachment(draftKey)
    if (pending) void pending.then(finishDelivery)
    else if (recovery) void recovery.then(finishWorkspaceRecovery)
    else setBusy(false)
    return () => { mounted.current = false; closeSheet.current?.() }
  }, [])
  useEffect(() => { autosize.current?.resizeToFitContent(true) }, [draft.text])
  useEffect(() => {
    const invalidate = () => {
      catalogGeneration.current++
      catalogCache.current = undefined
      catalogRequest.current = undefined
      if (connected) {
        const request = loadCatalog(true)
        const generation = catalogGeneration.current
        void request.catch(() => { if (mounted.current && generation === catalogGeneration.current) setCatalog(undefined) })
      }
    }
    invalidate()
    const stops = PROVIDER_EVENTS.map(event => onRemoteEvent(services.remote, event, invalidate))
    return () => { catalogGeneration.current++; stops.forEach(stop => stop()) }
  }, [services.remote, connected, loadCatalog])
  useEffect(() => {
    if (!connected || target.kind !== 'new') return
    let active = true
    let generation = 0
    const reload = async () => {
      const request = ++generation
      try { const value = await api.defaultPermissions(); if (active && request === generation) setDefaults(value) }
      catch { if (active && request === generation) setDefaults(undefined) }
    }
    const off = onRemoteEvent(services.remote, 'settings/document-updated', ns => { if (ns === 'permission') void reload() })
    void reload()
    return () => { active = false; off() }
  }, [api, connected, target.kind, permissionCatalog, services.remote])
  useEffect(() => {
    if (!sessionId || !connected) return
    let active = true
    let revision = 0
    async function reload() {
      const request = ++revision
      try { const value = await api.listCommands(sessionId); if (active && revision === request) setCommands(value) }
      catch { if (active && revision === request) setCommands([]) }
    }
    void reload()
    const unsubscribe = api.onCommandsChange(() => { void reload() })
    return () => { active = false; unsubscribe() }
  }, [api, connected, sessionId])
  useEffect(() => {
    setFiles([])
    if (!suggesting || !token || !sessionId || !connected) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      void api.listFiles(sessionId, token.query, abort.signal).then(value => {
        if (!abort.signal.aborted) setFiles(value.filter(file => isReferencePathSafe(file.path)))
      }).catch(error => {
        if (!abort.signal.aborted) setAuxError(errorText(error, 'ファイルの候補を取得できませんでした。'))
      })
    }, 150)
    return () => { clearTimeout(timer); abort.abort() }
  }, [api, connected, sessionId, suggesting, token?.start, token?.end, token?.query])
  useEffect(() => {
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setSuggesting(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  function insert(text: string, position = text.length) {
    update({ text }); setCursor(position); setSuggesting(true)
    requestAnimationFrame(() => { textArea.current?.focus(); textArea.current?.setSelectionRange(position, position) })
  }
  async function imagesPicked(files: File[]) {
    if (!files.length) return
    setAuxError('')
    await prepareDraftImages(draftKey, files, prepareImage)
  }
  async function send(mode: 'queue' | 'steer' = draft.retryMode ?? 'queue', restoreFocus = false) {
    if (!canSend || locked.current || services.connection.state.getSnapshot() !== 'connected') return
    // The stock /model command belongs to its UI plugin, not the Host command list.
    if (draft.text.trim() === '/model' && draft.images.length === 0) {
      setSuggesting(false)
      openModels()
      return
    }
    restoreRetryFocus.current = restoreFocus
    locked.current = true; setBusy(true); setSuggesting(false); setAuxError('')
    update({ error: undefined })
    finishDelivery(await deliverDraft({ target, draftKey, sessions: services.sessions, api, mode, handoff: reference => handoffDeliveryDestination(draftKey, reference) }))
  }
  function finishDelivery(result: DeliveryResult) {
    if (result.error !== undefined) {
      const key = result.createdId ? `session:${result.createdId}` : draftKey
      const retained = readDraft(key)
      writeDraft(key, { ...retained, error: retained.deliveryOutcome === 'unknown' ? retained.error : errorText(result.error, retained.error) })
    }
    locked.current = false
    const restoreFocus = restoreRetryFocus.current
    restoreRetryFocus.current = false
    if (!mounted.current) return
    setBusy(false)
    if (restoreFocus) requestAnimationFrame(() => {
      if (mounted.current && document.activeElement === document.body && !textArea.current?.disabled) textArea.current?.focus()
    })
    if (result.createdId && result.sessionReady !== false) navigate(`/s/${encodeURIComponent(result.createdId)}`, { replace: true })
  }
  async function recoverWorkspace() {
    if (!draft.workspaceAttachment || busy || preparing || locked.current || services.connection.state.getSnapshot() !== 'connected') return
    locked.current = true; setBusy(true); setSuggesting(false)
    update({ workspaceAttachmentError: undefined })
    finishWorkspaceRecovery(await retryWorkspaceAttachment({ draftKey, sessions: services.sessions }))
  }
  function finishWorkspaceRecovery(result: WorkspaceRecoveryResult) {
    const key = result.sessionId && result.sessionReady ? `session:${result.sessionId}` : draftKey
    const current = readDraft(key)
    writeDraft(key, { ...current, workspaceAttachmentError: result.error === undefined ? undefined
      : errorText(result.error, 'ワークスペースへ登録できませんでした。接続を確認して、もう一度お試しください。') })
    locked.current = false
    if (!mounted.current) return
    setBusy(false)
    if (result.sessionId && result.sessionReady) navigate(`/s/${encodeURIComponent(result.sessionId)}`, { replace: true })
  }
  function openModels() {
    setAuxError('')
    closeSheet.current = openSheet(() => <ModelPickerSheet target={target} draftKey={draftKey} modelApply={modelApply}
      initialCatalog={catalog} loadCatalog={loadCatalog} applyModel={applyModel} />, { label: 'モデルの選択' })
  }
  async function openPermissions() {
    // Keep the chip unchanged while one invocation fetches and opens the sheet.
    if (openingPermissions.current) return
    openingPermissions.current = true
    try {
      const options = permission ?? (target.kind === 'new' ? await api.defaultPermissions()
        : permissionValue ? { ...permissionValue, options: (await api.permissionCatalog()).options } : undefined)
      if (!options) throw new Error('権限の候補を取得できませんでした。会話を開いてからお試しください。')
      if (!mounted.current) return
      closeSheet.current = openSheet(close => <PermissionSheet permissions={options} defaults={target.kind === 'new'} close={close} apply={async value => {
        if (target.kind === 'new') { setDefaults(options); update({ permission: value }) }
        else if (face) { requireMatched(await face.command(`/permission ${value}`)); update({ permission: undefined }) }
      }} />, { label: '権限の選び直し' })
    } catch (error) { if (mounted.current) setAuxError(errorText(error)) }
    finally { openingPermissions.current = false }
  }
  function openPlus() {
    setSuggesting(false)
    closeSheet.current = openSheet(close => <PlusSheet close={close} plan={planActive}
      target={target} draftKey={draftKey} modelApply={modelApply} initialCatalog={catalog} loadCatalog={loadCatalog} applyModel={applyModel}
      onImage={() => imageInput.current?.click()}
      onReference={() => { insert(draft.text + (draft.text && !/\s$/.test(draft.text) ? ' @' : '@')); if (!sessionId) setAuxError('ファイルの候補は、最初の送信で会話を作ったあとに使えます。') }}
      onCommand={() => { insert(draft.text.startsWith('/') ? draft.text : '/' + draft.text); if (!sessionId) setAuxError('コマンドの候補は会話を作ったあとに表示します。入力したコマンドは初回送信時に確認します。') }}
      onPlan={async active => {
        if (target.kind === 'new') update({ plan: active })
        else {
          const currentFace = latestModelContext.current.face
          if (!currentFace) throw new Error('会話を開いてから計画モードを切り替えてください。')
          requireMatched(await currentFace.command(active ? '/plan' : '/plan off'))
          update({ plan: undefined })
        }
      }} />, { label: '入力の補助' })
  }
  async function stop() {
    if (!face) return
    try { unwrapRemoteResult(await face.cancel()); setAuxError('') } catch (error) { setAuxError(errorText(error, '停止できませんでした。もう一度お試しください。')) }
  }

  if (!sessionAccess(list.byId[sessionId], snapshot).canCompose) return <p className="composer-readonly">サブエージェントの会話は読むだけです</p>
  return <div className="composer" ref={root} data-testid="composer" data-target={target.kind}>
    {draft.workspaceAttachment && <div className="composer-error" role="status"><strong>ワークスペースへの登録が未完了です</strong>
      <p>会話は作成済みです。登録の再試行では新しい会話を作りません。メッセージは送信ボタンから送れます。</p>
      {draft.workspaceAttachmentError && <p>{draft.workspaceAttachmentError}</p>}
      <M3eButton disabled={!connected || busy || preparing} onClick={() => { void recoverWorkspace() }}>ワークスペースへ登録し直す</M3eButton>
    </div>}
    {sendError && <div className="composer-error" role="alert"><strong>{draft.deliveryOutcome === 'unknown' ? '送信結果が不明です' : '送れませんでした'}</strong><p>{sendError}</p><M3eButton disabled={!canSend} onClick={event => { void send(undefined, (event as MouseEvent).detail === 0) }}>もう一度送る</M3eButton></div>}
    {auxError && <p className="composer-notice" role="status">{auxError}</p>}
    {draft.imagePreparationError !== undefined && <p className="composer-notice" role="status">{errorText(draft.imagePreparationError, '画像を読み込めませんでした。PNG または JPEG を選び直してください。')}</p>}
    {!auxError && target.kind === 'new' && suggesting && (token || draft.text.startsWith('/')) && <p className="composer-notice" role="status">ファイルとコマンドの候補は、最初の送信で会話を作ったあとに使えます。</p>}
    {queue.length > 0 && <div className="composer-queue"><M3eAssistChip className="composer-queue-chip" variant="elevated" onClick={() => { closeSheet.current = openSheet(close => <QueueSheet sessionId={sessionId} close={close} />, { label: '順番待ちの編集' }) }}><Icon slot="icon" name="schedule" />順番待ち {queue.length} 件</M3eAssistChip></div>}
    <div className="composer-input-wrap">
      {suggesting && !busy && (token ? files.length > 0 : commandMatches.length > 0) && <div className="composer-suggestions" aria-label={token ? 'ファイルの候補' : 'コマンドの候補'}>
        {token ? files.map(file => <SheetRow key={file.path} icon={file.kind === 'directory' ? 'folder' : 'description'} onClick={() => { const next = replaceReference(draft.text, token, file.path, file.kind); insert(next.text, next.cursor); setSuggesting(false) }}>{file.path}</SheetRow>) : commandMatches.map(command => <SheetRow key={command.name} icon={commandIcon(command.name)} detail={command.description} onClick={() => { insert(`/${command.name} `); setSuggesting(false) }}>/{command.name}</SheetRow>)}
      </div>}
      <div className="composer-frame">
        {draft.images.length > 0 && <div className="composer-images">{draft.images.map(image => <figure key={image.id}><img src={image.previewUrl} alt={image.name || '添付画像'} /><M3eIconButton aria-label={`${image.name || '画像'} を外す`} disabled={busy} onClick={() => update({ images: draft.images.filter(item => item.id !== image.id) })}><Icon name="close" /></M3eIconButton></figure>)}</div>}
        <textarea ref={textArea} id={inputId} rows={1} aria-label="メッセージ入力欄" aria-describedby={hint ? hintId : undefined} placeholder="メッセージを入力" value={draft.text} disabled={busy} onChange={event => { update({ text: event.target.value }); setCursor(event.target.selectionStart); setSuggesting(true) }} onSelect={event => setCursor(event.currentTarget.selectionStart)} onFocus={() => setSuggesting(true)} onKeyDown={event => { if (event.key === 'Escape') setSuggesting(false) }} />
        <M3eTextareaAutosize ref={autosize} htmlFor={inputId} minRows={1} maxRows={6} />
        {hint && <small id={hintId} className="composer-hint">{hint}</small>}
        {preparing && <small role="status">画像を準備しています…</small>}
        <div className="composer-controls">
          <M3eIconButton variant="outlined" aria-label="入力の補助を開く" disabled={busy || preparing} onClick={openPlus}><Icon name="add" /></M3eIconButton>
          <M3eAssistChip className="composer-permission" variant="outlined" disabled={!connected || busy} title={permissionName} onClick={() => { void openPermissions() }}><Icon slot="icon" name="shield" /><span className="composer-permission-label">{permissionName}</span></M3eAssistChip>
          <span className="composer-spacer" />
          {snapshot.running && <M3eIconButton aria-label="実行を停止" disabled={!connected} onClick={() => { void stop() }}><Icon name="stop" filled /></M3eIconButton>}
          {snapshot.running ? <M3eSplitButton className="composer-send-group" variant="filled">
            <M3eButton slot="leading-button" disabled={!canSend} onClick={() => { void send('queue') }}><Icon slot="icon" name="arrow_upward" />{busy ? '送信中' : '順番待ち'}</M3eButton>
            <M3eIconButton slot="trailing-button" aria-label="送り方を選ぶ" disabled={!canSend} onClick={() => { closeSheet.current = openSheet(close => <div className="composer-sheet"><h2>送り方を選ぶ</h2><SheetRow icon="schedule" onClick={() => { close(); void send('queue') }}>順番待ち</SheetRow><SheetRow icon="bolt" onClick={() => { close(); void send('steer') }}>割り込み</SheetRow></div>, { label: '送り方を選ぶ' }) }}><Icon name="arrow_drop_down" /></M3eIconButton>
          </M3eSplitButton> : <M3eIconButton variant="filled" aria-label={busy ? '送信中' : '送信'} disabled={!canSend} onClick={() => { void send('queue') }}><Icon name="arrow_upward" /></M3eIconButton>}
        </div>
      </div>
    </div>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { const picked = Array.from(event.target.files ?? []); event.target.value = ''; void imagesPicked(picked) }} />
  </div>
}
