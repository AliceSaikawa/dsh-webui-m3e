import type { RouteDef } from '../../app/router.ts'
import { SearchScreen } from './SearchScreen.tsx'
export const routes: RouteDef[] = [{ path: '/search', tab: 'search', render: () => <SearchScreen /> }]
