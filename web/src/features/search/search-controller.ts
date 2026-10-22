import type { ISessions } from '../../dsh/services.ts'
import { remoteErrorMessage, remoteFailureOf } from '../../dsh/remote-result.ts'
import { messagesOf } from '../../i18n/catalog.ts'
import { searchMessages } from './messages.ts'
import { normalizeQuery, shouldSearch } from './search-utils.ts'

/** The source (Japanese) messages; `en`/`zh` keep the same shape. */
type SearchText = (typeof searchMessages)['ja']

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
function queryError(query: string, text: SearchText): string | null {
  if (query.length > 500) return text.queryTooLong
  if (query.includes('\0')) return text.queryInvalid
  return null
}

function searchError(error: unknown, text: SearchText): Pick<SearchState, 'error' | 'retryable'> {
  const code = remoteFailureOf(error)?.code
  if (code === 'gateway/bad-request') return { error: text.badRequest, retryable: false }
  // This code also covers provider failures; permit a retry after the host recovers.
  if (code === 'gateway/internal') return { error: text.serviceUnavailable, retryable: true }
  return { error: remoteErrorMessage(error, text.serviceFailed), retryable: true }
}

/** Kept per controller connection so returning from a conversation restores the tab. */
export function createSearchController(sessions: Pick<ISessions, 'search'>, text: SearchText = messagesOf(searchMessages, 'ja')) {
  let state: SearchState = { input: '', query: '', phase: 'idle', composing: false, items: [], hasMore: false, error: null, retryable: false }
  // The screen updates this on every render and on a language change, so texts
  // produced later (async results, retry) use the latest language.
  let currentText = text
  // What the shown error came from, so a language change can word it again.
  let failure: { kind: 'query' } | { kind: 'search'; cause: unknown } | undefined
  const failurePatch = (from: NonNullable<typeof failure>, words: SearchText): Pick<SearchState, 'error' | 'retryable'> =>
    from.kind === 'query' ? { error: queryError(state.query, words), retryable: false } : searchError(from.cause, words)
  const fail = (cause: unknown) => {
    failure = { kind: 'search', cause }
    publish({ phase: 'error', ...searchError(cause, currentText) })
  }
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
      else fail(result.error)
    } catch (error) {
      if (current.signal.aborted || version !== revision) return
      fail(error)
    } finally {
      if (request === current) request = undefined
    }
  }
  const schedule = () => { timer = setTimeout(() => { void run() }, 300) }
  return {
    getSnapshot: () => state,
    /**
     * The screen calls this on every render. Texts captured at creation would
     * stay in the old language after a language change, because the controller
     * outlives the renders that made it (see docs/design/11-i18n.md).
     */
    setText(next: SearchText) {
      if (next === currentText) return
      currentText = next
      // An error shown before the change is worded again in the new language.
      // The screen calls this while it renders, before it reads the snapshot,
      // so the state is replaced without notifying: a notification here would
      // update the screen during its own render.
      if (state.phase === 'error' && failure) state = { ...state, ...failurePatch(failure, next) }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setInput(input: string, isComposing = false) {
      const query = normalizeQuery(input)
      const changed = shouldSearch(query, state.query) || (!query && !!state.query)
      const confirmed = !isComposing && state.phase === 'composing'
      // Starting composition without editing text keeps both results and requests.
      if (!changed && !confirmed) { publish({ input, composing: isComposing }); return }
      cancel()
      if (changed) scrollTop = 0
      const error = isComposing ? null : queryError(query, currentText)
      if (error) failure = { kind: 'query' }
      const phase = isComposing ? 'composing' : error ? 'error' : shouldSearch(query) ? 'waiting' : 'idle'
      publish({ input, query, composing: isComposing, phase, items: [], hasMore: false, error, retryable: false })
      if (phase === 'waiting') schedule()
    },
    retry() {
      if (!shouldSearch(state.query) || state.composing || !state.retryable || queryError(state.query, currentText)) return
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
export function searchControllerFor(sessions: ISessions, text: SearchText = messagesOf(searchMessages, 'ja')) {
  let controller = controllers.get(sessions)
  if (!controller) { controller = createSearchController(sessions, text); controllers.set(sessions, controller) }
  // The cached controller keeps its state, but the texts belong to the current render.
  else controller.setText(text)
  return controller
}
