import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { createProviderStore, type ProviderRemote } from './providers.ts'
import { providerSummary } from './schema.ts'

export function useProviderSummary(): string {
  const { remote, connection } = useDsh()
  const store = useMemo(() => createProviderStore(remote as unknown as ProviderRemote), [remote])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    let active = true
    const read = () => { if (active) void store.load() }
    const changed = () => store.connectionChanged(connection.state.getSnapshot() === 'connected')
    const offConnection = connection.state.subscribe(changed)
    changed()
    const on = remote.$on as ((event: string, listener: () => void) => unknown) | undefined
    const stops = typeof on === 'function'
      ? ['credentials/reference-updated', 'llm/adapters-updated', 'settings/document-updated'].map(event => on.call(remote, event, read)) : []
    read()
    return () => {
      active = false
      offConnection()
      stops.forEach(stop => { if (typeof stop === 'function') stop() })
      store.connectionChanged(false)
    }
  }, [remote, connection, store])
  return providerSummary(state)
}
