import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { M3eCheckbox } from '@m3e/react/checkbox'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { usePendingInteractions } from '../../dsh/interactions.ts'
import { useDsh, type SessionSummary } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { folderName, formatUpdatedAt, modelIcon } from './data.ts'
import { useRowGesture } from './gestures.ts'
import { canEditHomeSession, openHomeSession } from './session-navigation.ts'
import deepseekIcon from './model-icons/deepseek.svg'
import genericIcon from './model-icons/generic.svg'

export function SessionRow({ row, mode, selected, disabled, canMutate, first, last, onToggle, onActions, onArchive, onMove, onMoveUp, onMoveDown }: {
  row: SessionSummary; mode: 'normal' | 'sort' | 'select'; selected: boolean; disabled: boolean; canMutate: boolean; first: boolean; last: boolean
  onToggle(): void; onActions(): void; onArchive(): void; onMove(before?: string): void; onMoveUp(): void; onMoveDown(): void
}) {
  const { sessions } = useDsh()
  const editable = canEditHomeSession(row)
  const [opening, setOpening] = useState(false)
  const pendingOpen = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function open() {
    if (pendingOpen.current) return
    pendingOpen.current = true; setOpening(true)
    try { await openHomeSession(sessions, row, navigate, () => active.current) }
    catch (error) { if (active.current) showSnackbar(remoteErrorMessage(error, '子の会話を開けませんでした。読み直してお試しください。')) }
    finally { pendingOpen.current = false; if (active.current) setOpening(false) }
  }
  const pending = usePendingInteractions(row.id)
  const state = pending.length ? '返事待ち' : row.running ? '実行中' : row.completed ? '完了・未読' : ''
  const stateIcon = pending.length ? 'front_hand' : row.running ? 'progress_activity' : 'check'
  const selection = row.projectionValues?.modelSelection as { lastUsed?: unknown } | undefined
  const icon = modelIcon(selection?.lastUsed)
  const gesture = useRowGesture({ disabled: disabled || opening || (mode !== 'normal' && !editable), onClick: () => {
    if (mode === 'select' && editable) onToggle()
    else if (mode === 'normal') void open()
  }, onLongPress: mode === 'normal' && canMutate && editable ? onActions : undefined, onSwipe: mode === 'normal' && canMutate && editable ? onArchive : undefined })
  const drag = useRef<{ y: number; before?: string; active: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [destination, setDestination] = useState('')
  return <li className={`home-session ${dragging ? 'home-session-dragging' : ''}`} data-session-id={row.id}>
    {gesture.offset !== 0 && <div className="home-archive-background" aria-hidden="true"><Icon name="inventory_2" /><span>アーカイブ</span></div>}
    <div className="home-session-surface" style={{ transform: `translateX(${gesture.offset}px)` }}>
      <button type="button" className="home-session-button" {...gesture.handlers} disabled={disabled || opening || mode === 'sort' || (mode === 'select' && !editable)}
        aria-label={`${row.displayTitle}${state ? `、${state}` : ''}${editable ? '' : '、子の会話・閲覧のみ'}`} aria-pressed={mode === 'select' && editable ? selected : undefined}
        onContextMenu={event => event.preventDefault()}>
        {mode === 'select' && <span inert className="home-selection"><M3eCheckbox checked={editable && selected} disabled={!editable} tabIndex={-1} aria-hidden="true" /></span>}
        <span className="home-model-avatar" aria-hidden="true">
          {icon.kind === 'initial' ? icon.initial : <span className="home-model-glyph" style={{ '--home-model-icon': `url("${icon.kind === 'deepseek' ? deepseekIcon : genericIcon}")` } as CSSProperties} />}
          {state && <span className={`home-session-state ${pending.length ? 'home-state-pending' : ''}`}><Icon name={stateIcon} /></span>}
        </span>
        <span className="home-session-text"><strong>{row.displayTitle}</strong><small>{folderName(row.cwd)} ・ {formatUpdatedAt(row.updatedAt)}</small>
          {!editable && <small>{opening ? '子の会話を開いています…' : '子の会話・閲覧のみ'}</small>}
          {state && <span className="home-sr-only">{state}</span>}</span>
        {mode === 'normal' && <Icon name="chevron_right" className="home-row-chevron" />}
      </button>
      {mode === 'sort' && editable && <button type="button" className="home-drag-handle" aria-label={`${row.displayTitle}を並べ替え。上下キーでも移動できます`}
        disabled={disabled || !canMutate} onKeyDown={event => {
          if (event.key === 'ArrowUp' && !first) { event.preventDefault(); onMoveUp() }
          if (event.key === 'ArrowDown' && !last) { event.preventDefault(); onMoveDown() }
        }} onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return
          drag.current = { y: event.clientY, active: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={event => {
          if (!drag.current) return
          if (Math.abs(event.clientY - drag.current.y) < 8 && !drag.current.active) return
          drag.current.active = true; setDragging(true)
          const list = event.currentTarget.closest('ul')
          const candidates = [...(list?.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])].filter(node => node.dataset.sessionId !== row.id)
          const target = candidates.find(node => { const rect = node.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2 })
          drag.current.before = target?.dataset.sessionId
          setDestination(target ? `${target.querySelector('strong')?.textContent ?? ''}の前へ` : '最後へ')
          const scroll = list?.closest('[data-scroll-area]')
          if (scroll) { const rect = scroll.getBoundingClientRect(); if (event.clientY > rect.bottom - 48) scroll.scrollTop += 16; if (event.clientY < rect.top + 48) scroll.scrollTop -= 16 }
        }} onPointerUp={() => {
          const value = drag.current; drag.current = null; setDragging(false); setDestination('')
          if (value?.active) onMove(value.before)
        }} onPointerCancel={() => { drag.current = null; setDragging(false); setDestination('') }}><Icon name="drag_handle" /></button>}
    </div>
    {dragging && <span role="status" className="home-drag-destination">{destination}</span>}
  </li>
}
