import { useEffect, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'

const lastConnected = new WeakMap<object, number>()
export function useConnection() {
  const { connection } = useDsh()
  const state = useSnapshot(connection.state)
  if (state === 'connected') lastConnected.set(connection, Date.now())
  return { state, connected: state === 'connected', lastConnectedAt: lastConnected.get(connection), reconnect: () => connection.reconnect() }
}
export function ConnectionBanner() {
  const { state, lastConnectedAt, reconnect } = useConnection()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (state === 'connected') return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [state])
  if (state === 'connected') return null
  if (state === 'connecting') return <div className="connection-progress" role="progressbar" aria-label="再接続中"><span /></div>
  const stale = lastConnectedAt === undefined ? '保存済みのデータを表示しています' : `${Math.max(0, Math.floor((now - lastConnectedAt) / 60_000))} 分前のデータを表示しています`
  return <aside className="connection-banner" role="status"><div><strong>DSH との接続が切れました</strong><small>{stale}</small></div><M3eButton onClick={reconnect}>再接続</M3eButton></aside>
}
