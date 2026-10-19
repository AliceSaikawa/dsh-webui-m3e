import { useEffect, useRef, useState } from 'react'
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
import { useMessages } from '../../i18n/index.ts'
import { sessionToolsMessages } from './messages.ts'

export function SubagentsScreen({ sessionId }: { sessionId: string }) {
  const text = useMessages(sessionToolsMessages)
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const catalog = list.projectionsBySession[sessionId]
  const entries = catalogEntries(catalog, list.byId)
  const { children, externals, diagnosticCount } = catalogRows(entries)
  const [error, setError] = useState('')
  const openingLifetime = useRef<AbortController | undefined>(undefined)
  const lifetime = useRef({ active: true, request: 0 })
  useEffect(() => { lifetime.current.active = true; return () => { lifetime.current.active = false; lifetime.current.request++; openingLifetime.current?.abort() } }, [sessions, sessionId])
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void sessions.refreshProjections(sessionId).catch(error => { if (active) setError(remoteErrorMessage(error, text.subagentsLoadFailed)) })
    return () => { active = false }
  }, [sessions, sessionId, retry])
  async function open(child: Child) {
    openingLifetime.current?.abort()
    openingLifetime.current = new AbortController()
    const request = ++lifetime.current.request
    const origin = window.location.hash
    const active = () => window.location.hash === origin && lifetime.current.active && request === lifetime.current.request
    try { await conversationSelection(sessions).prepare(childAddress(sessionId, child), active, () => navigate(`/s/${encodeURIComponent(child.id)}`), openingLifetime.current.signal) }
    catch (error) { if (active()) setError(remoteErrorMessage(error, text.childOpenFailed)) }
  }
  const migrationRequired = catalog?.state === 'migration-required' && !entries.length
  return <PageScaffold title={text.subagents}><div className="st-content">
    {(!catalog || catalog.state === 'loading') && <p role="status">{text.loading}</p>}
    {(error || catalog?.state === 'error') && <div className="st-error" role="alert"><p>{error || remoteErrorMessage(catalog?.error, text.subagentsLoadFailed)}</p><M3eButton onClick={() => setRetry(value => value + 1)}>{text.subagentsRetry}</M3eButton></div>}
    {migrationRequired && <p role="status">{text.subagentsMigrationRequired}</p>}
    {catalog?.state === 'ready' && !entries.length && <p>{text.noChildren}</p>}
    <M3eActionList className="st-list" aria-label={text.childListLabel}>
      {diagnosticCount > 0 && <M3eListItem><Icon slot="leading" name="info" />{text.diagnosticEntries(diagnosticCount)}</M3eListItem>}
      {externals.map(entry => <M3eListItem key={entry.id}>
          <Icon slot="leading" name="smart_toy" />
          {entry.label || text.externalTask}
          <span slot="supporting-text">{text.externalTask}</span>
        </M3eListItem>)}
      {children.map(entry => <M3eListAction key={entry.id} onClick={() => open(entry)}>
          <Icon slot="leading" name="smart_toy" />
          {entry.label || list.byId[entry.id]?.displayTitle || text.childSessionFallback}
          <span slot="supporting-text">{text.childStateLine(entry.migrationRequired ? text.childMigrationRequired : entry.activity === 'running' ? text.childRunning : text.childEnded, entry.mode === 'continuable' ? text.retryableChild : text.oneShotChild)}</span>
          <Icon slot="trailing" name="chevron_right" />
        </M3eListAction>)}
    </M3eActionList>
  </div></PageScaffold>
}
