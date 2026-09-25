import { useState, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eSwitch } from '@m3e/react/switch'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, TextPromptDialog } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { QueueAction } from '../../dsh/services.ts'
import type { ModelCatalog, ModelSelection, PermissionProjection } from './api.ts'
import { visibleQueue } from './helpers.ts'
import { queueEditPrompt } from './queue-edit.ts'

export function errorText(error: unknown, fallback = '処理に失敗しました。もう一度お試しください。'): string {
  // Local validation errors are authored in Japanese; host diagnostics use the shared translator.
  if (error instanceof Error && /^[ぁ-んァ-ヶ一-龠]/.test(error.message)) return error.message
  return remoteErrorMessage(error, fallback)
}
export function SheetRow({ icon, children, detail, selected, disabled, onClick }: {
  icon?: string; children: ReactNode; detail?: string; selected?: boolean; disabled?: boolean; onClick(): void
}) {
  return <button type="button" className="composer-sheet-row" disabled={disabled} onClick={onClick} aria-pressed={selected}>
    {icon && <Icon name={icon} />}<span>{children}{detail && <small>{detail}</small>}</span>{selected && <Icon name="check" />}
  </button>
}

export function PlusSheet({ close, plan, disabled, modelName, onImage, onReference, onCommand, onModel, onPlan }: {
  close(): void; plan: boolean; disabled: boolean; modelName: string
  onImage(): void; onReference(): void; onCommand(): void; onModel(): void; onPlan(active: boolean): Promise<void>
}) {
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
    <SheetRow icon="add_photo_alternate" onClick={() => choose(onImage)}>画像を添付</SheetRow>
    <SheetRow icon="alternate_email" onClick={() => choose(onReference)}>ファイルを参照</SheetRow>
    <SheetRow icon="terminal" onClick={() => choose(onCommand)}>コマンド</SheetRow>
    <div className="composer-switch-row"><Icon name="edit_note" /><span>計画モード</span><M3eSwitch aria-label="計画モード" checked={active} disabled={disabled || busy} onChange={() => { void toggle() }} /></div>
    <SheetRow icon="neurology" detail={modelName} disabled={disabled || busy} onClick={() => choose(onModel)}>モデル</SheetRow>
    {error && <p role="alert">{error}</p>}
  </div>
}

const effortNames: Record<string, string> = { none: 'なし', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: 'とても高い', max: '最大' }
export function ModelSheet({ catalog, selected, apply, close }: {
  catalog: ModelCatalog; selected: ModelSelection | null | undefined; apply(selection: ModelSelection): Promise<void>; close(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function choose(selection: ModelSelection) {
    if (busy) return
    setBusy(true); setError('')
    try { await apply(selection); close() } catch (error) { setError(errorText(error)); setBusy(false) }
  }
  return <div className="composer-sheet"><h2>モデルの選択</h2>
    {catalog.failures.length > 0 && <p role="status">一部のモデル一覧を取得できませんでした。</p>}
    {catalog.groups.length === 0 && <p>選べるモデルがありません。</p>}
    {catalog.groups.map(group => <section key={group.id}><h3>{group.name}</h3>
      {group.models.map(model => {
        const isSelected = selected?.provider === group.id && selected.model === model.id
        return <div key={model.id}>
          <SheetRow selected={isSelected} disabled={busy} onClick={() => { void choose({ provider: group.id, model: model.id }) }}>{model.name}</SheetRow>
          {isSelected && model.reasoning && <fieldset className="composer-efforts" disabled={busy}><legend>考える深さ</legend>
            {model.reasoning.efforts.map(effort => <M3eButton key={effort.id} variant={(selected.reasoningEffort ?? model.reasoning?.defaultEffort) === effort.id ? 'filled' : 'tonal'} onClick={() => { void choose({ provider: group.id, model: model.id, reasoningEffort: effort.id }) }}>{effortNames[effort.id] ?? '追加の深さ'}</M3eButton>)}
          </fieldset>}
        </div>
      })}
    </section>)}
    {error && <p role="alert">{error}</p>}
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
    {permissions.options.filter(option => option.value !== 'custom').map(option => <SheetRow key={option.value} selected={option.value === permissions.currentValue} detail={option.description} disabled={busy} onClick={() => { void choose(option.value) }}>{option.name}</SheetRow>)}
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
