import { useEffect, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction, M3eListItem } from '@m3e/react/list'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { catalogEntries, catalogRows, childAddress, type Child } from './presentation.ts'
import { conversationSelection } from '../../dsh/conversation-selection.ts'

export function SubagentsScreen({ sessionId }: { sessionId: string }) {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const catalog = list.projectionsBySession[sessionId]
  const entries = catalogEntries(catalog, list.byId)
  const { children, diagnosticCount } = catalogRows(entries)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void sessions.refreshProjections(sessionId).catch(error => { if (active) setError(remoteErrorMessage(error, 'サブエージェントを読み込めませんでした。')) })
    return () => { active = false }
  }, [sessions, sessionId, retry])
  async function open(child: Child) {
    try { if (await conversationSelection(sessions).select(childAddress(sessionId, child))) navigate(`/s/${encodeURIComponent(child.id)}`) }
    catch (error) { setError(remoteErrorMessage(error, '子の会話を開けませんでした。読み直してお試しください。')) }
  }
  return <PageScaffold title="サブエージェント"><div className="st-content">
    {(!catalog || catalog.state === 'loading') && <p role="status">読み込み中です…</p>}
    {(error || catalog?.state === 'error') && <div className="st-error" role="alert"><p>{error || remoteErrorMessage(catalog?.error, 'サブエージェントを読み込めませんでした。')}</p><M3eButton onClick={() => setRetry(value => value + 1)}>読み直す</M3eButton></div>}
    {catalog?.state === 'ready' && !entries.length && <p>サブエージェントはありません</p>}
    <M3eActionList className="st-list" aria-label="子の会話">
      {diagnosticCount > 0 && <M3eListItem><Icon slot="leading" name="info" />読み込めない記録があります（{diagnosticCount} 件）</M3eListItem>}
      {children.map(entry => <M3eListAction key={entry.id} onClick={() => open(entry)}>
          <Icon slot="leading" name="smart_toy" />
          {entry.label || list.byId[entry.id]?.displayTitle || '子の会話'}
          <span slot="supporting-text">{entry.activity === 'running' ? '実行中' : '終了'} ・ {entry.mode === 'continuable' ? '続けて頼める' : '1 回限り'}</span>
          <Icon slot="trailing" name="chevron_right" />
        </M3eListAction>)}
    </M3eActionList>
  </div></PageScaffold>
}
