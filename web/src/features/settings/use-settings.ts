import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { createSettingsStore, type SettingsApi } from './store.ts'

export function useSettings() {
  const { remote, connection } = useDsh()
  const store = useMemo(() => createSettingsStore(remote.settings as SettingsApi), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const stopNotice = store.subscribeNotice(showSnackbar)
    let active = true
    const off = onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => { if (active) store.documentUpdated(ns, revision) })
    const onConnection = () => { if (active) void store.connectionChanged(connection.state.getSnapshot()) }
    const stopConnection = connection.state.subscribe(onConnection)
    onConnection()
    return () => { active = false; stopNotice(); stopConnection(); off() }
  }, [store, remote, connection])
  return { state, store }
}
