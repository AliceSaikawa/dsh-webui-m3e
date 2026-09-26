import type { SessionSnapshot, SessionSummary, SubagentAddress } from './services.ts'

export interface SessionAccess {
  isSubagent: boolean
  mode: SubagentAddress['mode'] | undefined
  canCompose: boolean
  readOnly: boolean
}

/** Fork lineage alone is not a subagent; a child needs a verified address to compose. */
export function sessionAccess(
  summary: Pick<SessionSummary, 'id' | 'origin' | 'parentId'> | undefined,
  snapshot: Pick<SessionSnapshot, 'sessionId' | 'subagent'> | undefined,
): SessionAccess {
  const address = snapshot?.subagent?.address
  const isSubagent = summary?.origin === 'subagent' || address !== undefined
  if (!isSubagent) return { isSubagent: false, mode: undefined, canCompose: true, readOnly: false }
  const matching = address !== undefined && address.childSessionId === snapshot?.sessionId
    && (summary === undefined || summary.id === address.childSessionId)
    && (summary?.parentId === undefined || summary.parentId === address.parentSessionId)
  const mode = matching && (address.mode === 'one-shot' || address.mode === 'continuable') ? address.mode : undefined
  return { isSubagent: true, mode, canCompose: mode === 'continuable', readOnly: mode !== 'continuable' }
}
