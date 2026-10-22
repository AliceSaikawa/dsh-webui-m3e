import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { useMessages } from '../../i18n/index.ts'
import { Composer } from './Composer.tsx'
import { composerMessages } from './messages.ts'

function NewSession({ workspaceId }: { workspaceId: string }) {
  const text = useMessages(composerMessages)
  const { workspaces } = useDsh()
  const snapshot = useSnapshot(workspaces.list)
  const workspace = snapshot.items.find(item => item.workspaceId === workspaceId)
  return <PageScaffold title={text.newSessionTitle} footer={workspace ? <Composer target={{ kind: 'new', workspaceId }} /> : undefined}>
    <div className="composer-new-intro"><h2>{text.newSessionHeading}</h2><p>{workspace ? text.newSessionStart(workspace.title) : snapshot.phase === 'pending' ? text.newSessionLoading : text.newSessionMissing}</p></div>
  </PageScaffold>
}
export const routes: RouteDef[] = [{ path: '/new', render: params => <NewSession workspaceId={params.ws ?? ''} /> }]
