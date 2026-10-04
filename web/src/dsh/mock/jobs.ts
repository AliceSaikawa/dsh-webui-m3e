import type { IJobs, JobsSnapshot, RemoteResult, SessionJob } from '../services.ts'
import { observable } from './observable.ts'

export type JobFrame = { type: 'opened'; text?: string; gapBefore?: boolean } | { type: 'output'; text: string; gapBefore?: boolean } | { type: 'status' } | { type: 'error'; error: string }
type Entry = { refs: number; stopped: boolean; generation: number }
export function createMockJobs(readRows?: (id: string) => Promise<RemoteResult<readonly SessionJob[]>>) {
  const state = observable<JobsSnapshot>({ rows: {}, observed: {} })
  const host = new Map<string, readonly SessionJob[]>()
  const watches = new Map<string, Entry>()
  const observations = new Map<string, Entry>()
  let disposed = false
  const drop = (id: string) => state.update(value => { const rows = { ...value.rows }; delete rows[id]; return { ...value, rows } })
  function publish(id: string, rows: readonly SessionJob[]) {
    state.update(value => { const next = { ...value.rows }; if (rows.length) next[id] = rows; else delete next[id]; return { ...value, rows: next } })
  }
  function failRows(id: string) { const entry = watches.get(id); if (entry) entry.stopped = true; drop(id) }
  function baseline(id: string, entry: Entry) {
    const generation = ++entry.generation
    if (!readRows) { publish(id, host.get(id) ?? []); return }
    void readRows(id).then(result => {
      if (disposed || watches.get(id) !== entry || entry.stopped || entry.generation !== generation) return
      if (result.ok) publish(id, result.value)
      else failRows(id)
    }, () => { if (!disposed && watches.get(id) === entry && !entry.stopped && entry.generation === generation) failRows(id) })
  }
  function acquire(entries: Map<string, Entry>, id: string, start: (entry: Entry) => void, clear: () => void) {
    let entry = entries.get(id)
    if (!entry || entry.stopped) {
      entry = { refs: 0, stopped: false, generation: 0 }
      entries.set(id, entry)
      start(entry)
    }
    entry.refs++
    const owned = entry
    let released = false
    return () => {
      if (released) return
      released = true
      if (--owned.refs > 0) return
      owned.stopped = true
      if (entries.get(id) === owned) entries.delete(id)
      // Match async stream disposal: an older closure cannot clear a new stream.
      queueMicrotask(() => { if (!entries.has(id)) clear() })
    }
  }
  function frame(id: string, event: JobFrame) {
    const entry = observations.get(id)
    if (!entry || entry.stopped) return
    const old = state.getSnapshot().observed[id] ?? { jobId: id, text: '', gapBefore: false, streaming: false }
    const next = event.type === 'opened' ? { jobId: id, text: old.text, gapBefore: old.gapBefore || !!event.gapBefore, streaming: true }
      : event.type === 'output' ? { ...old, text: old.text + event.text, gapBefore: old.gapBefore || !!event.gapBefore }
      : event.type === 'error' ? { ...old, streaming: false, error: event.error }
      : { ...old, streaming: false }
    if (event.type === 'status' || event.type === 'error') entry.stopped = true
    state.update(value => ({ ...value, observed: { ...value.observed, [id]: next } }))
  }
  const jobs: IJobs = {
    state,
    watchRows(id) { return acquire(watches, id, entry => baseline(id, entry), () => drop(id)) },
    observe(_sessionId, id) { return acquire(observations, id, () => {}, () => state.update(value => { const observed = { ...value.observed }; delete observed[id]; return { ...value, observed } })) },
    async kill(sessionId, id) {
      const row = host.get(sessionId)?.find(row => row.id === id)
      if (!row) return { ok: false, error: { code: 'job/not-found', message: 'ジョブが見つかりません。', details: {} } }
      return { ok: true, value: { outcome: row.status === 'running' || row.status === 'stopping' ? 'requested' : 'already-finished' } }
    },
  }
  return {
    jobs, host, failRows, frame,
    setRows(id: string, rows: readonly SessionJob[]) {
      const value = structuredClone(rows); host.set(id, value)
      const entry = watches.get(id)
      if (entry && !entry.stopped) publish(id, value)
    },
    reconnect() { for (const [id, entry] of watches) if (!entry.stopped) baseline(id, entry) },
    dispose() { disposed = true; for (const entry of [...watches.values(), ...observations.values()]) entry.stopped = true; watches.clear(); observations.clear(); state.set({ rows: {}, observed: {} }) },
  }
}
