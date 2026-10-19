import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { settingsStoreFor } from './settings-lifetime.ts'

export function useSettings() {
  const { remote, connection } = useDsh()
  // The store, its queue and its event subscriptions live as long as the
  // remote, so leaving the screen cannot drop a disconnect or a reconnect.
  const lifetime = useMemo(() => settingsStoreFor(remote, connection), [remote, connection])
  const store = lifetime.store
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    // Only the snackbar belongs to the screen; notices aimed at a screen that
    // is not visible have nowhere to go.
    const stopNotice = store.subscribeNotice(showSnackbar)
    lifetime.opened()
    return stopNotice
  }, [store, lifetime])
  return { state, store }
}
