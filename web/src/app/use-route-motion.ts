import { useLayoutEffect, useRef } from 'react'
import { getRouteHistoryIndex } from './router.ts'
import { routeMotion, startRouteMotion } from './route-motion.ts'

export function useRouteMotion(pathname: string) {
  const ref = useRef<HTMLDivElement>(null)
  const index = getRouteHistoryIndex()
  const previous = useRef({ pathname, index })
  useLayoutEffect(() => {
    const next = { pathname, index }
    const motion = routeMotion(previous.current, next)
    previous.current = next
    if (!ref.current) return
    return startRouteMotion(ref.current, motion, matchMedia('(prefers-reduced-motion: reduce)'))
  }, [pathname, index])
  return ref
}
