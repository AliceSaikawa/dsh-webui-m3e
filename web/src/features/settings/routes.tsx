import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { SettingsScreen } from './SettingsScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/settings', tab: 'settings', render: () => <SettingsScreen /> },
  { path: '/settings/:page', render: () => <PageScaffold title="設定の詳細"><p className="page-padding">準備中です</p></PageScaffold> },
]
