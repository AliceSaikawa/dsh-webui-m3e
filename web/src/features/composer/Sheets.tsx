import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eFormField } from '@m3e/react/form-field'
import { M3eOption } from '@m3e/react/option'
import { M3eSelect, type M3eSelectElement } from '@m3e/react/select'
import { M3eSwitch } from '@m3e/react/switch'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { QueueAction } from '../../dsh/services.ts'
import type { ModelCatalog, ModelSelection, PermissionProjection } from './api.ts'
import { reasoningEffortLabel, visibleQueue } from './helpers.ts'
import { effortValue, modelChoices, modelValue, reasoningForSelection, selectionFromModelValue } from './model-picker.ts'
import { queueEditPrompt } from './queue-edit.ts'
import { permissionIcon } from './presentation.ts'

export function errorText(error: unknown, fallback = '処理に失敗しました。もう一度お試しください。'): string {
  // Local validation errors are authored in Japanese; host diagnostics use the shared translator.
  if (error instanceof Error && /^[ぁ-んァ-ヶ一-龠]/.test(error.message)) return error.message
  return remoteErrorMessage(error, fallback)
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
  selected?: ModelSelection | null
  loadCatalog(force?: boolean): Promise<ModelCatalog>
  applyModel(selection: ModelSelection): Promise<ModelSelection>
}

export function PlusSheet({ close, plan, disabled, onImage, onReference, onCommand, onPlan, ...modelProps }: {
  close(): void; plan: boolean; disabled: boolean
  onImage(): void; onReference(): void; onCommand(): void; onPlan(active: boolean): Promise<void>
} & ModelPickerProps) {
  const [active, setActive] = useState(plan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choose = (action: () => void) => { close(); action() }
  async function toggle() {
    if (busy || disabled) return
    setBusy(true); setError('')
    try { await onPlan(!active); setActive(!active) } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  return <div className="composer-sheet"><h2>入力の補助</h2>
    <SheetRow icon="image" onClick={() => choose(onImage)}>画像を添付</SheetRow>
    <SheetRow icon="alternate_email" detail="入力欄で @ を打っても出せる" onClick={() => choose(onReference)}>ファイルを参照</SheetRow>
    <SheetRow icon="terminal" detail="入力欄で / を打っても出せる" onClick={() => choose(onCommand)}>コマンド</SheetRow>
    <div className="composer-switch-row"><Icon name="checklist" className="composer-sheet-icon" /><span className="composer-sheet-copy">計画モード</span><M3eSwitch aria-label="計画モード" checked={active} disabled={disabled || busy} onChange={() => { void toggle() }} /></div>
    <ModelPicker {...modelProps} disabled={disabled || busy} />
    {error && <p role="alert">{error}</p>}
  </div>
}

export function ModelPickerSheet({ disabled, ...props }: ModelPickerProps & { disabled: boolean }) {
  return <div className="composer-sheet"><h2>モデルの選択</h2><ModelPicker {...props} disabled={disabled} /></div>
}

function ModelPicker({ initialCatalog, selected, loadCatalog, applyModel, disabled }: ModelPickerProps & { disabled: boolean }) {
  const [catalog, setCatalog] = useState(initialCatalog)
  const [current, setCurrent] = useState(selected)
  const [loading, setLoading] = useState(!initialCatalog)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestBusy = useRef(false)
  const modelSelect = useRef<M3eSelectElement>(null)
  const effortSelect = useRef<M3eSelectElement>(null)
  const modelId = useId()
  const effortId = useId()
  const choices = catalog ? modelChoices(catalog) : []
  const reasoning = reasoningForSelection(current, choices)
  const selectedEffort = effortValue(current, choices)
  useEffect(() => {
    if (initialCatalog) return
    let active = true
    void loadCatalog().then(value => { if (active) { setCatalog(value); setCurrent(previous => previous ?? value.default); setLoading(false) } })
      .catch(cause => { if (active) { setError(errorText(cause, 'モデル一覧を取得できませんでした。')); setLoading(false) } })
    return () => { active = false }
  }, [initialCatalog, loadCatalog])
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
    catch (cause) { setError(errorText(cause, 'モデル一覧を取得できませんでした。')) }
    finally { setLoading(false) }
  }
  async function choose(selection: ModelSelection) {
    if (requestBusy.current || disabled || loading) return
    requestBusy.current = true; setBusy(true); setError('')
    try { setCurrent(await applyModel(selection)) }
    catch (cause) {
      setError(errorText(cause, 'モデルを切り替えられませんでした。'))
      if (modelSelect.current) modelSelect.current.value = modelValue(current)
      if (effortSelect.current) effortSelect.current.value = selectedEffort
    } finally { requestBusy.current = false; setBusy(false) }
  }
  return <div className="composer-model-picker">
    <M3eFormField variant="outlined">
      <label slot="label" htmlFor={modelId}>モデル</label>
      <M3eSelect ref={modelSelect} id={modelId} aria-label="モデル" value={modelValue(current)} disabled={disabled || busy || loading || choices.length === 0}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          const selection = typeof value === 'string' ? selectionFromModelValue(value, choices) : undefined
          if (selection) void choose(selection)
        }}>
        {loading && <M3eOption value="" disabled>読み込み中</M3eOption>}
        {!loading && choices.length === 0 && <M3eOption value="" disabled>選べるモデルがありません</M3eOption>}
        {choices.map(choice => <M3eOption key={choice.value} value={choice.value}>{choice.label}</M3eOption>)}
      </M3eSelect>
    </M3eFormField>
    {loading && <p role="status">モデル一覧を読み込み中…</p>}
    {catalog && catalog.failures.length > 0 && <div role="status">
      <p>一部のモデル一覧を取得できませんでした。</p>
      {catalog.failures.map(failure => <p key={failure.id}>{failure.name}：{errorText(new Error(failure.message), 'モデル一覧を取得できませんでした。')}</p>)}
    </div>}
    {reasoning && <M3eFormField variant="outlined">
      <label slot="label" htmlFor={effortId}>考える深さ</label>
      <M3eSelect ref={effortSelect} id={effortId} aria-label="考える深さ" value={selectedEffort} disabled={disabled || busy || loading}
        onChange={event => {
          const value = (event.currentTarget as M3eSelectElement).value
          if (current && typeof value === 'string' && reasoning.efforts.some(effort => effort.id === value)) void choose({ ...current, reasoningEffort: value })
        }}>
        {reasoning.efforts.map((effort, index) => <M3eOption key={effort.id} value={effort.id}>{reasoningEffortLabel(effort.id, index)}</M3eOption>)}
      </M3eSelect>
    </M3eFormField>}
    {busy && <p role="status">選択を反映中…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && (!catalog || catalog.failures.length > 0) && <M3eButton disabled={busy} onClick={() => { void retry() }}>もう一度読み込む</M3eButton>}
  </div>
}

