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
import { useMessages } from '../../i18n/index.ts'
import { openHomeSession } from '../home/session-navigation.ts'
import { conversationChoices, conversationChoiceAvailable, CONVERSATION_CHOICE_LIMIT } from './conversation-choices.ts'
import { conversationMessages } from './messages.ts'
import './conversation-picker.css'

function ConversationPicker({ currentId, close }: { currentId: string; close: CloseOverlay }) {
  const text = useMessages(conversationMessages)
  const { sessions, workspaces } = useDsh()
  const list = useSnapshot(sessions.list)
  const workspaceList = useSnapshot(workspaces.list)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const active = useRef(true)
  const opening = useRef<AbortController | undefined>(undefined)
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
    const closing = () => { if (getOverlays().at(-1)?.close === close) { active.current = false; opening.current?.abort(); restoreAfterDismissal() } }
    sheet?.addEventListener('cancel', closing)
    sheet?.addEventListener('closing', closing)
    return () => {
      active.current = false
      opening.current?.abort()
      sheet?.removeEventListener('cancel', closing)
      sheet?.removeEventListener('closing', closing)
    }
  }, [close])
  // Native sheet closing can retain the component through its exit animation.
  // Check the logical overlay too, so Escape/swipe invalidates delayed selection.
  const isOpen = () => active.current && getOverlays().some(entry => entry.close === close)
  const dismiss = () => { active.current = false; opening.current?.abort(); restoreAfterDismissal(); close() }
  const choices = useMemo(() => conversationChoices(list, workspaceList, currentId, query, text), [list, workspaceList, currentId, query, text])
  async function choose(id: string, keyboard = false) {
    if (locked.current || !isOpen()) return
    if (id === currentId) { dismiss(); return }
    const latest = sessions.list.getSnapshot()
    const row: SessionSummary | undefined = Object.hasOwn(latest.byId, id) ? latest.byId[id] : undefined
    if (!row || !conversationChoiceAvailable(row, latest, workspaces.list.getSnapshot().archivedSessionIds)) {
      setError(text.choiceGone)
      return
    }
    locked.current = true; setBusy(true); setError('')
    opening.current?.abort()
    opening.current = new AbortController()
    let opened = false
    try {
      await openHomeSession(sessions, row, path => {
        opened = true
        focusTarget.current = keyboard ? id : undefined
        dismiss(); navigate(path)
      },
        () => isOpen() && conversationChoiceAvailable(row, sessions.list.getSnapshot(), workspaces.list.getSnapshot().archivedSessionIds), opening.current.signal)
      if (!opened && isOpen()) setError(text.choiceChanged)
    } catch (cause) {
      if (isOpen()) setError(remoteErrorMessage(cause, text.openFailed))
    } finally {
      locked.current = false
      if (isOpen()) setBusy(false)
    }
  }
  return <div ref={root} className="conversation-picker">
    <div className="conversation-picker-heading"><h2>{text.pickerTitle}</h2><M3eButton onClick={dismiss}>{text.close}</M3eButton></div>
    <M3eSearchBar clearable clearLabel={text.searchClear} onClear={() => setQuery('')}>
      <Icon name="search" slot="leading" />
      <input slot="input" type="search" aria-label={text.searchPlaceholder} placeholder={text.searchPlaceholder} autoComplete="off" enterKeyHint="search"
        value={query} disabled={busy} onChange={event => setQuery(event.currentTarget.value)} />
    </M3eSearchBar>
    {busy && <p role="status">{text.opening}</p>}
    {error && <p role="alert" className="conversation-picker-error">{error}</p>}
    {list.phase === 'pending' && <p role="status">{text.loadingList}</p>}
    {choices.total > CONVERSATION_CHOICE_LIMIT && <p className="conversation-picker-hint">{text.limitNotice(choices.total, CONVERSATION_CHOICE_LIMIT)}</p>}
    {!choices.total && list.phase !== 'pending' && <p role="status">{query.trim() ? text.noMatch : text.noChoices}</p>}
    <ul className="conversation-picker-list" aria-label={text.listLabel}>
      {choices.items.map(({ row, workspaceTitle }) => <li key={row.id}>
        <button type="button" className="conversation-picker-row" disabled={busy} aria-current={row.id === currentId ? 'page' : undefined}
          onClick={event => { void choose(row.id, event.detail === 0) }}>
          <Icon name={row.id === currentId ? 'check' : row.origin === 'subagent' ? 'account_tree' : 'chat_bubble'} />
          <span><strong>{row.displayTitle}</strong><small>{text.rowDescription(workspaceTitle, row.origin === 'subagent', row.running, row.id === currentId)}</small></span>
        </button>
      </li>)}
    </ul>
  </div>
}

export function ConversationPickerButton({ sessionId }: { sessionId: string }) {
  const text = useMessages(conversationMessages)
  const closeRef = useRef<CloseOverlay | undefined>(undefined)
  const overlays = useOverlays()
  const opened = overlays.some(entry => entry.close === closeRef.current)
  useEffect(() => () => { closeRef.current?.() }, [])
  return <M3eIconButton className="conversation-picker-trigger" data-session-id={sessionId} aria-label={text.pickerTitle} aria-haspopup="dialog" aria-expanded={opened} onClick={() => {
    if (getOverlays().some(entry => entry.close === closeRef.current)) return
    closeRef.current = openSheet(close => <ConversationPicker currentId={sessionId} close={close} />, { label: text.pickerTitle, owner: { kind: 'conversation', sessionId } })
  }}><Icon name="forum" /></M3eIconButton>
}
