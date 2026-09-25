import { Fragment, useLayoutEffect, useRef } from 'react'
import { M3eSearchBar } from '@m3e/react/search'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { M3eButton } from '@m3e/react/button'
import { M3eLinearProgressIndicator } from '@m3e/react/progress-indicator'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { useDsh, type SessionSummary } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { searchControllerFor } from './search-controller.ts'
import { findMatchRanges, selectRecentSessions } from './search-utils.ts'
import './search.css'

function Highlight({ text, query }: { text: string; query: string }) {
  let end = 0
  const parts = findMatchRanges(text, query).map((range) => {
    const before = text.slice(end, range.start)
    end = range.end
    return <Fragment key={range.start}>{before}<strong>{text.slice(range.start, range.end)}</strong></Fragment>
  })
  return <>{parts}{text.slice(end)}</>
}

function sessionDetails(row: SessionSummary | undefined): string {
  const folder = row?.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || '作業フォルダ未設定'
  const date = row && Number.isFinite(row.updatedAt) ? new Date(row.updatedAt) : null
  const updated = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
    : '更新日時不明'
  return `${folder} ・ ${updated}`
}

function ModelIcon({ row }: { row: SessionSummary | undefined }) {
  const selection = row?.projectionValues?.modelSelection
  const lastUsed = selection && typeof selection === 'object' && 'lastUsed' in selection ? selection.lastUsed : null
  const model = lastUsed && typeof lastUsed === 'object' && 'model' in lastUsed && typeof lastUsed.model === 'string'
    ? lastUsed.model.trim() : ''
  return <span slot="leading" className="search-session-icon" aria-hidden="true">
    {model ? Array.from(model)[0]?.toLocaleUpperCase() : <Icon name="chat_bubble" />}
  </span>
}

export function SearchScreen() {
  const { sessions } = useDsh()
  const controller = searchControllerFor(sessions)
  const state = useSnapshot(controller)
  const list = useSnapshot(sessions.list)
  const root = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const recent = selectRecentSessions(list.ids.flatMap(id => list.byId[id] ? [list.byId[id]!] : []))
  const busy = state.phase === 'waiting' || state.phase === 'loading'

  useLayoutEffect(() => {
    const area = root.current?.closest<HTMLElement>('[data-scroll-area]')
    const saved = controller.getScrollTop()
    if (area) area.scrollTop = saved
    // M3E's initial element rendering completes before the next frame.
    const frame = requestAnimationFrame(() => { if (area) area.scrollTop = saved })
    const saveScroll = () => { if (area) controller.setScrollTop(area.scrollTop) }
    area?.addEventListener('scroll', saveScroll, { passive: true })
    controller.resume()
    return () => {
      cancelAnimationFrame(frame)
      saveScroll()
      area?.removeEventListener('scroll', saveScroll)
      controller.suspend()
    }
  }, [controller])

  const change = (value: string, isComposing = composing.current) => {
    const area = root.current?.closest<HTMLElement>('[data-scroll-area]')
    if (area) area.scrollTop = 0
    controller.setInput(value, isComposing)
  }
  const rows = state.query ? state.items : recent.map(row => ({ sessionId: row.id, snippet: '' }))

  return <TabScaffold title="検索">
    <div ref={root} className="search-screen">
      <div className="search-bar-area">
        <M3eSearchBar clearable clearLabel="検索語を消去" onClear={() => { composing.current = false; change('', false) }}>
          <Icon name="search" slot="leading" />
          <input slot="input" type="search" aria-label="セッションを検索" placeholder="セッションを検索"
            autoComplete="off" enterKeyHint="search" value={state.input}
            onChange={event => change(event.currentTarget.value)}
            onCompositionStart={event => { composing.current = true; change(event.currentTarget.value, true) }}
            onCompositionEnd={event => { composing.current = false; change(event.currentTarget.value, false) }} />
        </M3eSearchBar>
        <div className="search-progress">
          {busy && <M3eLinearProgressIndicator mode="indeterminate" aria-label="検索中" />}
        </div>
      </div>
      <div className="search-results" aria-busy={busy}>
        <h2>{state.query ? `「${state.query}」の検索結果` : '最近のセッション'}</h2>
        <div role="status" aria-live="polite" aria-atomic="true" className="search-status">
          {busy && <p>検索しています…</p>}
          {state.phase === 'ready' && rows.length === 0 && <p>見つかりませんでした</p>}
          {state.phase === 'ready' && rows.length > 0 && <span className="search-visually-hidden">{rows.length} 件見つかりました</span>}
          {!state.query && rows.length === 0 && <p>{list.phase === 'pending' ? 'セッションを読み込んでいます…' : '最近のセッションはありません'}</p>}
        </div>
        {state.phase === 'error' && <div role="alert" className="search-error">
          <p>検索できませんでした</p><p>{state.error}</p>
          <M3eButton variant="tonal" onClick={() => controller.retry()}>もう一度検索</M3eButton>
        </div>}
        {rows.length > 0 && <M3eActionList aria-label={state.query ? '検索結果' : '最近のセッション'}>
          {rows.map(item => {
            const row = list.byId[item.sessionId]
            return <M3eListAction key={item.sessionId} onClick={() => navigate(`/s/${encodeURIComponent(item.sessionId)}`)}>
              <ModelIcon row={row} />
              <span className="search-title">{row?.displayTitle || row?.title || '題名のないセッション'}</span>
              <span slot="supporting-text" className="search-snippet">
                {item.snippet?.trim() ? <Highlight text={item.snippet} query={state.query} /> : sessionDetails(row)}
              </span>
            </M3eListAction>
          })}
        </M3eActionList>}
        {state.phase === 'ready' && state.hasMore && <p className="search-more">さらに結果があります。語を増やして絞り込んでください</p>}
      </div>
    </div>
  </TabScaffold>
}
