import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { M3eSearchBar } from '@m3e/react/search'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import { selectTrace, filterTrace, rowDescription, traceRowIcon, turnHeading, type TraceRow } from './model.ts'
import { RecordSheet } from './RecordSheet.tsx'
import { isTraceAtBottom, traceFollowAfterScroll, traceScrollAction, type TraceScrollTrigger } from './scroll-policy.ts'
import { retainTraceSession, traceEmptyMessage, type TraceSessionData } from './view-state.ts'
import { closeTraceSheet } from './sheet-lifecycle.ts'
import './trace.css'

interface ScrollAnchor { id?: string; offset: number; height: number; top: number }
function restoreAnchor(node: HTMLDivElement, saved: ScrollAnchor) {
  const row = [...node.querySelectorAll<HTMLElement>('[data-trace-row]')].find(item => item.dataset.traceRow === saved.id)
  node.scrollTop = row ? node.scrollTop + row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset
    : saved.top + node.scrollHeight - saved.height
}

export function TraceView({ sessionId, active }: { sessionId: string; active: boolean }) {
  return <TraceSession key={sessionId} sessionId={sessionId} active={active} />
}

function TraceSession({ sessionId, active }: { sessionId: string; active: boolean }) {
  const session = useSession(sessionId)
  const retained = useRef<TraceSessionData | null>(null)
  retained.current = retainTraceSession(retained.current, session, active)
  // Mount the panel on its first visible visit, then preserve its state and DOM.
  return retained.current && <TracePanel sessionId={sessionId} active={active} data={retained.current} />
}

