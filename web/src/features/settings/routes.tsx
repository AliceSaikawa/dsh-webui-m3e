import type { RouteDef } from '../../app/router.ts'
import { AgentPresetsPage } from './AgentPresetsPage.tsx'
import { SettingsScreen } from './SettingsScreen.tsx'
import { SettingsDetailScreen } from './SettingsDetailScreen.tsx'
export const routes: RouteDef[] = [
  { path: '/settings', tab: 'settings', render: () => <SettingsScreen /> },
  // Before the generic detail route: both patterns have two segments.
  { path: '/settings/modes', render: () => <AgentPresetsPage /> },
  { path: '/settings/:page', render: ({ page }) => <SettingsDetailScreen key={page} page={page ?? ''} /> },
]
