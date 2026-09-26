import { useLayoutEffect } from 'react'
import { closeOverlaysOutsideRoute } from './store.ts'

/** Keep this beside the routed screen so sheets cannot outlive their owner. */
export function OverlayRouteScope({ path }: { path: string }) {
  useLayoutEffect(() => { closeOverlaysOutsideRoute(path) }, [path])
  return null
}
