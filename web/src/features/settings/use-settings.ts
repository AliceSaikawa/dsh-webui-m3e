import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { createSettingsStore, type SettingsApi, type SettingsStore } from './store.ts'
import { composerApi } from '../composer/api.ts'

// Settings screens come and go, but a pending draft must outlive them so a
// history move during the 600ms autosave delay can still save and be recovered.
const stores = new WeakMap<object, SettingsStore>()

export function useSettings() {
  const { remote, connection } = useDsh()
  const store = useMemo(() => {
    const cached = stores.get(remote)
    if (cached) return cached
    const created = createSettingsStore(remote.settings as SettingsApi, composerApi(remote).permissionCatalog)
    stores.set(remote, created)
    return created
  }, [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    const stopNotice = store.subscribeNotice(showSnackbar)
    const offCatalog = onRemoteEvent(remote, 'permission-presets/catalog-changed', () => { void store.reload() })
    let active = true
    const off = onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => { if (active) store.documentUpdated(ns, revision) })
    const onConnection = () => { if (active) void store.connectionChanged(connection.state.getSnapshot()) }
    const stopConnection = connection.state.subscribe(onConnection)
    onConnection()
    // The store outlives this screen. Read again when a later screen opens so
    // changes broadcast while no settings screen was subscribed are not missed.
    if (store.getSnapshot().phase !== 'loading') void store.reload()
    return () => { active = false; stopNotice(); stopConnection(); off(); offCatalog() }
  }, [store, remote, connection])
  return { state, store }
}
