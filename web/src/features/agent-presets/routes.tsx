import type { RouteDef } from '../../app/router.ts'
import { ModesScreen } from './ModesScreen.tsx'

export const routes: RouteDef[] = [
  { path: '/settings/modes', render: () => <ModesScreen /> },
]