export function PermissionSheet({ permissions, apply, close }: {
  permissions: PermissionProjection; apply(value: string): Promise<void>; close(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function choose(value: string) {
    if (busy) return
    setBusy(true); setError('')
    try { await apply(value); close() } catch (error) { setError(errorText(error)); setBusy(false) }
  }
  return <div className="composer-sheet"><h2>権限の選び直し</h2>
    {permissions.options.filter(option => option.value !== 'custom').map(option => <SheetRow key={option.value} icon={permissionIcon(option.value)} selected={option.value === permissions.currentValue} detail={option.description} disabled={busy} onClick={() => { void choose(option.value) }}>{option.name}</SheetRow>)}
    {error && <p role="alert">{error}</p>}
  </div>
}

export function QueueSheet({ sessionId, close }: { sessionId: string; close(): void }) {
  const { face, snapshot } = useSession(sessionId)
  const items = visibleQueue(snapshot.queue)
  const [selectedId, setSelectedId] = useState<string | undefined>(items.length === 1 ? items[0]?.id : undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = items.find(item => item.id === selectedId)
  async function act(action: QueueAction) {
    if (!face || !selected || busy) return
    setBusy(true); setError('')
    try { unwrapRemoteResult(await face.updateQueue(selected.id, action)); close() }
    catch (error) { setError(errorText(error)); setBusy(false) }
  }
  return <div className="composer-sheet"><h2>順番待ちの編集</h2>
    {!items.length && <p>順番待ちのメッセージはありません。</p>}
    {!selected ? items.map(item => <SheetRow key={item.id} detail={item.placement === 'steering' ? '割り込み待ち' : '順番待ち'} onClick={() => setSelectedId(item.id)}>{item.preview || item.text || '画像付きのメッセージ'}</SheetRow>) : <>
      <p className="composer-queue-preview">{selected.preview || selected.text || '画像付きのメッセージ'}</p>
      <SheetRow icon="edit" disabled={busy || !face} onClick={() => { if (!face) return; close(); openDialog(done => <TextPromptDialog {...queueEditPrompt(face, selected, done)} />, { label: '順番待ちのメッセージを編集' }) }}>編集</SheetRow>
      <SheetRow icon="bolt" disabled={busy || !face} onClick={() => { void act({ kind: 'steer' }) }}>今すぐ割り込ませる</SheetRow>
      <SheetRow icon="delete" disabled={busy || !face} onClick={() => { void act({ kind: 'remove' }) }}>取り消す</SheetRow>
      {items.length > 1 && <M3eButton onClick={() => setSelectedId(undefined)}>一覧に戻る</M3eButton>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}
