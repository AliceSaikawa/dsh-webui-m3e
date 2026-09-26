import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { countInbox } from './model.ts'
import { useInbox } from './use-inbox.ts'

export function useInboxCount(): number {
  const { workspaces } = useDsh()
  const { archivedSessionIds } = useSnapshot(workspaces.list)
  const { list, pending } = useInbox()
  return countInbox(pending, list, archivedSessionIds)
}
