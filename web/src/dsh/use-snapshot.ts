import { useCallback, useSyncExternalStore } from 'react'

/** The observable face DSH client services expose (getSnapshot / subscribe). */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/**
 * Read an observable snapshot and re-render when it changes. DSH snapshots
 * keep their identity until the value changes, as useSyncExternalStore needs.
 * @param source - a DSH observable snapshot.
 * @returns the current snapshot value.
 */
export function useSnapshot<T>(source: ObservableSnapshot<T>): T {
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const getSnapshot = useCallback(() => source.getSnapshot(), [source])
  return useSyncExternalStore(subscribe, getSnapshot)
}
