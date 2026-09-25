import type { ISessions, SessionFace } from './services.ts'

/** Own selection only while this conversation screen is mounted. */
export function enterConversation(
  sessions: Pick<ISessions, 'list' | 'open' | 'clear'>,
  sessionId: string,
  face: Pick<SessionFace, 'getSnapshot'> | undefined,
): () => void {
  if (!face || face.getSnapshot().removed) return () => {}
  // A valid failed session must still be selected: the real controller retries
  // its history when returning from a different conversation.
  sessions.open(sessionId)
  let released = false
  return () => {
    if (released) return
    released = true
    // Another navigation may already have selected a child or a new session.
    if (sessions.list.getSnapshot().current === sessionId) sessions.clear()
  }
}
