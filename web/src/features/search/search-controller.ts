import type { ISessions } from '../../dsh/services.ts'
import { remoteErrorMessage, remoteFailureOf } from '../../dsh/remote-result.ts'
import { normalizeQuery, shouldSearch } from './search-utils.ts'

export type SearchItem = { sessionId: string; snippet: string }
export interface SearchState {
  input: string
  query: string
  phase: 'idle' | 'composing' | 'waiting' | 'loading' | 'ready' | 'error'
  composing: boolean
  items: readonly SearchItem[]
  hasMore: boolean
  error: string | null
  retryable: boolean
}

export function isSearchBusy(state: Pick<SearchState, 'phase' | 'composing'>): boolean {
  return !state.composing && (state.phase === 'waiting' || state.phase === 'loading')
}

/** The host counts the trimmed query in UTF-16 code units, like String.length. */
function queryError(query: string): string | null {
  if (query.length > 500) return '検索語は500文字以内にしてください。絵文字などは2文字分として数えます。'
  if (query.includes('\0')) return '検索語に使えない文字が含まれています。貼り付けた内容を見直してください。'
  return null
}

function searchError(error: unknown): Pick<SearchState, 'error' | 'retryable'> {
  const code = remoteFailureOf(error)?.code
  if (code === 'gateway/bad-request') return { error: '検索語を受け付けられませんでした。文字数や貼り付けた内容を見直してください。', retryable: false }
  // This code also covers provider failures; permit a retry after the host recovers.
  if (code === 'gateway/internal') return { error: '検索機能を利用できません。DSH の検索機能の設定や動作状態を確認してください。', retryable: true }
  return { error: remoteErrorMessage(error, '検索サービスから結果を取得できませんでした。時間をおいて、もう一度お試しください。'), retryable: true }
}

/** Kept per controller connection so returning from a conversation restores the tab. */
export function createSearchController(sessions: Pick<ISessions, 'search'>) {
  let state: SearchState = { input: '', query: '', phase: 'idle', composing: false, items: [], hasMore: false, error: null, retryable: false }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let revision = 0
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
    publish({ phase: 'loading', error: null, retryable: false })
    try {
      const result = await sessions.search(query, current.signal)
      if (current.signal.aborted || version !== revision) return
      if (result.ok) publish({ phase: 'ready', items: result.value.items, hasMore: result.value.hasMore })
      else publish({ phase: 'error', ...searchError(result.error) })
    } catch (error) {
      if (current.signal.aborted || version !== revision) return
      publish({ phase: 'error', ...searchError(error) })
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
      const changed = shouldSearch(query, state.query) || (!query && !!state.query)
      const confirmed = !isComposing && state.phase === 'composing'
      // Starting composition without editing text keeps both results and requests.
      if (!changed && !confirmed) { publish({ input, composing: isComposing }); return }
      cancel()
      if (changed) scrollTop = 0
      const error = isComposing ? null : queryError(query)
      const phase = isComposing ? 'composing' : error ? 'error' : shouldSearch(query) ? 'waiting' : 'idle'
      publish({ input, query, composing: isComposing, phase, items: [], hasMore: false, error, retryable: false })
      if (phase === 'waiting') schedule()
    },
    retry() {
      if (!shouldSearch(state.query) || state.composing || !state.retryable || queryError(state.query)) return
      cancel()
      publish({ phase: 'waiting', error: null, retryable: false })
      schedule()
    },
    suspend() {
      cancel()
      if (state.phase === 'loading') publish({ phase: 'waiting', composing: false })
      else if (state.composing) publish({ composing: false })
    },
    resume() {
      // An unfinished IME query remains unsent until the user commits or edits it.
      if (shouldSearch(state.query) && state.phase === 'waiting' && !timer && !request) schedule()
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
