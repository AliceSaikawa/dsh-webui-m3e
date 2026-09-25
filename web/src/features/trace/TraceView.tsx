import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { M3eSearchBar } from '@m3e/react/search'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import { buildTrace, filterTrace, rowDescription, turnHeading, type TraceKind, type TraceRow } from './model.ts'
import { RecordSheet } from './RecordSheet.tsx'
import './trace.css'

const icons: Record<TraceKind, string> = { user: 'person', assistant: 'smart_toy', tool: 'terminal', subtool: 'subdirectory_arrow_right', compaction: 'summarize' }
interface ScrollAnchor { id?: string; offset: number; height: number; top: number }
function restoreAnchor(node: HTMLDivElement, saved: ScrollAnchor) {
  const row = [...node.querySelectorAll<HTMLElement>('[data-trace-row]')].find(item => item.dataset.traceRow === saved.id)
  node.scrollTop = row ? node.scrollTop + row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset
    : saved.top + node.scrollHeight - saved.height
}

export function TraceView({ sessionId }: { sessionId: string }) {
  return <TraceSession key={sessionId} sessionId={sessionId} />
}

function TraceSession({ sessionId }: { sessionId: string }) {
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
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => () => closeSheet.current?.(), [])
  useLayoutEffect(() => {
    const node = scroll.current
    if (!node || node.clientHeight === 0) return
    if (anchor.current && !snapshot.loadingOlder && !loading) {
      restoreAnchor(node, anchor.current)
      anchor.current = null
    } else if (!anchor.current && (!initialized.current || (follow.current && !query))) {
      node.scrollTop = node.scrollHeight
      initialized.current = true
    }
  }, [turns, query, loading, snapshot.loadingOlder])

  useEffect(() => {
    const node = scroll.current, content = body.current
    if (!node || !content) return
    // Hidden conversation panels have zero height. Initialize when first visible.
    const observer = new ResizeObserver(() => {
      if (!node.clientHeight) return
      if (anchor.current) {
        if (!busy.current) { restoreAnchor(node, anchor.current); anchor.current = null }
        return
      }
      if (!initialized.current || (follow.current && !queryRef.current)) {
        node.scrollTop = node.scrollHeight
        initialized.current = true
      }
    })
    observer.observe(node)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const changeQuery = (value: string) => {
    setQuery(value)
    follow.current = false
    if (scroll.current) scroll.current.scrollTop = 0
  }
  const loadOlder = async () => {
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
    closeSheet.current?.()
    closeSheet.current = openSheet(close => <RecordSheet sessionId={sessionId} initialRow={row} close={close} />,
      { label: '記録の詳細', sessionId })
  }

  return <section className="trace-view" aria-label="トレース">
    <div className="trace-scroll" ref={scroll} data-scroll-area onScroll={() => {
      const node = scroll.current
      if (node && node.clientHeight > 0 && !anchor.current) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
    }}>
      <div className="trace-body" ref={body}>
        {snapshot.hasMore && <div className="trace-older"><M3eButton variant="text" disabled={loading || snapshot.loadingOlder} onClick={() => { void loadOlder() }}>
          <Icon name="expand_less" slot="icon" />{loading || snapshot.loadingOlder ? '読み込み中…' : '前の記録を読み込む'}
        </M3eButton></div>}
        {loadError && <p className="trace-error" role="alert">{loadError}</p>}
        {!turns.length && <p className="trace-empty">まだ記録がありません。</p>}
        {query.trim() && count === 0 && <p className="trace-empty" role="status">一致する記録がありません。</p>}
        {filtered.map(turn => <section className="trace-turn" key={turn.id} aria-label={turnHeading(turn)}>
          <h2>{turnHeading(turn)}</h2>
          {turn.partial && <p className="trace-partial">開始前の記録は未読み込みです。</p>}
          <M3eActionList aria-label={turn.number === null ? '記録' : `ターン ${turn.number} の記録`}>
            {turn.rows.map(row => <M3eListAction key={row.id} className={`trace-row${row.failed ? ' trace-row-error' : ''}`}
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
    <footer className="conversation-footer trace-search">
      {query.trim() && <p className="trace-search-count" role="status">読み込み済みの記録から {count} 件</p>}
      <M3eSearchBar clearable clearLabel="検索を消す" onClear={() => changeQuery('')}>
        <Icon name="search" slot="leading" />
        <input slot="input" type="search" aria-label="記録を検索" placeholder="種類・ツール名・本文で検索" value={query}
          onChange={event => changeQuery(event.target.value)} />
      </M3eSearchBar>
    </footer>
  </section>
}
