import type { RouteDef } from '../../app/router.ts'
import { PluginsScreen } from './PluginsScreen.tsx'

export const routes: RouteDef[] = [
  { path: '/settings/plugins', render: () => <PluginsScreen /> },
]
