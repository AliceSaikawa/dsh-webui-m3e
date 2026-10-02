import { useEffect, useMemo, useRef, useState } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eButton } from '@m3e/react/button'
import { M3eSearchBar } from '@m3e/react/search'
import type { M3eBottomSheetElement } from '@m3e/web/bottom-sheet'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet, useOverlays, type CloseOverlay } from '../../app/overlay/index.ts'
import { getOverlays } from '../../app/overlay/store.ts'
import { hideSheet } from '../../app/overlay/presentation.ts'
import { navigate } from '../../app/router.ts'
import { useDsh, type SessionSummary } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { openHomeSession } from '../home/session-navigation.ts'
import { conversationChoices, conversationChoiceAvailable, CONVERSATION_CHOICE_LIMIT } from './conversation-choices.ts'
import './conversation-picker.css'

function ConversationPicker({ currentId, close }: { currentId: string; close: CloseOverlay }) {
  const { sessions, workspaces } = useDsh()
  const list = useSnapshot(sessions.list)
  const workspaceList = useSnapshot(workspaces.list)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const active = useRef(true)
  const root = useRef<HTMLDivElement>(null)
  const focusTarget = useRef<string | undefined>(currentId)
  const focusPending = useRef(false)
  const restoreAfterDismissal = () => {
    const sheet = root.current?.closest('m3e-bottom-sheet') as M3eBottomSheetElement | null
    if (!sheet || focusPending.current) return
    focusPending.current = true
    // The completion promise survives retained-content unmount. A native toggle
    // listener owned by this effect could be removed before its queued event.
    void hideSheet(sheet).then(() => requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.conversation-picker-trigger')
      if (focusTarget.current && target?.dataset.sessionId === focusTarget.current && document.activeElement === document.body && !getOverlays().length) target.focus({ preventScroll: true })
    }))
  }
  useEffect(() => {
    active.current = true
    const sheet = root.current?.closest('m3e-bottom-sheet')
    // Native dismissal starts before OverlayHost removes the logical entry.
    // Hiding underneath another overlay is an interruption, not a dismissal.
    const closing = () => { if (getOverlays().at(-1)?.close === close) { active.current = false; restoreAfterDismissal() } }
    sheet?.addEventListener('cancel', closing)
    sheet?.addEventListener('closing', closing)
    return () => {
      active.current = false
      sheet?.removeEventListener('cancel', closing)
      sheet?.removeEventListener('closing', closing)
    }
  }, [close])
  // Native sheet closing can retain the component through its exit animation.
  // Check the logical overlay too, so Escape/swipe invalidates delayed selection.
  const isOpen = () => active.current && getOverlays().some(entry => entry.close === close)
  const dismiss = () => { active.current = false; restoreAfterDismissal(); close() }
  const choices = useMemo(() => conversationChoices(list, workspaceList, currentId, query), [list, workspaceList, currentId, query])
  async function choose(id: string, keyboard = false) {
    if (locked.current || !isOpen()) return
    if (id === currentId) { dismiss(); return }
    const latest = sessions.list.getSnapshot()
    const row: SessionSummary | undefined = Object.hasOwn(latest.byId, id) ? latest.byId[id] : undefined
    if (!row || !conversationChoiceAvailable(row, latest, workspaces.list.getSnapshot().archivedSessionIds)) {
      setError('この会話は一覧からなくなりました。選び直してください。')
      return
    }
    locked.current = true; setBusy(true); setError('')
    let opened = false
    try {
      await openHomeSession(sessions, row, path => {
        opened = true
        focusTarget.current = keyboard ? id : undefined
        dismiss(); navigate(path)
      },
        () => isOpen() && conversationChoiceAvailable(row, sessions.list.getSnapshot(), workspaces.list.getSnapshot().archivedSessionIds))
      if (!opened && isOpen()) setError('会話の状態が変わりました。一覧から選び直してください。')
    } catch (cause) {
      if (isOpen()) setError(remoteErrorMessage(cause, '会話を開けませんでした。もう一度お試しください。'))
    } finally {
      locked.current = false
      if (isOpen()) setBusy(false)
    }
  }
  return <div ref={root} className="conversation-picker">
    <div className="conversation-picker-heading"><h2>会話を切り替え</h2><M3eButton onClick={dismiss}>閉じる</M3eButton></div>
    <M3eSearchBar clearable clearLabel="会話名の検索を消去" onClear={() => setQuery('')}>
      <Icon name="search" slot="leading" />
      <input slot="input" type="search" aria-label="会話名で検索" placeholder="会話名で検索" autoComplete="off" enterKeyHint="search"
        value={query} disabled={busy} onChange={event => setQuery(event.currentTarget.value)} />
    </M3eSearchBar>
    {busy && <p role="status">会話を開いています…</p>}
    {error && <p role="alert" className="conversation-picker-error">{error}</p>}
    {list.phase === 'pending' && <p role="status">一覧を読み込んでいます…</p>}
    {choices.total > CONVERSATION_CHOICE_LIMIT && <p className="conversation-picker-hint">{choices.total} 件中、先頭 {CONVERSATION_CHOICE_LIMIT} 件を表示しています。会話名で絞り込めます。</p>}
    {!choices.total && list.phase !== 'pending' && <p role="status">{query.trim() ? '一致する会話がありません。' : '切り替えられる会話がありません。'}</p>}
    <ul className="conversation-picker-list" aria-label="切り替える会話">
      {choices.items.map(({ row, workspaceTitle }) => <li key={row.id}>
        <button type="button" className="conversation-picker-row" disabled={busy} aria-current={row.id === currentId ? 'page' : undefined}
          onClick={event => { void choose(row.id, event.detail === 0) }}>
          <Icon name={row.id === currentId ? 'check' : row.origin === 'subagent' ? 'account_tree' : 'chat_bubble'} />
          <span><strong>{row.displayTitle}</strong><small>{workspaceTitle}{row.origin === 'subagent' ? ' ・ 子の会話' : ''}{row.running ? ' ・ 実行中' : ''}{row.id === currentId ? ' ・ 開いている会話' : ''}</small></span>
        </button>
      </li>)}
    </ul>
  </div>
}

export function ConversationPickerButton({ sessionId }: { sessionId: string }) {
  const closeRef = useRef<CloseOverlay | undefined>(undefined)
  const overlays = useOverlays()
  const opened = overlays.some(entry => entry.close === closeRef.current)
  useEffect(() => () => { closeRef.current?.() }, [])
  return <M3eIconButton className="conversation-picker-trigger" data-session-id={sessionId} aria-label="会話を切り替え" aria-haspopup="dialog" aria-expanded={opened} onClick={() => {
    if (getOverlays().some(entry => entry.close === closeRef.current)) return
    closeRef.current = openSheet(close => <ConversationPicker currentId={sessionId} close={close} />, { label: '会話を切り替え', owner: { kind: 'conversation', sessionId } })
  }}><Icon name="forum" /></M3eIconButton>
}
