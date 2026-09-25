import type { ObservableSnapshot } from '../use-snapshot.ts'

/** An in-memory observable with the same stable-snapshot contract as DSH. */
export interface MutableSnapshot<T> extends ObservableSnapshot<T> {
  set(value: T): void
  update(update: (previous: T) => T): void
}

export function observable<T>(initial: T): MutableSnapshot<T> {
  let current = initial
  const listeners = new Set<() => void>()
  const set = (value: T) => {
    if (Object.is(current, value)) return
    current = value
    for (const listener of [...listeners]) listener()
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
