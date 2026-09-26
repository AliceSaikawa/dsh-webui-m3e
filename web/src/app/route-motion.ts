export type RouteMotion = 'none' | 'fade' | 'forward' | 'back'
export interface RoutePosition { pathname: string; index: number }

const tabs = new Set(['/', '/search', '/inbox', '/settings'])
const conversationTab = (path: string) => /^\/s\/([^/]+)(?:\/trace)?$/.exec(path)?.[1]

/** Chat/trace share mounted content; animate only changes between screens. */
export function routeMotion(from: RoutePosition, to: RoutePosition): RouteMotion {
  if (from.pathname === to.pathname) return 'none'
  const session = conversationTab(from.pathname)
  if (session && session === conversationTab(to.pathname)) return 'none'
  if (tabs.has(from.pathname) && tabs.has(to.pathname)) return 'fade'
  if (to.index < from.index) return 'back'
  // A directly opened deep link has no local history entry to pop.
  if (to.index === from.index && (tabs.has(to.pathname) || from.pathname.startsWith(`${to.pathname}/`))) return 'back'
  return 'forward'
}

export interface MotionFrame { [property: string]: string | number | undefined; opacity?: number; transform?: string }
export interface MotionTiming { duration: number; easing: string }
interface MotionTarget {
  animate?: (frames: MotionFrame[], options: MotionTiming) => { cancel(): void }
}
interface MotionPreference {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/** Animate the current layer only, without retaining an outgoing interactive screen. */
export function startRouteMotion(target: MotionTarget, motion: RouteMotion, preference: MotionPreference): () => void {
  if (motion === 'none' || preference.matches || !target.animate) return () => {}
  const frames = motion === 'fade'
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: `translateX(${motion === 'back' ? '-100%' : '100%'})` }, { transform: 'translateX(0)' }]
  const animation = target.animate(frames, { duration: motion === 'fade' ? 160 : 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
  const changed = () => { if (preference.matches) animation.cancel() }
  preference.addEventListener('change', changed)
  return () => { preference.removeEventListener('change', changed); animation.cancel() }
}
