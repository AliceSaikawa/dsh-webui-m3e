import type { RouteDef } from '../../app/router.ts'
import { ConversationScreen } from './ConversationScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/s/:id', render: params => <ConversationScreen key={params.id} sessionId={params.id!} /> },
  { path: '/s/:id/trace', render: params => <ConversationScreen key={params.id} sessionId={params.id!} tab="trace" /> },
]
