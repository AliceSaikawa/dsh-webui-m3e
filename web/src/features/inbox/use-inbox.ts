import { usePendingInteractions } from '../../dsh/interactions.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { completionStatus } from '../../dsh/completion-status.ts'

/** Shared inputs keep the navigation badge and screen in sync on every tab. */
export function useInbox() {
  const { ctx } = useDsh()
  const list = useSnapshot(completionStatus(ctx))
  const pending = usePendingInteractions()
  return { list, pending }
}
