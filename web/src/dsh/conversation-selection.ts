import type { ISessions } from './services.ts'

/** The conversation and every nested tools page belong to the same session. */
export function conversationSessionId(pathname: string): string | undefined {
  const encoded = /^\/s\/([^/]+)(?:\/|$)/.exec(pathname)?.[1]
  if (!encoded) return undefined
  try { return decodeURIComponent(encoded) || undefined }
  catch { return undefined }
}

/** Match the controller's selectability independently of the first list fetch. */
export function canSelectConversation(
  sessions: Pick<ISessions, 'list' | 'subagentAddress'>,
  sessionId: string | undefined,
): boolean {
  return sessionId !== undefined && (!!sessions.list.getSnapshot().byId[sessionId] || sessions.subagentAddress(sessionId) !== undefined)
}

/** Reconcile URL entry and selectability changes, without per-screen cleanup. */
export function syncConversationSelection(
  sessions: Pick<ISessions, 'list' | 'open' | 'clear' | 'subagentAddress'>,
  sessionId: string | undefined,
  canOpen: boolean,
): void {
  const { current, phase } = sessions.list.getSnapshot()
  if (sessionId === undefined) {
    // Boot may restore selection after the initial render. Wait for its baseline.
    if (phase === 'ready' && current !== undefined) sessions.clear()
  } else if (canOpen && current !== sessionId && canSelectConversation(sessions, sessionId)) {
    try { sessions.open(sessionId) }
    catch (error) { console.error(`会話を選択できませんでした: ${sessionId}`, error) }
  }
}
