import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { Composer } from './Composer.tsx'

function NewSession({ workspaceId }: { workspaceId: string }) {
  const { workspaces } = useDsh()
  const snapshot = useSnapshot(workspaces.list)
  const workspace = snapshot.items.find(item => item.workspaceId === workspaceId)
  return <PageScaffold title="新しいセッション" footer={workspace ? <Composer target={{ kind: 'new', workspaceId }} /> : undefined}>
    <div className="composer-new-intro"><h2>何をしますか</h2><p>{workspace ? `${workspace.title} で始めます` : snapshot.phase === 'pending' ? 'ワークスペースを読み込んでいます…' : 'ワークスペースが見つかりません。一覧に戻って選び直してください。'}</p></div>
  </PageScaffold>
}
export const routes: RouteDef[] = [{ path: '/new', render: params => <NewSession workspaceId={params.ws ?? ''} /> }]
