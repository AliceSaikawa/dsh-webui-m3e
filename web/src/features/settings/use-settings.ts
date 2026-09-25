import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { createSettingsStore, type SettingsApi } from './store.ts'

export function useSettings() {
  const { remote, connection } = useDsh()
  const store = useMemo(() => createSettingsStore(remote.settings as SettingsApi), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const stopNotice = store.subscribeNotice(showSnackbar)
    const on = remote.$on as ((event: string, handler: (ns: unknown, revision?: unknown) => void) => unknown) | undefined
    let active = true
    const off = typeof on === 'function' ? on.call(remote, 'settings/document-updated', (ns, revision) => { if (active) store.documentUpdated(ns, revision) }) : undefined
    const onConnection = () => { if (active) void store.connectionChanged(connection.state.getSnapshot()) }
    const stopConnection = connection.state.subscribe(onConnection)
    onConnection()
    return () => { active = false; stopNotice(); stopConnection(); if (typeof off === 'function') off() }
  }, [store, remote, connection])
  return { state, store }
}
