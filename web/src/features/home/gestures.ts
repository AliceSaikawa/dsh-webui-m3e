import { useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react'

export function swipeAction(dx: number, dy: number): 'archive' | null {
  return Math.abs(dx) >= 88 && Math.abs(dx) > Math.abs(dy) * 2 ? 'archive' : null
}

/** Keep scrolling, long press and horizontal actions mutually exclusive. */
export function useRowGesture(options: { onLongPress?(): void; onSwipe?(): void; onClick(): void; disabled?: boolean }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressed = useRef(false)
  const [offset, setOffset] = useState(0)
  const clear = () => { clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => () => clearTimeout(timer.current), [])
  function reset() { clear(); start.current = null; setOffset(0) }
  return {
    offset,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (options.disabled || !event.isPrimary || event.button !== 0) return
        suppressed.current = false
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
        if (options.onLongPress) timer.current = setTimeout(() => {
          suppressed.current = true
          start.current = null
          options.onLongPress?.()
        }, 500)
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (!point || point.id !== event.pointerId) return
        const dx = event.clientX - point.x, dy = event.clientY - point.y
        if (Math.hypot(dx, dy) > 10) { clear(); suppressed.current = true }
        if (options.onSwipe && Math.abs(dx) > Math.abs(dy) * 2) {
          event.currentTarget.setPointerCapture(event.pointerId)
          setOffset(Math.max(-112, Math.min(112, dx)))
        }
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const point = start.current
        if (point && options.onSwipe && swipeAction(event.clientX - point.x, event.clientY - point.y)) {
          suppressed.current = true
          options.onSwipe()
        }
        reset()
      },
      onPointerCancel() { suppressed.current = true; reset() },
      onContextMenu(event: MouseEvent<HTMLElement>) {
        if (!options.onLongPress || options.disabled) return
        event.preventDefault()
        if (!suppressed.current) { suppressed.current = true; reset(); options.onLongPress() }
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (options.disabled || (event.detail !== 0 && suppressed.current)) { event.preventDefault(); event.stopPropagation() }
      },
      onClick(event: MouseEvent<HTMLElement>) {
        if (options.disabled || (event.detail !== 0 && suppressed.current)) { event.preventDefault(); return }
        options.onClick()
      },
    },
  }
}
