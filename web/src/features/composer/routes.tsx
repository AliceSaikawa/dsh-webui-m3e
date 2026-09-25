import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { Composer } from './Composer.tsx'
export const routes: RouteDef[] = [{ path: '/new', render: params => <PageScaffold title="新しいセッション"
  footer={<Composer target={{ kind: 'new', workspaceId: params.ws ?? '' }} />}><div className="placeholder"><h2>何をしますか</h2></div></PageScaffold> }]
