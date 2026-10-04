/**
 * The controller members this UI calls on the booted client context, as of
 * the supported DSH release (src/shared/dsh-compat.ts). They are checked once
 * after boot, so a release that renamed or removed one fails with a version
 * message instead of a later, misleading error inside one screen.
 *
 * DSH 0.2.0 uses explicit Session references; navigation belongs to M3E.
 *
 * Add a member here whenever services.ts gains one that the UI calls.
 */
export const REQUIRED_CONTRACT = {
  connection: { observables: ['state'], methods: ['reconnect'] },
  sessions: {
    observables: ['list'],
    methods: ['create', 'retain', 'using', 'retainInfo', 'subagentAddress', 'refreshProjections', 'refresh', 'search', 'fork', 'scope', 'scopeOf', 'sessionOf', 'binding'],
  },
  workspaces: { observables: ['list'], methods: ['create', 'rename', 'delete', 'insertBefore', 'archiveSession', 'insertSessionBefore'] },
  jobs: { observables: ['state'], methods: ['watchRows'] },
  remote: { observables: [], methods: ['$on'] },
} as const satisfies Record<string, { observables: readonly string[]; methods: readonly string[] }>

const record = (value: unknown): Record<string, unknown> | undefined =>
  (typeof value === 'object' || typeof value === 'function') && value !== null ? value as Record<string, unknown> : undefined

/**
 * @param ctx - the booted client context.
 * @returns `service.member` names that are missing or of the wrong kind; empty when the contract holds.
 */
export function missingContractMembers(ctx: unknown): string[] {
  const root = record(ctx)
  const missing: string[] = []
  for (const [service, { observables, methods }] of Object.entries(REQUIRED_CONTRACT)) {
    const face = record(root?.[service])
    if (!face) { missing.push(service); continue }
    for (const name of observables) {
      const value = record(face[name])
      if (typeof value?.getSnapshot !== 'function' || typeof value.subscribe !== 'function') missing.push(`${service}.${name}`)
    }
    for (const name of methods) if (typeof face[name] !== 'function') missing.push(`${service}.${name}`)
  }
  return missing
}
