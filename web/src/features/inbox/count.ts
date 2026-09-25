import { countInbox } from './model.ts'
import { useInbox } from './use-inbox.ts'

export function useInboxCount(): number {
  const { list, pending } = useInbox()
  return countInbox(pending, list)
}
