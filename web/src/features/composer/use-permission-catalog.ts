import { useEffect, useMemo, useState } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { composerApi, type PermissionCatalog } from './api.ts'

type CatalogState = { status: 'loading'; catalog?: PermissionCatalog }
  | { status: 'ready'; catalog: PermissionCatalog }
  | { status: 'error'; catalog?: undefined; error: unknown }

/** Subscribe before the first read so a live contribution cannot be missed. */
export function usePermissionCatalog() {
  const { remote, connection } = useDsh()
  const connected = useSnapshot(connection.state) === 'connected'
  const api = useMemo(() => composerApi(remote), [remote])
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  useEffect(() => {
    setState({ status: 'loading' })
    if (!connected) return
    let active = true
    let generation = 0
    const load = async () => {
      const request = ++generation
      setState(previous => ({ status: 'loading', catalog: previous.catalog }))
      try {
        const value = await api.permissionCatalog()
        if (active && request === generation) setState({ status: 'ready', catalog: value })
      } catch (error) { if (active && request === generation) setState({ status: 'error', error }) }
    }
    const off = onRemoteEvent(remote, 'permission-presets/catalog-changed', () => { void load() })
    const offSettings = onRemoteEvent(remote, 'settings/document-updated', ns => {
      if (ns === 'permission') void load()
    })
    void load()
    return () => { active = false; off(); offSettings() }
  }, [api, remote, connected])
  return state
}
