import type { RouteDef } from '../../app/router.ts'
import { HomeScreen } from './HomeScreen.tsx'
import { DirectoryScreen } from './DirectoryScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/', tab: 'home', render: () => <HomeScreen /> },
  { path: '/workspaces/add', render: () => <DirectoryScreen /> },
]
