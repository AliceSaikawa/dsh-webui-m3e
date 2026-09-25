import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eSplitButton } from '@m3e/react/split-button'
import { M3eTextareaAutosize, type M3eTextareaAutosizeElement } from '@m3e/react/textarea-autosize'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useConnection } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { composerApi, requireMatched, type CommandDescriptor, type FileReference, type ModelCatalog, type ModelSelectionProjection, type PermissionProjection, type PlanProjection } from './api.ts'
import { readDraft, writeDraft, type Draft } from './drafts.ts'
import { filterCommands, findReferenceToken, isKnownCommand, isReferencePathSafe, replaceReference, visibleQueue } from './helpers.ts'
import { prepareImage } from './images.ts'
import { errorText, ModelSheet, PermissionSheet, PlusSheet, QueueSheet, SheetRow } from './Sheets.tsx'
import { deliverDraft, pendingDelivery, type DeliveryResult } from './delivery.ts'
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
  const plan = projection<PlanProjection>('plan')
  const permissions = projection<PermissionProjection>('permissions')
  const modelSelection = projection<ModelSelectionProjection>('modelSelection')
  const { connected } = useConnection()
  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [busy, setBusy] = useState(() => Boolean(pendingDelivery(draftKey)))
  const [preparing, setPreparing] = useState(false)
  const [auxError, setAuxError] = useState('')
  const [commands, setCommands] = useState<readonly CommandDescriptor[]>([])
  const [files, setFiles] = useState<readonly FileReference[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [defaults, setDefaults] = useState<PermissionProjection>()
  const [cursor, setCursor] = useState(draft.text.length)
  const [suggesting, setSuggesting] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const autosize = useRef<M3eTextareaAutosizeElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const closeSheet = useRef<(() => void) | undefined>(undefined)
  const inputId = useId()
  const hintId = useId()
  const token = findReferenceToken(draft.text, cursor)
  const commandMatches = filterCommands(commands, draft.text)
  const hint = isKnownCommand(draft.text, commands) ? commands.find(command => draft.text.startsWith(`/${command.name} `))?.input?.hint : undefined
  const permission = target.kind === 'new' ? defaults && { ...defaults, currentValue: draft.permission ?? defaults.currentValue } : permissions
  const selectedModel = target.kind === 'new' ? draft.model ?? catalog?.default : modelSelection?.next ?? catalog?.default
  const modelName = catalog?.groups.find(group => group.id === selectedModel?.provider)?.models.find(model => model.id === selectedModel?.model)?.name ?? selectedModel?.model ?? '既定のモデル'
  const planActive = target.kind === 'new' ? draft.plan ?? false : plan ? (plan.pending ? !plan.active : plan.active) : false
  const queue = visibleQueue(snapshot.queue)
  const permissionName = permission ? permission.currentValue === 'custom' ? 'カスタム' : permission.options.find(option => option.value === permission.currentValue)?.name ?? 'カスタム' : '権限'
  const canSend = connected && !busy && !preparing && Boolean(draft.text.trim() || draft.images.length) && (target.kind === 'new' ? Boolean(target.workspaceId) : Boolean(face && !snapshot.removed && snapshot.openState === 'open'))
  const sendError = draft.error || (snapshot.promptError?.op === 'send' ? errorText(snapshot.promptError.error, '接続や送信内容を確認して、もう一度お試しください。') : '')

  function update(patch: Partial<Draft>) {
    const next = { ...readDraft(draftKey), ...patch }
    writeDraft(draftKey, next)
    if (mounted.current) setDraft(next)
  }
  useEffect(() => {
    mounted.current = true
    const pending = pendingDelivery(draftKey)
    if (pending) void pending.then(finishDelivery)
    else { setBusy(false); setDraft(readDraft(draftKey)) }
    return () => { mounted.current = false; closeSheet.current?.() }
  }, [])
  useEffect(() => { autosize.current?.resizeToFitContent(true) }, [draft.text])
  useEffect(() => {
    if (!connected) return
    let active = true
    void api.modelCatalog().then(value => { if (active) setCatalog(value) }).catch(() => { /* Retry when the model sheet is opened. */ })
    if (target.kind === 'new') void api.defaultPermissions().then(value => { if (active) setDefaults(value) }).catch(() => { /* No invented presets. */ })
    return () => { active = false }
  }, [api, connected, target.kind])
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
    setPreparing(true); setAuxError('')
    const results = await Promise.allSettled(files.map(prepareImage))
    const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    update({ images: [...readDraft(draftKey).images, ...added] })
    const failed = results.find(result => result.status === 'rejected')
    if (mounted.current) { setPreparing(false); if (failed?.status === 'rejected') setAuxError(errorText(failed.reason, '画像を読み込めませんでした。PNG または JPEG を選び直してください。')) }
  }
  async function send(mode: 'queue' | 'steer' = draft.retryMode ?? 'queue') {
    if (!canSend || locked.current || services.connection.state.getSnapshot() !== 'connected') return
    // The stock /model command belongs to its UI plugin, not the Host command list.
    if (draft.text.trim() === '/model' && draft.images.length === 0) {
      setSuggesting(false)
      await openModels()
      return
    }
    locked.current = true; setBusy(true); setSuggesting(false); setAuxError('')
    update({ error: undefined })
    finishDelivery(await deliverDraft({ target, draftKey, sessions: services.sessions, api, mode }))
  }
  function finishDelivery(result: DeliveryResult) {
    if (result.error !== undefined) {
      const key = result.createdId ? `session:${result.createdId}` : draftKey
      const retained = readDraft(key)
      writeDraft(key, { ...retained, error: errorText(result.error, retained.error) })
    }
    locked.current = false
    if (!mounted.current) return
    setDraft(readDraft(draftKey)); setBusy(false)
    if (result.createdId) navigate(`/s/${encodeURIComponent(result.createdId)}`, { replace: true })
  }
  async function openModels() {
    setAuxError('')
    try {
      const models = await api.modelCatalog()
      if (!mounted.current) return
      setCatalog(models)
      closeSheet.current = openSheet(close => <ModelSheet catalog={models} selected={selectedModel ?? models.default} close={close} apply={async selection => {
        const commandText = readDraft(draftKey).text.trim() === '/model' ? { text: '' } : {}
        if (target.kind === 'new') update({ model: selection, ...commandText })
        else if (face) { await api.selectModel(sessionId, selection); update({ model: undefined, ...commandText }) }
      }} />, { label: 'モデルの選択' })
    } catch (error) { setAuxError(errorText(error, 'モデル一覧を取得できませんでした。')) }
  }
  async function openPermissions() {
    try {
      const options = permission ?? (target.kind === 'new' ? await api.defaultPermissions() : undefined)
      if (!options) throw new Error('権限の候補を取得できませんでした。会話を開いてからお試しください。')
      if (!mounted.current) return
      closeSheet.current = openSheet(close => <PermissionSheet permissions={options} close={close} apply={async value => {
        if (target.kind === 'new') { setDefaults(options); update({ permission: value }) }
        else if (face) { requireMatched(await face.command(`/permission ${value}`)); update({ permission: undefined }) }
      }} />, { label: '権限の選び直し' })
    } catch (error) { setAuxError(errorText(error)) }
  }
  function openPlus() {
    setSuggesting(false)
    closeSheet.current = openSheet(close => <PlusSheet close={close} plan={planActive} disabled={!connected || busy} modelName={modelName}
      onImage={() => imageInput.current?.click()}
      onReference={() => { insert(draft.text + (draft.text && !/\s$/.test(draft.text) ? ' @' : '@')); if (!sessionId) setAuxError('ファイルの候補は、最初の送信で会話を作ったあとに使えます。') }}
      onCommand={() => { insert(draft.text.startsWith('/') ? draft.text : '/' + draft.text); if (!sessionId) setAuxError('コマンドの候補は会話を作ったあとに表示します。入力したコマンドは初回送信時に確認します。') }}
      onModel={() => { void openModels() }} onPlan={async active => {
        if (target.kind === 'new') update({ plan: active })
        else if (face) { requireMatched(await face.command(active ? '/plan' : '/plan off')); update({ plan: undefined }) }
      }} />, { label: '入力の補助' })
  }
  async function stop() {
    if (!face) return
    try { unwrapRemoteResult(await face.cancel()); setAuxError('') } catch (error) { setAuxError(errorText(error, '停止できませんでした。もう一度お試しください。')) }
  }

  if (snapshot.subagent !== null) return <p className="composer-readonly">サブエージェントの会話は読むだけです</p>
  return <div className="composer" ref={root} data-testid="composer" data-target={target.kind}>
    {sendError && <div className="composer-error" role="alert"><strong>送れませんでした</strong><p>{sendError}</p><M3eButton disabled={!canSend} onClick={() => { void send() }}>もう一度送る</M3eButton></div>}
    {auxError && <p className="composer-notice" role="status">{auxError}</p>}
    {!auxError && target.kind === 'new' && suggesting && (token || draft.text.startsWith('/')) && <p className="composer-notice" role="status">ファイルとコマンドの候補は、最初の送信で会話を作ったあとに使えます。</p>}
    {queue.length > 0 && <M3eButton className="composer-queue-chip" variant="tonal" onClick={() => { closeSheet.current = openSheet(close => <QueueSheet sessionId={sessionId} close={close} />, { label: '順番待ちの編集' }) }}>順番待ち {queue.length} 件</M3eButton>}
    <div className="composer-input-wrap">
      {suggesting && !busy && (token ? files.length > 0 : commandMatches.length > 0) && <div className="composer-suggestions" aria-label={token ? 'ファイルの候補' : 'コマンドの候補'}>
        {token ? files.map(file => <SheetRow key={file.path} icon={file.kind === 'directory' ? 'folder' : 'description'} onClick={() => { const next = replaceReference(draft.text, token, file.path, file.kind); insert(next.text, next.cursor); setSuggesting(false) }}>{file.path}</SheetRow>) : commandMatches.map(command => <SheetRow key={command.name} detail={command.description} onClick={() => { insert(`/${command.name} `); setSuggesting(false) }}>/{command.name}</SheetRow>)}
      </div>}
      <div className="composer-frame">
        {draft.images.length > 0 && <div className="composer-images">{draft.images.map(image => <figure key={image.id}><img src={image.previewUrl} alt={image.name || '添付画像'} /><M3eIconButton aria-label={`${image.name || '画像'} を外す`} disabled={busy} onClick={() => update({ images: draft.images.filter(item => item.id !== image.id) })}><Icon name="close" /></M3eIconButton></figure>)}</div>}
        <textarea ref={textArea} id={inputId} rows={1} aria-label="メッセージ入力欄" aria-describedby={hint ? hintId : undefined} placeholder="メッセージを入力" value={draft.text} disabled={busy} onChange={event => { update({ text: event.target.value }); setCursor(event.target.selectionStart); setSuggesting(true) }} onSelect={event => setCursor(event.currentTarget.selectionStart)} onFocus={() => setSuggesting(true)} onKeyDown={event => { if (event.key === 'Escape') setSuggesting(false) }} />
        <M3eTextareaAutosize ref={autosize} htmlFor={inputId} minRows={1} maxRows={6} />
        {hint && <small id={hintId} className="composer-hint">{hint}</small>}
        {preparing && <small role="status">画像を準備しています…</small>}
        <div className="composer-controls">
          <M3eIconButton aria-label="入力の補助を開く" disabled={busy || preparing} onClick={openPlus}><Icon name="add" /></M3eIconButton>
          <M3eButton className="composer-permission" variant="tonal" disabled={!connected || busy} onClick={() => { void openPermissions() }}><span className="composer-permission-label">{permissionName}</span></M3eButton>
          <span className="composer-spacer" />
          {snapshot.running && <M3eIconButton aria-label="実行を停止" disabled={!connected} onClick={() => { void stop() }}><Icon name="stop" filled /></M3eIconButton>}
          {snapshot.running ? <M3eSplitButton className="composer-send-group" variant="filled">
            <M3eButton slot="leading-button" disabled={!canSend} onClick={() => { void send('queue') }}>{busy ? '送信中' : '順番待ち'}</M3eButton>
            <M3eIconButton slot="trailing-button" aria-label="送り方を選ぶ" disabled={!canSend} onClick={() => { closeSheet.current = openSheet(close => <div className="composer-sheet"><h2>送り方を選ぶ</h2><SheetRow icon="schedule" onClick={() => { close(); void send('queue') }}>順番待ち</SheetRow><SheetRow icon="bolt" onClick={() => { close(); void send('steer') }}>割り込み</SheetRow></div>, { label: '送り方を選ぶ' }) }}><Icon name="arrow_drop_down" /></M3eIconButton>
          </M3eSplitButton> : <M3eButton variant="filled" disabled={!canSend} onClick={() => { void send('queue') }}>{busy ? '送信中' : '送信'}</M3eButton>}
        </div>
      </div>
    </div>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { const picked = Array.from(event.target.files ?? []); event.target.value = ''; void imagesPicked(picked) }} />
  </div>
}
