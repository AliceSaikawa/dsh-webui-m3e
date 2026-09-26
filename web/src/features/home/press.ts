/** A sheet opened before pointerup must not treat that press's click as an outside click. */
export function beginLongPress(target: EventTarget, pointerId: number, onLongPress: () => void) {
  let releaseGuard: (() => void) | undefined
  const timer = setTimeout(() => {
    let expiry: ReturnType<typeof setTimeout> | undefined
    const capture = { capture: true }
    const clearGuard = () => {
      clearTimeout(expiry)
      target.removeEventListener('click', swallowClick, capture)
      target.removeEventListener('pointerup', release, capture)
      target.removeEventListener('pointercancel', cancelRelease, capture)
    }
    const swallowClick = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      clearGuard()
    }
    const release = (event: Event) => {
      if ('pointerId' in event && event.pointerId === pointerId) expiry = setTimeout(clearGuard, 100)
    }
    const cancelRelease = (event: Event) => {
      if ('pointerId' in event && event.pointerId === pointerId) clearGuard()
    }
    releaseGuard = clearGuard
    target.addEventListener('click', swallowClick, capture)
    target.addEventListener('pointerup', release, capture)
    target.addEventListener('pointercancel', cancelRelease, capture)
    onLongPress()
  }, 500)
  return {
    finish() { clearTimeout(timer) },
    cancel() { clearTimeout(timer); releaseGuard?.() },
  }
}