const TracePanel = memo(function TracePanel({ sessionId, active, data }: { sessionId: string; active: boolean; data: TraceSessionData }) {
  const { face, snapshot, records, stream } = data
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const turns = useMemo(() => selectTrace(records, stream, snapshot.running), [records, stream, snapshot.running])
  const filtered = useMemo(() => filterTrace(turns, query), [turns, query])
  const count = filtered.reduce((total, turn) => total + turn.rows.length, 0)
  const scroll = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const initialized = useRef(false)
  const anchor = useRef<ScrollAnchor | null>(null)
  const busy = useRef(false)
  const closeSheet = useRef<(() => void) | undefined>(undefined)
  const current = useRef({ active, query, hasRows: false, loadingOlder: false })
  current.current = { active, query, hasRows: turns.some(turn => turn.rows.length > 0), loadingOlder: loading || snapshot.loadingOlder }
  const wasActive = useRef(false)
  const searchChanged = useRef(false)
  const touchStartY = useRef<number | null>(null)

  const updateScroll = (trigger: TraceScrollTrigger) => {
    // Guard before accessing dimensions, including callbacks already in the queue.
    const state = current.current
    if (!state.active) return
    const node = scroll.current
    if (!node) return
    const action = traceScrollAction({
      active: state.active, initialized: initialized.current, hasRows: state.hasRows,
      visible: node.clientHeight > 0, following: follow.current, searching: !!state.query.trim(),
      hasAnchor: anchor.current !== null, loadingOlder: state.loadingOlder || busy.current,
    }, trigger)
    if (action === 'anchor' && anchor.current) {
      restoreAnchor(node, anchor.current)
      anchor.current = null
    } else if (action === 'top') {
      node.scrollTop = 0
    } else if (action === 'bottom') {
      node.scrollTop = node.scrollHeight
      initialized.current = true
    }
  }

  // Tab changes preserve this panel. Release its sheet on hiding as well as on
  // route/session unmount, in the layout phase before the destination paints.
  useLayoutEffect(() => () => closeTraceSheet(closeSheet), [active])
  useLayoutEffect(() => {
    const activating = active && !wasActive.current
    wasActive.current = active
    if (!active) {
      // A pending prepend must not compete with the shell's restoration later.
      anchor.current = null
      searchChanged.current = false
      touchStartY.current = null
      return
    }
    // The parent restores its snapshot after child layout effects. Defer the
    // first activation to passive setup so even a previously empty panel wins.
    if (!activating) updateScroll(searchChanged.current ? 'search' : 'content')
    searchChanged.current = false
  }, [active, turns, query, loading, snapshot.loadingOlder])

  useEffect(() => {
    if (!active) return
    const node = scroll.current, content = body.current
    if (!node || !content) return
    // Passive setup runs after the parent's synchronous scroll restoration.
    // Read the restored position without writing it, then resume from there.
    if (initialized.current) follow.current = isTraceAtBottom(node.scrollTop, node.scrollHeight, node.clientHeight)
    updateScroll('activation')
    let firstNotification = true
    let disposed = false
    const observer = new ResizeObserver(() => {
      if (disposed || !current.current.active) return
      // observe() reports the initial size even when nothing changed. That
      // notification must not undo a restored position on tab reactivation.
      updateScroll(firstNotification ? 'activation' : 'resize')
      firstNotification = false
    })
    observer.observe(node)
    observer.observe(content)
    return () => { disposed = true; observer.disconnect() }
  }, [active])

  const changeQuery = (value: string) => {
    if (!current.current.active || value === current.current.query) return
    searchChanged.current = true
    anchor.current = null
    follow.current = !value.trim()
    setQuery(value)
  }
  const stopFollowing = () => { follow.current = traceFollowAfterScroll(follow.current, false, 'user-up') }
  const loadOlder = async () => {
    if (!current.current.active) return
    const node = scroll.current
    if (!face || busy.current || snapshot.loadingOlder || !snapshot.hasMore || !node) return
    busy.current = true
    follow.current = false
    const top = node.getBoundingClientRect().top
    const row = [...node.querySelectorAll<HTMLElement>('[data-trace-row]')].find(item => item.getBoundingClientRect().bottom > top)
    anchor.current = { id: row?.dataset.traceRow, offset: row ? row.getBoundingClientRect().top - top : 0, height: node.scrollHeight, top: node.scrollTop }
    setLoading(true)
    setLoadError('')
    try { await face.loadOlder() }
    catch { setLoadError('前の記録を読み込めませんでした。もう一度お試しください。') }
    finally { busy.current = false; setLoading(false) }
  }
  const showRecord = (row: TraceRow) => {
    if (!current.current.active) return
    closeTraceSheet(closeSheet)
    closeSheet.current = openSheet(close => <RecordSheet sessionId={sessionId} initialRow={row} close={close} />,
      { label: '記録の詳細', sessionId })
  }

  return <section className="trace-view" aria-label="トレース">
    <div className="trace-scroll" ref={scroll} data-scroll-area
      onWheel={active ? event => { if (event.deltaY < 0) stopFollowing() } : undefined}
      onTouchStart={active ? event => { touchStartY.current = event.touches[0]?.clientY ?? null } : undefined}
      onTouchMove={active ? event => { if (touchStartY.current !== null && (event.touches[0]?.clientY ?? touchStartY.current) > touchStartY.current) stopFollowing() } : undefined}
      onTouchEnd={active ? () => { touchStartY.current = null } : undefined}
      onTouchCancel={active ? () => { touchStartY.current = null } : undefined}
      onKeyDown={active ? event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) stopFollowing() } : undefined}
      onPointerDown={active ? event => { const node = scroll.current; if (node && event.target === node && event.clientX >= node.getBoundingClientRect().right - 20) stopFollowing() } : undefined}
      onScroll={active ? () => {
      if (!current.current.active) return
      const node = scroll.current
      if (node && !anchor.current) follow.current = traceFollowAfterScroll(follow.current,
        isTraceAtBottom(node.scrollTop, node.scrollHeight, node.clientHeight), 'scroll')
    } : undefined}>
      <div className="trace-body" ref={body}>
        {snapshot.hasMore && <div className="trace-older"><M3eButton variant="text" disabled={!active || loading || snapshot.loadingOlder} onClick={() => { void loadOlder() }}>
          <Icon name="expand_less" slot="icon" />{loading || snapshot.loadingOlder ? '読み込み中…' : '前の記録を読み込む'}
        </M3eButton></div>}
        {loadError && <p className="trace-error" role="alert">{loadError}</p>}
        {!turns.length && <p className="trace-empty" role="status">{traceEmptyMessage(snapshot.openState)}</p>}
        {turns.length > 0 && query.trim() && count === 0 && <p className="trace-empty" role="status">一致する記録がありません。</p>}
        {filtered.map(turn => <section className="trace-turn" key={turn.id} aria-label={turnHeading(turn)}>
          <h2>{turnHeading(turn)}</h2>
          {turn.termination && <p className={turn.termination.kind === 'error' ? 'trace-error' : 'trace-note'}>{turn.termination.message}</p>}
          {turn.partial && <p className="trace-partial">開始前の記録は未読み込みです。</p>}
          <M3eActionList aria-label={turn.number === null ? '記録' : `ターン ${turn.number} の記録`}>
            {turn.rows.map(row => <M3eListAction key={row.id} className={`trace-row${row.failed ? ' trace-row-error' : ''}`}
              disabled={!active}
              style={{ marginInlineStart: `calc(var(--app-space) * ${Math.min(row.depth, 4)})` }} data-trace-row={row.id}
              onClick={() => showRecord(row)} aria-label={`${row.title}、${rowDescription(row)}、詳細を開く`}>
              <Icon name={traceRowIcon(row)} slot="leading" />
              <span className="trace-row-title">{row.title}</span>
              <span slot="supporting-text" className="trace-row-description">{rowDescription(row)}</span>
              <Icon name={row.failed ? 'error' : row.running ? 'pending' : 'chevron_right'} slot="trailing" />
            </M3eListAction>)}
          </M3eActionList>
        </section>)}
      </div>
    </div>
    <footer className="conversation-footer trace-search" inert={!active}>
      {query.trim() && <p className="trace-search-count" role="status">読み込み済みの記録から {count} 件</p>}
      <M3eSearchBar clearable={active} clearLabel="検索を消す" onClear={() => changeQuery('')}>
        <Icon name="search" slot="leading" />
        <input slot="input" type="search" disabled={!active} aria-label="記録を検索" placeholder="種類・ツール名・本文で検索" value={query}
          onChange={event => changeQuery(event.target.value)} />
      </M3eSearchBar>
    </footer>
  </section>
})
