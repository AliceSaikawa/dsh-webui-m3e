import { remoteFailureOf, RemoteCallError } from './remote-result.ts'

/** The workspace facade stringifies these failures instead of preserving their code. */
export function normalizeWorkspaceError(error: unknown): unknown {
  if (remoteFailureOf(error) || !(error instanceof Error)) return error
  const match = /^workspace (?:rename|delete|reorder|session archive|move) failed: ([^:\s]+): ([\s\S]*)$/.exec(error.message)
  if (!match) return error
  return new RemoteCallError({ code: match[1]!, message: match[2]!, details: {} })
}

/** Keep rejections so callers can choose an inline message or a snackbar. */
export async function workspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) { throw normalizeWorkspaceError(error) }
}
