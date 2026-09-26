import { useLayoutEffect, useMemo } from 'react'
import { useDsh } from '../dsh/services.ts'
import { useSnapshot } from '../dsh/use-snapshot.ts'
import { canSelectConversation, conversationSessionId, createConversationVisitTracker, syncConversationSelection } from '../dsh/conversation-selection.ts'
import { openConversationSession } from '../dsh/session-navigation.ts'
import { resetDeferred } from '../dsh/interactions.ts'
import { remoteErrorMessage } from '../dsh/remote-result.ts'
import { showSnackbar } from './overlay/index.ts'

/** URL selection spans chat, trace and independently mounted tools. */
export function useConversationSelection(pathname: string): void {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const sessionId = conversationSessionId(pathname)
  const selectable = canSelectConversation(sessions, sessionId)
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
  const parentSessionId = sessionId === undefined ? undefined : list.byId[sessionId]?.parentId
  const origin = sessionId === undefined ? undefined : list.byId[sessionId]?.origin
  const visit = useMemo(() => createConversationVisitTracker(resetDeferred), [sessions])
  useLayoutEffect(() => { visit(sessionId) }, [visit, sessionId])
  useLayoutEffect(() => {
    if (sessionId === undefined) {
      syncConversationSelection(sessions, undefined, false)
      return
    }
    if (!canOpen || !selectable) return
    let active = true
    void openConversationSession(sessions, sessionId, () => active).catch((error: unknown) => {
      if (!active) return
      console.error(`会話を選択できませんでした: ${sessionId}`, error)
      showSnackbar(remoteErrorMessage(error, '会話を開けませんでした。もう一度お試しください。'))
    })
    return () => { active = false }
  }, [sessions, sessionId, canOpen, selectable, phase, outsideSelection, parentSessionId, origin])
}

/** Keep list and face subscriptions out of Frame and the visible screen tree. */
export function ConversationSelection({ pathname }: { pathname: string }): null {
  useConversationSelection(pathname)
  return null
}
