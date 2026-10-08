import type { Connection, SessionJob } from './services.ts'

/** dsh-api-job-controller 0.2.0-rc.2: job.list is a whole-roster stream. */
export interface JobRowsStream extends AsyncIterable<{ type: 'rows'; jobs: readonly SessionJob[] }> { dispose(): void }
export interface JobRowsRemote { list(request: { sessionId: string }, signal?: AbortSignal): JobRowsStream }
export interface JobRowsSnapshot { readonly rows: readonly SessionJob[]; readonly status: 'loading' | 'ready' | 'error' }

/** The native jobs snapshot conflates empty, pending and failed rosters. */
export class JobRowsStore {
  #snapshot: JobRowsSnapshot = { rows: [], status: 'loading' }
  #listeners = new Set<() => void>()
  #controller?: AbortController
  #stream?: JobRowsStream
  #disconnect?: () => void
  private remote: JobRowsRemote
  private sessionId: string
  private connection: Connection
  constructor(remote: JobRowsRemote, sessionId: string, connection: Connection) {
    this.remote = remote; this.sessionId = sessionId; this.connection = connection
  }
  getSnapshot = () => this.#snapshot
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    if (this.#listeners.size === 1) {
      this.#disconnect = this.connection.state.subscribe(this.retry)
      this.retry()
    }
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size) return
      this.#disconnect?.(); this.#disconnect = undefined
      this.#stop()
      this.#snapshot = { rows: [], status: 'loading' }
    }
  }
  #set(snapshot: JobRowsSnapshot) { this.#snapshot = snapshot; for (const listener of this.#listeners) listener() }
  #stop() { this.#controller?.abort(); this.#controller = undefined; this.#stream?.dispose(); this.#stream = undefined }
  retry = () => {
    if (!this.#listeners.size) return
    this.#stop()
    this.#set({ rows: this.#snapshot.rows, status: 'loading' })
    if (this.connection.state.getSnapshot() !== 'connected') return
    const controller = new AbortController()
    this.#controller = controller
    void (async () => {
      let stream: JobRowsStream | undefined
      try {
        stream = this.remote.list({ sessionId: this.sessionId }, controller.signal)
        this.#stream = stream
        for await (const frame of stream) {
          if (controller.signal.aborted) return
          this.#set({ rows: frame.jobs, status: 'ready' })
        }
        if (!controller.signal.aborted) this.#set({ rows: this.#snapshot.rows, status: 'error' })
      } catch {
        if (!controller.signal.aborted) this.#set({ rows: this.#snapshot.rows, status: 'error' })
      } finally { stream?.dispose() }
    })()
  }
}
