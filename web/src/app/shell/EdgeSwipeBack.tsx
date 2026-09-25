import { useRef, type ReactNode } from 'react'
import { back, useRoute } from '../router.ts'
import { hasOpenOverlay } from '../overlay/store.ts'

export function EdgeSwipeBack({ children }: { children: ReactNode }) {
  const route = useRoute()
  const gesture = useRef<{ x: number; y: number; time: number } | null>(null)
  const enabled = !route.tab && route.pathname !== '/'
  return <div className="edge-swipe-root">{children}{enabled && <div className="edge-swipe-zone" aria-hidden="true"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || hasOpenOverlay()) return
      gesture.current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerCancel={() => { gesture.current = null }} onPointerUp={event => {
      const start = gesture.current
      gesture.current = null
      if (!start || hasOpenOverlay()) return
      const dx = event.clientX - start.x
      const dy = Math.abs(event.clientY - start.y)
      if (dx > 72 && dx > dy * 2 && event.timeStamp - start.time < 1200) back()
    }} />}</div>
}
