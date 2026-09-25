import { useMemo } from 'react'
import { useDsh, type ObservableSnapshot, type SessionFace, type SessionSnapshot } from './services.ts'
import { journalOf } from './session-journal.ts'
import { useSnapshot } from './use-snapshot.ts'

export type { AssistantStream, SessionJournal } from './session-journal.ts'
export type { ISession, SessionFace, SessionSnapshot } from './services.ts'

const absentProjection: ObservableSnapshot<unknown> = { getSnapshot: () => undefined, subscribe: () => () => {} }

/** Read one projection at component top level, following the normal hook rules. */
export function useSessionProjection<T = unknown>(face: SessionFace | undefined, key: string): T | undefined {
  return useSnapshot(face?.projections.faceOf(key) ?? absentProjection) as T | undefined
}

function missingSession(id: string, pending: boolean): ObservableSnapshot<SessionSnapshot> {
  const snapshot: SessionSnapshot = {
    sessionId: id, queue: [], pendingSubmissions: [], running: false, subagent: null,
    removed: !pending, openState: pending ? 'loading' : 'error',
    openError: pending ? null : { code: 'session/not-found', message: '会話が見つかりません。', details: {} },
    hasMore: false, loadingOlder: false, promptError: null, blank: true,
    lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false,
  }
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

/**
 * The controller owns scope lifetime, follow, reconnect baseline and pagination.
 * Every feature sees the same face and journal. No consumer starts its own feed.
 * Reading a session never changes selection; Frame manages it from the URL.
 * `projection(key)` is a hook: call it unconditionally at component top level.
 */
export function useSession(id: string) {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const ctx = sessions.scope(id)
  const face = ctx === undefined ? undefined : sessions.sessionOf(ctx)
  const binding = sessions.binding(id)
  const fallback = useMemo(() => missingSession(id, list.phase === 'pending'), [id, list.phase])
  const snapshot = useSnapshot(face ?? fallback)
  const journal = useSnapshot(journalOf(binding))

  const projection = useMemo(() => function useProjection<T = unknown>(key: string): T | undefined {
    return useSessionProjection<T>(face, key)
  }, [face])

  return { face, snapshot, records: journal.records, stream: journal.stream, projection, ctx }
}
