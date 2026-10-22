import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eAssistChip } from '@m3e/react/chips'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eSplitButton } from '@m3e/react/split-button'
import { M3eTextareaAutosize, type M3eTextareaAutosizeElement } from '@m3e/react/textarea-autosize'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet, showSnackbar } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh, type InboxState } from '../../dsh/services.ts'
import { queueFromInbox } from '../../dsh/inbox.ts'
import { useSession } from '../../dsh/session.ts'
import { sessionAccess } from '../../dsh/session-access.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { presetDisplayName } from '../../dsh/permission-presets.ts'
import { usePermissionCatalog } from './use-permission-catalog.ts'
import type { PermissionSelection } from './api.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { composerApi, requireMatched, type CommandDescriptor, type FileReference, type ModelCatalog, type ModelSelection, type ModelSelectionProjection, type PermissionProjection, type PlanProjection } from './api.ts'
import { consumeDraftCommand, draftTextRevision, prepareDraftImages, readDraft, subscribeDraft, writeDraft, type Draft } from './drafts.ts'
import { filterCommands, findReferenceToken, isKnownCommand, isReferencePathSafe, replaceReference, visibleQueue, withdrawnPermission } from './helpers.ts'
import { prepareImage } from './images.ts'
import { ModelPickerSheet, PermissionSheet, PlusSheet, QueueSheet, SheetRow } from './Sheets.tsx'
import { deliverDraft, pendingDelivery, type DeliveryResult } from './delivery.ts'
import { registerDeliveryDestination, handoffDeliveryDestination } from './delivery-destination.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'
import { pendingWorkspaceAttachment, retryWorkspaceAttachment, type WorkspaceRecoveryResult } from './workspace-recovery.ts'
import { commandIcon, permissionIcon } from './presentation.ts'
import { modelApplyController, modelDisplayName } from './model-picker.ts'
import { PROVIDER_EVENTS } from '../settings/providers.ts'
import { useCacheSentinel } from './cache-sentinel.ts'
import { GoalStrip } from '../session-tools/GoalStrip.tsx'
import { useMessages } from '../../i18n/index.ts'
import { composerMessages, composerText } from './messages.ts'
import '../session-tools/session-tools.css'
import './composer.css'
import { errorText, LocalizedError } from './localized-error.ts'

export type ComposerTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export function Composer({ target }: { target: ComposerTarget }) {
  const key = target.kind === 'session' ? `session:${target.sessionId}` : `new:${target.workspaceId}`
  return <ComposerInput key={key} target={target} draftKey={key} />
}

