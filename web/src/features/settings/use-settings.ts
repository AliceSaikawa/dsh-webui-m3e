import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { createSettingsStore, type SettingsApi } from './store.ts'
import { composerApi } from '../composer/api.ts'

export function useSettings() {
  const { remote, connection } = useDsh()
  const store = useMemo(() => createSettingsStore(remote.settings as SettingsApi, composerApi(remote).permissionCatalog), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const stopNotice = store.subscribeNotice(showSnackbar)
    const offCatalog = onRemoteEvent(remote, 'permission-presets/catalog-changed', () => { void store.reload() })
    let active = true
    const off = onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => { if (active) store.documentUpdated(ns, revision) })
    const onConnection = () => { if (active) void store.connectionChanged(connection.state.getSnapshot()) }
    const stopConnection = connection.state.subscribe(onConnection)
    onConnection()
    return () => { active = false; stopNotice(); stopConnection(); off(); offCatalog() }
  }, [store, remote, connection])
  return { state, store }
}
