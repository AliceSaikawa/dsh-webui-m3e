import { useMemo } from 'react'
import { useDsh } from './services.ts'
import { useSnapshot } from './use-snapshot.ts'
import { JobRowsStore, type JobRowsRemote } from './job-rows.ts'

const stores = new WeakMap<object, Map<string, JobRowsStore>>()
export function useSessionJobs(sessionId: string) {
  const { ctx, remote, connection } = useDsh()
  const store = useMemo(() => {
    let sessions = stores.get(ctx)
    if (!sessions) { sessions = new Map(); stores.set(ctx, sessions) }
    let store = sessions.get(sessionId)
    if (!store) { store = new JobRowsStore(remote.job as JobRowsRemote, sessionId, connection); sessions.set(sessionId, store) }
    return store
  }, [ctx, remote, connection, sessionId])
  return { ...useSnapshot(store), retry: store.retry }
}
