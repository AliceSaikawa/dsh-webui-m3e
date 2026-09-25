import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { HomeScreen } from './HomeScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/', tab: 'home', render: () => <HomeScreen /> },
  { path: '/workspaces/add', render: () => <PageScaffold title="フォルダの選択"><p className="page-padding">準備中です</p></PageScaffold> },
]
