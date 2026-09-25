import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { M3eSearchBar } from '@m3e/react/search'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import { buildTrace, filterTrace, rowDescription, turnHeading, type TraceKind, type TraceRow } from './model.ts'
import { RecordSheet } from './RecordSheet.tsx'
import { isTraceAtBottom, traceScrollAction, type TraceScrollTrigger } from './scroll-policy.ts'
import './trace.css'

const icons: Record<TraceKind, string> = { user: 'person', assistant: 'smart_toy', tool: 'terminal', subtool: 'subdirectory_arrow_right', compaction: 'summarize' }
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
  const { face, snapshot, records, stream } = useSession(sessionId)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const turns = useMemo(() => buildTrace(records, stream, snapshot.running), [records, stream, snapshot.running])
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
    } else if (action === 'bottom') {
      node.scrollTop = node.scrollHeight
      initialized.current = true
    }
  }

  useEffect(() => () => closeSheet.current?.(), [])
  useLayoutEffect(() => {
    const activating = active && !wasActive.current
    wasActive.current = active
    if (!active) {
      // A pending prepend must not compete with the shell's restoration later.
      anchor.current = null
      return
    }
    // The parent restores its snapshot after child layout effects. Defer the
    // first activation to passive setup so even a previously empty panel wins.
    if (!activating) updateScroll('content')
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
    if (!current.current.active) return
    setQuery(value)
    follow.current = false
    if (scroll.current) scroll.current.scrollTop = 0
  }
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
    closeSheet.current?.()
    closeSheet.current = openSheet(close => <RecordSheet sessionId={sessionId} initialRow={row} close={close} />,
      { label: '記録の詳細', sessionId })
  }

  return <section className="trace-view" aria-label="トレース">
    <div className="trace-scroll" ref={scroll} data-scroll-area onScroll={active ? () => {
      if (!current.current.active) return
      const node = scroll.current
      if (node && !anchor.current) follow.current = isTraceAtBottom(node.scrollTop, node.scrollHeight, node.clientHeight)
    } : undefined}>
      <div className="trace-body" ref={body}>
        {snapshot.hasMore && <div className="trace-older"><M3eButton variant="text" disabled={!active || loading || snapshot.loadingOlder} onClick={() => { void loadOlder() }}>
          <Icon name="expand_less" slot="icon" />{loading || snapshot.loadingOlder ? '読み込み中…' : '前の記録を読み込む'}
        </M3eButton></div>}
        {loadError && <p className="trace-error" role="alert">{loadError}</p>}
        {!turns.length && <p className="trace-empty">まだ記録がありません。</p>}
        {query.trim() && count === 0 && <p className="trace-empty" role="status">一致する記録がありません。</p>}
        {filtered.map(turn => <section className="trace-turn" key={turn.id} aria-label={turnHeading(turn)}>
          <h2>{turnHeading(turn)}</h2>
          {turn.termination && <p className={turn.termination.kind === 'error' ? 'trace-error' : 'trace-note'}>{turn.termination.message}</p>}
          {turn.partial && <p className="trace-partial">開始前の記録は未読み込みです。</p>}
          <M3eActionList aria-label={turn.number === null ? '記録' : `ターン ${turn.number} の記録`}>
            {turn.rows.map(row => <M3eListAction key={row.id} className={`trace-row${row.failed ? ' trace-row-error' : ''}`}
              disabled={!active}
              style={{ marginInlineStart: Math.min(row.depth, 4) * 16 }} data-trace-row={row.id}
              onClick={() => showRecord(row)} aria-label={`${row.title}、${rowDescription(row)}、詳細を開く`}>
              <Icon name={icons[row.kind]} slot="leading" />
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
}
