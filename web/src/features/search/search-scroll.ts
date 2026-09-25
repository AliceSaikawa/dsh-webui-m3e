/** The outer action and its inner list-item-button each render through Lit. */
export interface SearchScrollRow {
  readonly updateComplete?: PromiseLike<unknown>
  readonly button?: { readonly updateComplete?: PromiseLike<unknown> }
}

export interface SearchScrollScheduler {
  request(callback: () => void): number
  cancel(handle: number): void
}

interface SearchScrollOptions {
  area: EventTarget & { scrollTop: number }
  rows: () => Iterable<SearchScrollRow>
  getSaved(): number
  setSaved(value: number): void
  scheduler: SearchScrollScheduler
}

/** Restore only a rendered search result set; reconnect when the row set changes. */
export function connectSearchScroll({ area, rows, getSaved, setSaved, scheduler }: SearchScrollOptions) {
  const target = getSaved()
  let phase: 'restoring' | 'interrupted' | 'active' | 'disposed' = 'restoring'
  let userScrolling = false
  let frame: number | undefined
  let finishFrame: ((finished: boolean) => void) | undefined

  const cancelFrame = () => {
    if (frame !== undefined) scheduler.cancel(frame)
    frame = undefined
    finishFrame?.(false)
    finishFrame = undefined
  }
  const interrupt = () => {
    if (phase !== 'restoring') return
    phase = 'interrupted'
    cancelFrame()
  }
  const current = () => {
    if (phase !== 'restoring') return false
    if (getSaved() !== target) { interrupt(); return false }
    return true
  }
  const nextFrame = () => new Promise<boolean>(resolve => {
    finishFrame = resolve
    frame = scheduler.request(() => {
      frame = undefined
      finishFrame = undefined
      resolve(current())
    })
  })
  const saveScroll = () => {
    if (phase === 'disposed') return
    if (phase !== 'active' && !userScrolling) return
    phase = 'active'
    setSaved(area.scrollTop)
  }
  const userScroll = () => {
    if (phase === 'disposed') return
    interrupt()
    userScrolling = true
  }
  const keyScroll = (event: Event) => {
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes((event as Event & { key?: string }).key ?? '')) return
    // Arrow keys in the search field edit text; they do not scroll the results.
    if (event.composedPath().some(target => {
      const element = target as { tagName?: string; isContentEditable?: boolean }
      return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '')
    })) return
    userScroll()
  }
  const scrollbarScroll = (event: Event) => {
    if (event.target === area) userScroll()
  }
  const listeners: readonly [string, (event: Event) => void][] = [
    ['scroll', saveScroll], ['wheel', userScroll], ['touchmove', userScroll],
    ['keydown', keyScroll], ['pointerdown', scrollbarScroll],
  ]
  for (const [type, listener] of listeners) area.addEventListener(type, listener, { passive: true })

  void (async () => {
    try {
      const actions = [...rows()]
      await Promise.all(actions.map(action => action.updateComplete))
      if (!current()) return
      // `button` is created by the outer action's render, so read it afterwards.
      await Promise.all(actions.map(action => action.button?.updateComplete))
      if (!current()) return
      // M3E 2.8.2 observes inner content in firstUpdated. ResizeObserver runs
      // after rAF, then schedules line-count/min-height state writes in a later
      // rAF (dist/list.js:174-189). Two frames drain that work; the third frame
      // applies the position after the resulting layout, not during its writes.
      for (let count = 0; count < 3; count++) if (!await nextFrame()) return
      area.scrollTop = target
      // Scroll events from our write (including browser clamping) must not save
      // an intermediate value or race cleanup before restoration has settled.
      if (!await nextFrame()) return
      phase = 'active'
      setSaved(area.scrollTop)
    } catch {
      // A failed custom-element update cannot justify replacing a saved offset.
      interrupt()
    }
  })()

  return {
    /** Call before replacing the query/results so an old restore cannot win. */
    reset() {
      if (phase === 'disposed') return
      interrupt()
      phase = 'active'
      setSaved(0)
      area.scrollTop = 0
    },
    dispose() {
      if (phase === 'disposed') return
      // During mount/unmount (including StrictMode), keep the intended offset.
      if (phase === 'active') setSaved(area.scrollTop)
      phase = 'disposed'
      cancelFrame()
      for (const [type, listener] of listeners) area.removeEventListener(type, listener)
    },
  }
}
