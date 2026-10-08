import type { RouteDef } from '../../app/router.ts'
import { ConversationScreen } from './ConversationScreen.tsx'
import { conversationPaths } from '../../app/conversation-route.ts'
export const routes: RouteDef[] = [
  { path: conversationPaths.chat, render: params => <ConversationScreen key={params.id} sessionId={params.id!} /> },
  { path: conversationPaths.trace, render: params => <ConversationScreen key={params.id} sessionId={params.id!} tab="trace" /> },
]
