import type { ISessions } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { normalizeQuery } from './search-utils.ts'

export type SearchItem = { sessionId: string; snippet: string }
export interface SearchState {
  input: string
  query: string
  phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error'
  items: readonly SearchItem[]
  hasMore: boolean
  error: string | null
}

/** Kept per controller connection so returning from a conversation restores the tab. */
export function createSearchController(sessions: Pick<ISessions, 'search'>) {
  let state: SearchState = { input: '', query: '', phase: 'idle', items: [], hasMore: false, error: null }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let revision = 0
  let composing = false
  let scrollTop = 0
  const publish = (patch: Partial<SearchState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const cancel = () => {
    revision++
    clearTimeout(timer)
    timer = undefined
    request?.abort()
    request = undefined
  }
  const run = async () => {
    timer = undefined
    const current = new AbortController()
    request = current
    const version = revision
    const query = state.query
    publish({ phase: 'loading', error: null })
    try {
      const result = await sessions.search(query, current.signal)
      if (current.signal.aborted || version !== revision) return
      if (result.ok) publish({ phase: 'ready', items: result.value.items, hasMore: result.value.hasMore })
      else publish({ phase: 'error', error: remoteErrorMessage(result.error, '検索サービスから結果を取得できませんでした。時間をおいて、もう一度お試しください。') })
    } catch (error) {
      if (current.signal.aborted || version !== revision) return
      publish({ phase: 'error', error: remoteErrorMessage(error, '検索サービスから結果を取得できませんでした。時間をおいて、もう一度お試しください。') })
    } finally {
      if (request === current) request = undefined
    }
  }
  const schedule = () => { timer = setTimeout(() => { void run() }, 300) }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setInput(input: string, isComposing = false) {
      const query = normalizeQuery(input)
      // Spacing changes alone do not repeat a completed or in-flight search.
      if (query === state.query && !composing && !isComposing) { publish({ input }); return }
      cancel()
      composing = isComposing
      scrollTop = 0
      publish({ input, query, phase: query ? 'waiting' : 'idle', items: [], hasMore: false, error: null })
      if (query && !composing) schedule()
    },
    retry() {
      if (!state.query || composing) return
      cancel()
      publish({ phase: 'waiting', error: null })
      schedule()
    },
    suspend() {
      cancel()
      composing = false
      if (state.phase === 'loading') publish({ phase: 'waiting' })
    },
    resume() {
      if (state.query && state.phase === 'waiting' && !timer && !request) schedule()
    },
    getScrollTop: () => scrollTop,
    setScrollTop(value: number) { scrollTop = Math.max(0, value) },
  }
}

const controllers = new WeakMap<ISessions, ReturnType<typeof createSearchController>>()
export function searchControllerFor(sessions: ISessions) {
  let controller = controllers.get(sessions)
  if (!controller) { controller = createSearchController(sessions); controllers.set(sessions, controller) }
  return controller
}
