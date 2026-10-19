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
import { formatDateTime, useLocale, useMessages, type Locale } from '../../i18n/index.ts'
import { searchMessages } from './messages.ts'
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

/** The source (Japanese) messages; `en`/`zh` keep the same shape. */
type SearchText = (typeof searchMessages)['ja']

function sessionDetails(row: SessionSummary | undefined, text: SearchText, locale: Locale): string {
  const folder = row?.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || text.noFolder
  const date = row && Number.isFinite(row.updatedAt) ? new Date(row.updatedAt) : null
  const updated = date
    ? (formatDateTime(locale, date, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? text.unknownUpdatedAt)
    : text.unknownUpdatedAt
  return text.sessionDetails(folder, updated)
}

export function SearchScreen() {
  const text = useMessages(searchMessages)
  const locale = useLocale()
  const { sessions, workspaces } = useDsh()
  const controller = searchControllerFor(sessions, text)
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

  return <TabScaffold title={text.title}>
    <div ref={root} className="search-screen">
      <div className="search-bar-area">
        <M3eSearchBar clearable clearLabel={text.clearLabel} onClear={() => { composing.current = false; change('', false) }}>
          <Icon name="search" slot="leading" />
          <input slot="input" type="search" aria-label={text.searchField} placeholder={text.searchField}
            autoComplete="off" enterKeyHint="search" value={state.input}
            onChange={event => change(event.currentTarget.value)}
            onCompositionStart={event => { composing.current = true; change(event.currentTarget.value, true) }}
            onCompositionEnd={event => { composing.current = false; change(event.currentTarget.value, false) }} />
        </M3eSearchBar>
        <div className="search-progress">
          {busy && <M3eLinearProgressIndicator mode="indeterminate" aria-label={text.busyLabel} />}
        </div>
      </div>
      <div className="search-results" aria-busy={busy}>
        <h2>{state.query ? text.resultsFor(state.query) : text.recentSessions}</h2>
        <div role="status" aria-live="polite" aria-atomic="true" className="search-status">
          {busy && <p>{text.searching}</p>}
          {state.phase === 'composing' && <p>{text.composingHint}</p>}
          {state.phase === 'ready' && rows.length === 0 && <p>{list.phase === 'pending' ? text.loadingSessions : text.noResults}</p>}
          {state.phase === 'ready' && rows.length > 0 && <span className="search-visually-hidden">{text.resultCount(rows.length)}</span>}
          {!state.query && rows.length === 0 && <p>{list.phase === 'pending' ? text.loadingSessions : text.noRecentSessions}</p>}
        </div>
        {state.phase === 'error' && <div role="alert" className="search-error">
          <p>{text.failed}</p><p>{state.error}</p>
          {state.retryable && <M3eButton variant="tonal" onClick={() => controller.retry()}>{text.retry}</M3eButton>}
        </div>}
        {rows.length > 0 && <M3eActionList aria-label={state.query ? text.results : text.recentSessions}>
          {rows.map(item => {
            const row = list.byId[item.sessionId]
            return <M3eListAction key={item.sessionId} onClick={() => navigate(`/s/${encodeURIComponent(item.sessionId)}`)}>
              <SearchModelIcon row={row} />
              <span className="search-title">{row?.displayTitle || row?.title || text.untitled}</span>
              <span slot="supporting-text" className="search-snippet">
                {item.snippet?.trim() ? <Highlight text={item.snippet} query={state.query} /> : sessionDetails(row, text, locale)}
              </span>
            </M3eListAction>
          })}
        </M3eActionList>}
        {state.phase === 'ready' && state.hasMore && <p className="search-more">{text.more}</p>}
      </div>
    </div>
  </TabScaffold>
}
