import { M3eButton } from '@m3e/react/button'
import { M3eFab } from '@m3e/react/fab'
import { TabScaffold, useConnection } from '../../app/shell/index.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'

/** Stage 01 replaces this placeholder; keep HomeScreen() unchanged. */
export function HomeScreen() {
  const { sessions, workspaces } = useDsh()
  const list = useSnapshot(sessions.list)
  const workspace = useSnapshot(workspaces.list).items[0]
  const { connected } = useConnection()
  return <TabScaffold title={workspace?.title ?? '一覧'} fab={<M3eFab aria-label="新しいセッション" disabled={!connected || !workspace}
    onClick={() => navigate(`/new?ws=${encodeURIComponent(workspace?.workspaceId ?? '')}`)}><Icon name="add" /></M3eFab>}>
    <div className="page-padding"><p className="muted">セッション一覧</p><div className="placeholder-list">
      {list.ids.map(id => list.byId[id]).filter(row => !!row).map(row => <M3eButton key={row.id} variant="tonal" onClick={() => navigate(`/s/${encodeURIComponent(row.id)}`)}>{row.displayTitle}{row.running ? '（実行中）' : ''}</M3eButton>)}
      {list.ids.length === 0 && <p>セッションはありません</p>}
    </div></div>
  </TabScaffold>
}
