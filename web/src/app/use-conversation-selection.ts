import { useLayoutEffect, useMemo } from 'react'
import { useDsh } from '../dsh/services.ts'
import { useSnapshot } from '../dsh/use-snapshot.ts'
import { conversationSessionId, syncConversationSelection } from '../dsh/conversation-selection.ts'

/** URL selection spans chat, trace and independently mounted tools. */
export function useConversationSelection(pathname: string): void {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const sessionId = conversationSessionId(pathname)
  const scope = sessionId === undefined ? undefined : sessions.scope(sessionId)
  const face = scope === undefined ? undefined : sessions.sessionOf(scope)
  const availability = useMemo(() => ({
    getSnapshot: () => !!face && !face.getSnapshot().removed,
    subscribe: (listener: () => void) => face?.subscribe(listener) ?? (() => {}),
  }), [face])
  const canOpen = useSnapshot(availability)
  // Observe restored selection outside a conversation. Inside one, a menu can
  // select a child before navigation; do not undo that selection in between.
  const outsideSelection = sessionId === undefined ? list.current : undefined
  const phase = list.phase
  useLayoutEffect(() => {
    syncConversationSelection(sessions, sessionId, canOpen)
  }, [sessions, sessionId, canOpen, phase, outsideSelection])
}

/** Keep list and face subscriptions out of Frame and the visible screen tree. */
export function ConversationSelection({ pathname }: { pathname: string }): null {
  useConversationSelection(pathname)
  return null
}
