import type { RouteDef } from '../../app/router.ts'
import { SettingsScreen } from './SettingsScreen.tsx'
import { SettingsDetailScreen } from './SettingsDetailScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/settings', tab: 'settings', render: () => <SettingsScreen /> },
  { path: '/settings/:page', render: ({ page }) => <SettingsDetailScreen key={page} page={page ?? ''} /> },
]
