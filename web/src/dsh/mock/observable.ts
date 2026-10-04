import type { ObservableSnapshot } from '../use-snapshot.ts'

/** An in-memory observable with the same stable-snapshot contract as DSH. */
export interface MutableSnapshot<T> extends ObservableSnapshot<T> {
  set(value: T): void
  update(update: (previous: T) => T): void
}

export function observable<T>(initial: T, flush: 'sync' | 'microtask' = 'sync'): MutableSnapshot<T> {
  let current = initial
  const listeners = new Set<() => void>()
  let scheduled = false
  const notify = () => {
    scheduled = false
    for (const listener of [...listeners]) {
      try { listener() } catch (error) { console.error('[mock] subscriber failed:', error) }
    }
  }
  const set = (value: T) => {
    if (Object.is(current, value)) return
    current = value
    if (flush === 'sync') notify()
    else if (!scheduled) { scheduled = true; queueMicrotask(notify) }
  }
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    update: (update) => set(update(current)),
  }
}

/** Session lifecycle notifications coalesce; eventSource remains synchronous. */
export function lifecycle<T>(initial: T): MutableSnapshot<T> { return observable(initial, 'microtask') }
