import type { Connection, DshRemote } from '../../dsh/services.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { composerApi } from '../composer/api.ts'
import { createSettingsStore, type SettingsApi, type SettingsStore } from './store.ts'

export interface SettingsLifetime {
  readonly store: SettingsStore
  /** A settings screen opened; read again for changes made while it was closed. */
  opened(): void
}

/**
 * Settings screens come and go, but the store and its subscriptions must live
 * as long as the remote. A disconnect or reconnect while no screen is open
 * otherwise never reaches `connectionChanged`, and a save whose response is
 * lost keeps the store's queue blocked after the screen is opened again.
 */
const lifetimes = new WeakMap<object, SettingsLifetime>()

export function settingsStoreFor(remote: DshRemote, connection: Connection): SettingsLifetime {
  const cached = lifetimes.get(remote)
  if (cached) return cached
  const store = createSettingsStore(remote.settings as SettingsApi, composerApi(remote).permissionCatalog)
  // The remote owns these subscriptions; DSH clears its event handlers when it goes away.
  onRemoteEvent(remote, 'permission-presets/catalog-changed', () => { void store.reload() })
  onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => store.documentUpdated(ns, revision))
  const onConnection = () => { void store.connectionChanged(connection.state.getSnapshot()) }
  connection.state.subscribe(onConnection)
  onConnection()
  const lifetime: SettingsLifetime = {
    store,
    opened() { if (store.getSnapshot().phase !== 'loading') void store.reload() },
  }
  lifetimes.set(remote, lifetime)
  return lifetime
}
