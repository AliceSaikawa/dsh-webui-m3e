import { usePendingInteractions } from '../../dsh/interactions.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'

/** Shared inputs keep the navigation badge and screen in sync on every tab. */
export function useInbox() {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const pending = usePendingInteractions()
  return { list, pending }
}
