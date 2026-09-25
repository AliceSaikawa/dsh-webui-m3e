import type { ISessions } from './services.ts'

/** The conversation and every nested tools page belong to the same session. */
export function conversationSessionId(pathname: string): string | undefined {
  const encoded = /^\/s\/([^/]+)(?:\/|$)/.exec(pathname)?.[1]
  if (!encoded) return undefined
  try { return decodeURIComponent(encoded) || undefined }
  catch { return undefined }
}

/** Reconcile URL entry and readiness changes, without per-screen cleanup. */
export function syncConversationSelection(
  sessions: Pick<ISessions, 'list' | 'open' | 'clear'>,
  sessionId: string | undefined,
  canOpen: boolean,
): void {
  const { current, phase } = sessions.list.getSnapshot()
  // A request can create a scope before the list baseline makes it selectable.
  if (phase !== 'ready') return
  if (sessionId === undefined) {
    // Boot may restore selection after the initial render. Wait for its baseline.
    if (current !== undefined) sessions.clear()
  } else if (canOpen && current !== sessionId) {
    try { sessions.open(sessionId) }
    catch (error) { console.error(`会話を選択できませんでした: ${sessionId}`, error) }
  }
}
