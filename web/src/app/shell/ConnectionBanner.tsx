import { useEffect, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { useMessages } from '../../i18n/index.ts'
import { shellMessages } from '../messages.ts'

const lastConnected = new WeakMap<object, number>()
export function useConnection() {
  const { connection } = useDsh()
  const state = useSnapshot(connection.state)
  if (state === 'connected') lastConnected.set(connection, Date.now())
  return { state, connected: state === 'connected', lastConnectedAt: lastConnected.get(connection), reconnect: () => connection.reconnect() }
}
export function ConnectionBanner() {
  const text = useMessages(shellMessages)
  const { state, lastConnectedAt, reconnect } = useConnection()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (state === 'connected') return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [state])
  if (state === 'connected') return null
  if (state === 'connecting') return <div className="connection-progress" role="progressbar" aria-label={text.reconnecting}><span /></div>
  const stale = lastConnectedAt === undefined ? text.staleWithoutTime : text.staleMinutes(Math.max(0, Math.floor((now - lastConnectedAt) / 60_000)))
  return <aside className="connection-banner" role="status"><div><strong>{text.disconnected}</strong><small>{stale}</small></div><M3eButton onClick={reconnect}>{text.reconnect}</M3eButton></aside>
}
