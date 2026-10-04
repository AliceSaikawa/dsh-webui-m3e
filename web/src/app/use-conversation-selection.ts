import { useLayoutEffect, useMemo } from 'react'
import { useDsh } from '../dsh/services.ts'
import { useSnapshot } from '../dsh/use-snapshot.ts'
import { conversationSelection, conversationSessionId, createConversationVisitTracker } from '../dsh/conversation-selection.ts'
import { completionStatus } from '../dsh/completion-status.ts'
import { resetDeferred } from '../dsh/interactions.ts'
import { remoteErrorMessage } from '../dsh/remote-result.ts'
import { showSnackbar } from './overlay/index.ts'

/** Effects convey intent; reference lifetime belongs to the root owner. */
export function useConversationSelection(pathname: string): void {
  const { ctx, sessions, workspaces } = useDsh()
  completionStatus(ctx)
  const list = useSnapshot(sessions.list)
  const workspaceList = useSnapshot(workspaces.list)
  const sessionId = conversationSessionId(pathname)
  const owner = conversationSelection(sessions)
  const visit = useMemo(() => createConversationVisitTracker(resetDeferred), [sessions])
  useLayoutEffect(() => { visit(sessionId) }, [visit, sessionId])
  useLayoutEffect(() => {
    if (sessionId !== undefined && (list.phase !== 'ready' || workspaceList.phase !== 'ready')) return
    void owner.select(sessionId).catch(error => {
      if (owner.state.getSnapshot().sessionId !== sessionId) return
      showSnackbar(remoteErrorMessage(error, '会話を開けませんでした。もう一度お試しください。'))
    })
  }, [owner, sessionId, list.phase, workspaceList.phase])
}

export function ConversationSelection({ pathname }: { pathname: string }): null {
  useConversationSelection(pathname)
  return null
}
