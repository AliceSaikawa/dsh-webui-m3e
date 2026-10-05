import { useEffect } from 'react'
import { useDsh } from './services.ts'
import { useSnapshot } from './use-snapshot.ts'

export function useSessionJobs(sessionId: string) {
  const { jobs } = useDsh()
  const state = useSnapshot(jobs.state)
  useEffect(() => jobs.watchRows(sessionId), [jobs, sessionId])
  return state.rows[sessionId] ?? []
}
