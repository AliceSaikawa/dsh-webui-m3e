import type { useSession } from '../../dsh/session.ts'
import { traceText, type TraceMessages } from './messages.ts'

export type TraceSessionData = Pick<ReturnType<typeof useSession>, 'face' | 'snapshot' | 'records' | 'stream'>

/** Keep the rendered panel's props stable while its session feed stays subscribed. */
export function retainTraceSession(previous: TraceSessionData | null, next: TraceSessionData, active: boolean): TraceSessionData | null {
  if (!active) return previous
  if (previous?.face === next.face && previous?.snapshot === next.snapshot
    && previous?.records === next.records && previous?.stream === next.stream) return previous
  return next
}

export function traceEmptyMessage(openState: TraceSessionData['snapshot']['openState'], text: TraceMessages = traceText): string {
  return openState === 'open' ? text.emptyLoaded : text.emptyLoading
}
