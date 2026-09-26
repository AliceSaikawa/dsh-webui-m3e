import { Fragment, useLayoutEffect, useMemo, useRef } from 'react'
import { M3eSearchBar } from '@m3e/react/search'
import { M3eActionList, M3eListAction, type M3eListActionElement } from '@m3e/react/list'
import { M3eButton } from '@m3e/react/button'
import { M3eLinearProgressIndicator } from '@m3e/react/progress-indicator'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { useDsh, type SessionSummary } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { isSearchBusy, searchControllerFor } from './search-controller.ts'
import { findMatchRanges, normalizeQuery } from './search-utils.ts'
import { filterVisibleSearchItems, selectVisibleRecentSessions } from './search-visibility.ts'
import { connectSearchScroll } from './search-scroll.ts'
import { SearchModelIcon } from './SearchModelIcon.tsx'
import { useHomePreferences } from '../home/preferences.ts'
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

export function SearchScreen() {
  const { sessions, workspaces } = useDsh()
  const controller = searchControllerFor(sessions)
  const state = useSnapshot(controller)
  const list = useSnapshot(sessions.list)
  const workspaceList = useSnapshot(workspaces.list)
  const { showSubagents } = useHomePreferences()
  const root = useRef<HTMLDivElement>(null)
  const scroll = useRef<ReturnType<typeof connectSearchScroll> | null>(null)
  const composing = useRef(false)
  const rows = useMemo(() => state.query
    ? filterVisibleSearchItems(state.items, list, workspaceList, showSubagents)
    : selectVisibleRecentSessions(list, workspaceList, 5, showSubagents).map(row => ({ sessionId: row.id, snippet: '' })),
  [state.query, state.items, list, workspaceList, showSubagents])
  const busy = isSearchBusy(state)

  useLayoutEffect(() => {
    controller.resume()
    return () => controller.suspend()
  }, [controller])

  useLayoutEffect(() => {
    const content = root.current
    const area = content?.closest<HTMLElement>('[data-scroll-area]')
    // Missing metadata is withheld until the list arrives. Do not restore into
    // that temporary short list and lose the saved position to browser clamping.
    if (!content || !area || list.phase !== 'ready') return
    const connection = connectSearchScroll({
      area,
      rows: () => content.querySelectorAll<M3eListActionElement>('m3e-list-action'),
      getSaved: controller.getScrollTop,
      setSaved: controller.setScrollTop,
      scheduler: { request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle) },
    })
    scroll.current = connection
    return () => {
      connection.dispose()
      if (scroll.current === connection) scroll.current = null
    }
  }, [controller, list.phase, rows])

  const change = (value: string, isComposing = composing.current) => {
    if (normalizeQuery(value) !== controller.getSnapshot().query) {
      if (scroll.current) scroll.current.reset()
      else {
        controller.setScrollTop(0)
        const area = root.current?.closest<HTMLElement>('[data-scroll-area]')
        if (area) area.scrollTop = 0
      }
    }
    controller.setInput(value, isComposing)
  }

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
          {state.phase === 'composing' && <p>入力を確定すると検索します</p>}
          {state.phase === 'ready' && rows.length === 0 && <p>{list.phase === 'pending' ? 'セッションを読み込んでいます…' : '見つかりませんでした'}</p>}
          {state.phase === 'ready' && rows.length > 0 && <span className="search-visually-hidden">{rows.length} 件見つかりました</span>}
          {!state.query && rows.length === 0 && <p>{list.phase === 'pending' ? 'セッションを読み込んでいます…' : '最近のセッションはありません'}</p>}
        </div>
        {state.phase === 'error' && <div role="alert" className="search-error">
          <p>検索できませんでした</p><p>{state.error}</p>
          {state.retryable && <M3eButton variant="tonal" onClick={() => controller.retry()}>もう一度検索</M3eButton>}
        </div>}
        {rows.length > 0 && <M3eActionList aria-label={state.query ? '検索結果' : '最近のセッション'}>
          {rows.map(item => {
            const row = list.byId[item.sessionId]
            return <M3eListAction key={item.sessionId} onClick={() => navigate(`/s/${encodeURIComponent(item.sessionId)}`)}>
              <SearchModelIcon row={row} />
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
