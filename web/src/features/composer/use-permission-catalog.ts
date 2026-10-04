import { useEffect, useMemo, useState } from 'react'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { composerApi, type PermissionCatalog } from './api.ts'

/** Subscribe before the first read so a live contribution cannot be missed. */
export function usePermissionCatalog() {
  const { remote, connection } = useDsh()
  const connected = useSnapshot(connection.state) === 'connected'
  const api = useMemo(() => composerApi(remote), [remote])
  const [catalog, setCatalog] = useState<PermissionCatalog>()
  useEffect(() => {
    setCatalog(undefined)
    if (!connected) return
    let active = true
    let generation = 0
    const load = async () => {
      const request = ++generation
      try {
        const value = await api.permissionCatalog()
        if (active && request === generation) setCatalog(value)
      } catch { if (active && request === generation) setCatalog(undefined) }
    }
    const off = onRemoteEvent(remote, 'permission-presets/catalog-changed', () => { void load() })
    const offSettings = onRemoteEvent(remote, 'settings/document-updated', ns => {
      if (ns === 'permission') { setCatalog(undefined); void load() }
    })
    void load()
    return () => { active = false; off(); offSettings() }
  }, [api, remote, connected])
  return catalog
}