function ComposerInput({ target, draftKey }: { target: ComposerTarget; draftKey: string }) {
  const text = useMessages(composerMessages)
  const services = useDsh()
  const api = useMemo(() => composerApi(services.remote), [services.remote])
  const sessionId = target.kind === 'session' ? target.sessionId : ''
  const { face, snapshot, projection } = useSession(sessionId)
  const list = useSnapshot(services.sessions.list)
  const plan = projection<PlanProjection>('plan')
  const permissionValue = projection<PermissionSelection>('permissions')
  const modelSelection = projection<ModelSelectionProjection>('modelSelection')
  const { catalog: permissionCatalog } = usePermissionCatalog()
  const permissions = permissionValue && permissionCatalog ? { ...permissionValue, options: permissionCatalog.options } : undefined
  const { connected } = useConnection()
  const subscribe = useCallback((listener: () => void) => subscribeDraft(draftKey, listener), [draftKey])
  const snapshotOfDraft = useCallback(() => readDraft(draftKey), [draftKey])
  const draft = useSyncExternalStore(subscribe, snapshotOfDraft, snapshotOfDraft)
  const [busy, setBusy] = useState(() => Boolean(pendingDelivery(draftKey) || pendingWorkspaceAttachment(draftKey)))
  // The retry may have started on the other screen for the same created conversation.
  const [recovering, setRecovering] = useState(() => !pendingDelivery(draftKey) && Boolean(pendingWorkspaceAttachment(draftKey)))
  const preparing = (draft.preparingImages ?? 0) > 0
  const [auxError, setAuxError] = useState('')
  const [commands, setCommands] = useState<readonly CommandDescriptor[]>([])
  const [files, setFiles] = useState<readonly FileReference[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const catalogCache = useRef<ModelCatalog | undefined>(undefined)
  const catalogRequest = useRef<Promise<ModelCatalog> | undefined>(undefined)
  const catalogGeneration = useRef(0)
  const modelApply = useMemo(() => modelApplyController(services.sessions, draftKey), [services.sessions, draftKey])
  const modelState = useSyncExternalStore(modelApply.subscribe, modelApply.getSnapshot, modelApply.getSnapshot)
  const [defaults, setDefaults] = useState<PermissionProjection>()
  const latestDefaults = useRef<PermissionProjection | undefined>(undefined)
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
  const permissionOption = permission?.options.find(option => option.value === permission.currentValue)
  const permissionName = permission ? permissionOption ? presetDisplayName(permissionOption.value, permissionOption.name) : presetDisplayName('custom', '') : text.permissionFallback
  const permissionLabel = permission ? text.permissionLabel(permissionName) : text.permissionFallback
  const currentModel = target.kind === 'new' ? draft.model ?? catalog?.default : modelSelection?.next ?? catalog?.default
  const modelName = modelDisplayName(currentModel, catalog)
  const canSend = connected && !busy && !modelState.pending && !preparing && Boolean(draft.text.trim() || draft.images.length) && (target.kind === 'new' ? Boolean(target.workspaceId) : Boolean(face && !snapshot.removed && snapshot.openState === 'open'))
  const sendError = draft.error || (snapshot.promptError?.op === 'send' ? errorText(snapshot.promptError.error, text.sendConfirmFallback, text) : '')

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
    if (current.services.connection.state.getSnapshot() !== 'connected') throw new LocalizedError(composerText().modelConnectFirst)
    if (pendingDelivery(draftKey) || pendingWorkspaceAttachment(draftKey)) throw new LocalizedError(composerText().modelAfterSend)
    const textRevision = draftTextRevision(draftKey)
    if (current.target.kind === 'new') {
      writeDraft(draftKey, { ...readDraft(draftKey), model: requested })
      consumeDraftCommand(draftKey, '/model', textRevision)
      return requested
    }
    if (!current.face || current.snapshot.removed || current.snapshot.openState !== 'open') {
      throw new LocalizedError(composerText().modelOpenConversation)
    }
    const selected = await current.api.selectModel(current.sessionId, requested)
    writeDraft(draftKey, { ...readDraft(draftKey), model: undefined })
    consumeDraftCommand(draftKey, '/model', textRevision)
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
    else if (recovery) { setRecovering(true); void recovery.then(finishWorkspaceRecovery) }
    else { setBusy(false); setRecovering(false) }
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
      try {
        const value = await api.defaultPermissions()
        if (!active || request !== generation) return
        // The choice is kept in the draft, so a preset withdrawn from the catalog (or one left from before a
        // reload) would be sent as `/permission <value>`, which the Host ignores. Go back to the default instead.
        const draft = readDraft(draftKey)
        const withdrawn = !value || pendingDelivery(draftKey) ? undefined : withdrawnPermission(draft.permission, value.options)
        if (value && withdrawn !== undefined) {
          const name = latestDefaults.current?.options.find(option => option.value === withdrawn)?.name ?? withdrawn
          const fallback = value.options.find(option => option.value === value.currentValue)
          const messages = composerText()
          writeDraft(draftKey, { ...draft, permission: undefined })
          showSnackbar(messages.permissionWithdrawn(presetDisplayName(withdrawn, name), fallback ? presetDisplayName(fallback.value, fallback.name) : undefined))
        }
        latestDefaults.current = value
        setDefaults(value)
      }
      catch { if (active && request === generation) setDefaults(undefined) }
    }
    const off = onRemoteEvent(services.remote, 'settings/document-updated', ns => { if (ns === 'permission') void reload() })
    void reload()
    return () => { active = false; off() }
  }, [api, connected, target.kind, permissionCatalog, services.remote, draftKey])
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
  // cache-sentinel が入っている DSH だけ(コマンド一覧に /sentinel がある)で状態を取りに行く。
  // 入っていない DSH や偽データの画面で取得口の 404 を出さないため。
  const sentinel = useCacheSentinel(sessionId, target.kind === 'session' && connected && commands.some(command => command.name === 'sentinel'))
  const [unlocking, setUnlocking] = useState(false)
  useEffect(() => {
    setFiles([])
    if (!suggesting || !token || !sessionId || !connected) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      void api.listFiles(sessionId, token.query, abort.signal).then(value => {
        if (!abort.signal.aborted) setFiles(value.filter(file => isReferencePathSafe(file.path)))
      }).catch(error => {
        if (!abort.signal.aborted) setAuxError(errorText(error, composerText().fileCandidatesFailed))
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
    if (!canSend || modelApply.getSnapshot().pending || locked.current || services.connection.state.getSnapshot() !== 'connected') return
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
      writeDraft(key, { ...retained, error: retained.deliveryOutcome === 'unknown' ? retained.error : errorText(result.error, retained.error ?? composerText().errorFailed) })
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
    locked.current = true; setBusy(true); setRecovering(true); setSuggesting(false)
    update({ workspaceAttachmentError: undefined })
    finishWorkspaceRecovery(await retryWorkspaceAttachment({ draftKey, sessions: services.sessions }))
  }
  function finishWorkspaceRecovery(result: WorkspaceRecoveryResult) {
    const key = result.sessionId && result.sessionReady ? `session:${result.sessionId}` : draftKey
    const current = readDraft(key)
    writeDraft(key, { ...current, workspaceAttachmentError: result.error === undefined ? undefined
      : errorText(result.error, composerText().workspaceRecoveryFailed) })
    locked.current = false
    if (!mounted.current) return
    setBusy(false); setRecovering(false)
    if (result.sessionId && result.sessionReady) navigate(`/s/${encodeURIComponent(result.sessionId)}`, { replace: true })
  }
  function openModels() {
    setAuxError('')
    closeSheet.current = openSheet(() => <ModelPickerSheet target={target} draftKey={draftKey} modelApply={modelApply}
      initialCatalog={catalog} loadCatalog={loadCatalog} applyModel={applyModel} />, { label: text.modelSheetLabel })
  }
  async function openPermissions() {
    // Keep the chip unchanged while one invocation fetches and opens the sheet.
    if (openingPermissions.current) return
    openingPermissions.current = true
    try {
      const options = permission ?? (target.kind === 'new' ? await api.defaultPermissions()
        : permissionValue ? { ...permissionValue, options: (await api.permissionCatalog()).options } : undefined)
      if (!options) throw new LocalizedError(text.permissionCandidatesFailed)
      if (!mounted.current) return
      closeSheet.current = openSheet(close => <PermissionSheet permissions={options} defaults={target.kind === 'new'} sessionId={sessionId} close={close} apply={async value => {
        if (target.kind === 'new') { setDefaults(options); update({ permission: value }) }
        else if (face) { requireMatched(await face.command(`/permission ${value}`)); update({ permission: undefined }) }
      }} />, { label: text.permissionSheetLabel })
    } catch (error) { if (mounted.current) setAuxError(errorText(error, undefined, text)) }
    finally { openingPermissions.current = false }
  }
  function openPlus() {
    setSuggesting(false)
    closeSheet.current = openSheet(close => <PlusSheet close={close} plan={planActive}
      target={target} draftKey={draftKey} modelApply={modelApply} initialCatalog={catalog} loadCatalog={loadCatalog} applyModel={applyModel}
      onImage={() => imageInput.current?.click()}
      onReference={() => { insert(draft.text + (draft.text && !/\s$/.test(draft.text) ? ' @' : '@')); if (!sessionId) setAuxError(text.fileSuggestionsNeedSession) }}
      onCommand={() => { insert(draft.text.startsWith('/') ? draft.text : '/' + draft.text); if (!sessionId) setAuxError(text.commandSuggestionsNeedSession) }}
      onPlan={async active => {
        if (target.kind === 'new') update({ plan: active })
        else {
          const currentFace = latestModelContext.current.face
          if (!currentFace) throw new LocalizedError(composerText().planOpenConversation)
          requireMatched(await currentFace.command(active ? '/plan' : '/plan off'))
          update({ plan: undefined })
        }
      }} />, { label: text.plusSheetLabel })
  }
  async function unlockCache() {
    if (!face) return
    setUnlocking(true)
    try { requireMatched(await face.command('/unlock')); setAuxError('') }
    catch (error) { setAuxError(errorText(error, text.unlockFailed, text)) }
    finally { setUnlocking(false); void sentinel.refresh() }
  }
  async function stop() {
    if (!face) return
    try { unwrapRemoteResult(await face.cancel()); setAuxError('') } catch (error) { setAuxError(errorText(error, text.stopFailed, text)) }
  }

  if (!sessionAccess(list.byId[sessionId], snapshot).canCompose) return <p className="composer-readonly">{text.readOnlySubagent}</p>
  return <div className="composer" ref={root} data-testid="composer" data-target={target.kind}>
    {draft.workspaceAttachment && <div className="composer-error" role="status"><strong>{text.workspaceRecoveryTitle}</strong>
      <p>{text.workspaceRecoveryBody}</p>
      {draft.workspaceAttachmentError && <p>{draft.workspaceAttachmentError}</p>}
      <M3eButton disabled={!connected || busy || preparing} onClick={() => { void recoverWorkspace() }}>{text.workspaceRecoveryAction}</M3eButton>
    </div>}
    {recovering && <p className="composer-notice" role="status">{text.workspaceRecovering}</p>}
    {sendError && <div className="composer-error" role="alert"><strong>{draft.deliveryOutcome === 'unknown' ? text.deliveryUnknownTitle : text.deliveryFailedTitle}</strong><p>{sendError}</p><M3eButton disabled={!canSend} onClick={event => { void send(undefined, (event as MouseEvent).detail === 0) }}>{text.resend}</M3eButton></div>}
    {sentinel.banner && <div className={`composer-sentinel composer-sentinel-${sentinel.banner.tone}`} role="status" data-testid="cache-sentinel-banner">
      <p>{sentinel.banner.text}</p>
      {sentinel.banner.tone === 'warning' && <M3eButton variant="outlined" disabled={!connected || unlocking} onClick={() => { void unlockCache() }}>{text.cacheUnlockLabel}</M3eButton>}
    </div>}
    {auxError && <p className="composer-notice" role="status">{auxError}</p>}
    {draft.imagePreparationError !== undefined && <p className="composer-notice" role="status">{errorText(draft.imagePreparationError, text.imageLoadFailed, text)}</p>}
    {!auxError && target.kind === 'new' && suggesting && (token || draft.text.startsWith('/')) && <p className="composer-notice" role="status">{text.suggestionsNeedSession}</p>}
    {target.kind === 'session' && <GoalStrip sessionId={sessionId} />}
    {queue.length > 0 && <div className="composer-queue"><M3eAssistChip className="composer-queue-chip" variant="elevated" onClick={() => { closeSheet.current = openSheet(close => <QueueSheet sessionId={sessionId} close={close} />, { label: text.queueSheetLabel }) }}><Icon slot="icon" name="schedule" />{text.queueChip(queue.length)}</M3eAssistChip></div>}
    <div className="composer-input-wrap">
      {suggesting && !busy && (token ? files.length > 0 : commandMatches.length > 0) && <div className="composer-suggestions" aria-label={token ? text.fileSuggestionsLabel : text.commandSuggestionsLabel}>
        {token ? files.map(file => <SheetRow key={file.path} icon={file.kind === 'directory' ? 'folder' : 'description'} onClick={() => { const next = replaceReference(draft.text, token, file.path, file.kind); insert(next.text, next.cursor); setSuggesting(false) }}>{file.path}</SheetRow>) : commandMatches.map(command => <SheetRow key={command.name} icon={commandIcon(command.name)} detail={command.description} onClick={() => { insert(`/${command.name} `); setSuggesting(false) }}>/{command.name}</SheetRow>)}
      </div>}
      <div className="composer-frame">
        {draft.images.length > 0 && <div className="composer-images">{draft.images.map(image => <figure key={image.id}><img src={image.previewUrl} alt={image.name || text.attachmentImageAlt} /><M3eIconButton aria-label={text.removeImage(image.name || text.imageFallbackName)} disabled={busy} onClick={() => update({ images: draft.images.filter(item => item.id !== image.id) })}><Icon name="close" /></M3eIconButton></figure>)}</div>}
        <textarea ref={textArea} id={inputId} rows={1} aria-label={text.inputLabel} aria-describedby={hint ? hintId : undefined} placeholder={text.inputPlaceholder} value={draft.text} disabled={busy} onChange={event => { update({ text: event.target.value }); setCursor(event.target.selectionStart); setSuggesting(true) }} onSelect={event => setCursor(event.currentTarget.selectionStart)} onFocus={() => setSuggesting(true)} onKeyDown={event => { if (event.key === 'Escape') setSuggesting(false) }} />
        {/* CSS owns the limits: the library's row measurement includes min-height. */}
        <M3eTextareaAutosize ref={autosize} htmlFor={inputId} />
        {hint && <small id={hintId} className="composer-hint">{hint}</small>}
        {preparing && <small role="status">{text.preparingImages}</small>}
        <div className={snapshot.running ? 'composer-controls composer-controls-running' : 'composer-controls'}>
          <M3eIconButton variant="outlined" aria-label={text.plusOpenLabel} disabled={busy || preparing} onClick={openPlus}><Icon name="add" /></M3eIconButton>
          <M3eIconButton className="composer-permission" variant="outlined" aria-label={permissionLabel} title={permissionLabel} disabled={!connected || busy} onClick={() => { void openPermissions() }}><Icon name={permissionIcon(permissionOption?.value)} /></M3eIconButton>
          <span className="composer-spacer" />
          <M3eButton variant="text" className="composer-model" aria-label={modelName ? text.modelAria(modelName) : text.selectModel} title={modelName ? text.modelAria(modelName) : text.selectModel} disabled={!connected || busy} onClick={openModels}><span className="composer-model-label">{modelName ?? text.modelFallback}</span></M3eButton>
          {snapshot.running && <M3eIconButton aria-label={text.stopRun} disabled={!connected} onClick={() => { void stop() }}><Icon name="stop" filled /></M3eIconButton>}
          {snapshot.running ? <M3eSplitButton className="composer-send-group" variant="filled">
            <M3eButton slot="leading-button" disabled={!canSend} onClick={() => { void send('queue') }}><Icon slot="icon" name="arrow_upward" />{busy ? text.sending : text.queueMode}</M3eButton>
            <M3eIconButton slot="trailing-button" aria-label={text.sendMode} disabled={!canSend} onClick={() => { closeSheet.current = openSheet(close => <div className="composer-sheet"><h2>{text.sendMode}</h2><SheetRow icon="schedule" onClick={() => { close(); void send('queue') }}>{text.queueMode}</SheetRow><SheetRow icon="bolt" onClick={() => { close(); void send('steer') }}>{text.steerMode}</SheetRow></div>, { label: text.sendMode }) }}><Icon name="arrow_drop_down" /></M3eIconButton>
          </M3eSplitButton> : <M3eIconButton variant="filled" aria-label={busy ? text.sending : text.send} disabled={!canSend} onClick={() => { void send('queue') }}><Icon name="arrow_upward" /></M3eIconButton>}
        </div>
      </div>
    </div>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { const picked = Array.from(event.target.files ?? []); event.target.value = ''; void imagesPicked(picked) }} />
  </div>
}
