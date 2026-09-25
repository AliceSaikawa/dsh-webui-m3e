import type { RouteDef } from '../../app/router.ts'
import { InboxScreen } from './InboxScreen.tsx'
export const routes: RouteDef[] = [{ path: '/inbox', tab: 'inbox', render: () => <InboxScreen /> }]
