/** The release click can target the newly opened sheet instead of the message. */
export function beginChatLongPress(
  target: EventTarget,
  pointerId: number,
  onLongPress: () => void,
  delayMs = 550,
  releaseGraceMs = 100,
) {
  let releaseGuard: (() => void) | undefined
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    let expiry: ReturnType<typeof setTimeout> | undefined
    const capture = { capture: true }
    const clearGuard = () => {
      clearTimeout(expiry)
      target.removeEventListener('click', swallowClick, capture)
      target.removeEventListener('pointerup', release, capture)
      target.removeEventListener('pointercancel', cancelRelease, capture)
      releaseGuard = undefined
    }
    const swallowClick = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      clearGuard()
    }
    const release = (event: Event) => {
      if ('pointerId' in event && event.pointerId === pointerId) expiry = setTimeout(clearGuard, releaseGraceMs)
    }
    const cancelRelease = (event: Event) => {
      if ('pointerId' in event && event.pointerId === pointerId) clearGuard()
    }
    releaseGuard = clearGuard
    target.addEventListener('click', swallowClick, capture)
    target.addEventListener('pointerup', release, capture)
    target.addEventListener('pointercancel', cancelRelease, capture)
    onLongPress()
  }, delayMs)
  return {
    didFire: () => fired,
    move(dx: number, dy: number) {
      if (!fired && Math.hypot(dx, dy) > 10) { clearTimeout(timer); releaseGuard?.() }
    },
    finish() { clearTimeout(timer) },
    cancel() { clearTimeout(timer); releaseGuard?.() },
  }
}
