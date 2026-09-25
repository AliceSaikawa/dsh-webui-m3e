import { remoteFailureOf, RemoteCallError } from '../../dsh/remote-result.ts'

/** The stock workspace facade discards structured failures for these operations. */
export function normalizeWorkspaceError(error: unknown): unknown {
  if (remoteFailureOf(error) || !(error instanceof Error)) return error
  const match = /^workspace (?:rename|delete|reorder|session archive|move) failed: ([^:\s]+): ([\s\S]*)$/.exec(error.message)
  if (!match) return error
  return new RemoteCallError({ code: match[1]!, message: match[2]!, details: {} })
}

/** Preserve rejection so TextPromptDialog can present the error beside its input. */
export async function workspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) { throw normalizeWorkspaceError(error) }
}
