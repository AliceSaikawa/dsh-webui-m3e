import type { ReactNode } from 'react'

export type Tab = 'home' | 'search' | 'inbox' | 'settings'
export type RouteParams = Record<string, string>
export interface RouteDef {
  path: string
  tab?: Tab
  render(params: RouteParams): ReactNode
}
export interface RouteMatch {
  /** Registered pattern, for example /s/:id; null for an unknown URL. */
  path: string | null
  pathname: string
  params: RouteParams
  query: URLSearchParams
  tab?: Tab
  definition?: RouteDef
}

export function resolveRoute(hash: string, routes: readonly RouteDef[]): RouteMatch {
  const raw = hash.replace(/^#/, '') || '/'
  const separator = raw.indexOf('?')
  const pathname = (separator < 0 ? raw : raw.slice(0, separator)).replace(/\/$/, '') || '/'
  const query = new URLSearchParams(separator < 0 ? '' : raw.slice(separator + 1))
  const parts = pathname.split('/')
  for (const definition of routes) {
    const pattern = definition.path.replace(/^#/, '').replace(/\/$/, '') || '/'
    const expected = pattern.split('/')
    if (parts.length !== expected.length) continue
    const params: RouteParams = Object.fromEntries(query)
    let matches = true
    for (let i = 0; i < expected.length; i++) {
      const segment = expected[i]!
      if (segment.startsWith(':')) {
        try {
          if (!parts[i]) { matches = false; break }
          params[segment.slice(1)] = decodeURIComponent(parts[i]!)
        } catch { matches = false; break }
      } else if (segment !== parts[i]) { matches = false; break }
    }
    if (matches) return { path: pattern, pathname, params, query, tab: definition.tab, definition }
  }
  return { path: null, pathname, params: Object.fromEntries(query), query }
}

export function shouldReplace(from: string, to: string): boolean {
  const source = from.replace(/^#/, '').split('?')[0]
  const destination = to.replace(/^#/, '').split('?')[0]
  const tabs = ['/', '/search', '/inbox', '/settings']
  if (tabs.includes(source!) && tabs.includes(destination!)) return true
  const a = source?.match(/^\/s\/([^/]+)(?:\/trace)?$/)
  const b = destination?.match(/^\/s\/([^/]+)(?:\/trace)?$/)
  return !!a && !!b && a[1] === b[1]
}
