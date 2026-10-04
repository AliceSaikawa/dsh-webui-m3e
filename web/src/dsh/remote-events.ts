import type { DshRemote } from './services.ts'

/**
 * Broadcast events from `ctx.remote.$on` that the M3E page listens to, with
 * payloads restated from the installed DSH client plugins (DSH 0.2.0-rc.2).
 * Keeping every name here means a renamed or reshaped event is found in one
 * file. The answerable approval/question waterfalls live in
 * ./interactions-store.ts because their handlers must return an answer.
 */
export interface RemoteEventMap {
  'permission-presets/catalog-changed': []
  'commands/change': []
  'credentials/reference-updated': []
  'llm/adapters-updated': []
  'settings/document-updated': [ns: unknown, revision?: unknown]
  'goal/activation-changed': [event: {
    readonly sessionId: string
    readonly goal?: { readonly id: string; readonly revision: number; readonly activation: 'armed' | 'disarmed' }
  }]
}
export type RemoteEventName = keyof RemoteEventMap

type Subscribe = (this: DshRemote, event: string, listener: (...args: never[]) => void) => unknown

/**
 * Subscribe to a remote broadcast. A Host without `$on` (or one that returns
 * no disposer) is tolerated, as before: the listener simply never runs.
 * @returns a disposer that is safe to call more than once.
 */
export function onRemoteEvent<K extends RemoteEventName>(remote: DshRemote, event: K, listener: (...args: RemoteEventMap[K]) => void): () => void {
  const on = remote.$on as Subscribe | undefined
  if (typeof on !== 'function') return () => {}
  const off = on.call(remote, event, listener as (...args: never[]) => void)
  let active = true
  return () => {
    if (!active) return
    active = false
    if (typeof off === 'function') off()
  }
}
