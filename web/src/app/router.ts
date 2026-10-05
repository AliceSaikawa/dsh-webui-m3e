import { useSyncExternalStore } from 'react'
import { pageHref, resolveRoute, shouldReplace, type RouteDef, type RouteMatch } from './route-match.ts'
export { resolveRoute, shouldReplace, type RouteDef, type RouteMatch, type RouteParams, type Tab } from './route-match.ts'

let definitions: RouteDef[] = []
const changeEvent = 'm3e:navigate'
const stateKey = '__m3eHistory'

export function registerRoutes(routes: RouteDef[]) { definitions = routes }

function index(): number {
  const value: unknown = window.history.state?.[stateKey]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** Position within this app's history, used to distinguish forward and back motion. */
export function getRouteHistoryIndex(): number { return index() }

export function initializeRouter(): void {
  if (typeof window.history.state?.[stateKey] !== 'number') {
    window.history.replaceState({ ...window.history.state, [stateKey]: 0 }, '', window.location.href)
  }
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const hash = path.replace(/^#/, '')
  if (!hash.startsWith('/') || hash.startsWith('//')) throw new Error('画面のパスは / から指定してください')
  initializeRouter()
  if (readHash() === '#' + hash) return
  const replace = options.replace ?? shouldReplace(readHash(), hash)
  const state = { ...window.history.state, [stateKey]: index() + (replace ? 0 : 1) }
  // A bare hash uses document.baseURI, which points at the DSH Host root.
  window.history[replace ? 'replaceState' : 'pushState'](state, '', pageHref('#' + hash, window.location.href))
  window.dispatchEvent(new Event(changeEvent))
}

export function back(): void {
  if (index() > 0) window.history.back()
  else navigate('/', { replace: true })
}

const readHash = () => typeof window === 'undefined' ? '#/' : window.location.hash || '#/'
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  window.addEventListener(changeEvent, listener)
  return () => {
    window.removeEventListener('hashchange', listener)
    window.removeEventListener('popstate', listener)
    window.removeEventListener(changeEvent, listener)
  }
}
export function useRoute(): RouteMatch {
  return resolveRoute(useSyncExternalStore(subscribe, readHash, () => '#/'), definitions)
}
