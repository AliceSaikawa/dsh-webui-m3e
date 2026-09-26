import { useEffect, useRef, useState } from 'react'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { presentInteraction } from '../interactions/InteractionSheet.tsx'
import { buildInboxRows, inboxStatus } from './model.ts'
import { useInbox } from './use-inbox.ts'
import { openInboxSession } from './session-navigation.ts'
import './inbox.css'

export function InboxScreen() {
  const { workspaces, sessions } = useDsh()
  const workspaceList = useSnapshot(workspaces.list)
  const { list, pending } = useInbox()
  const [now, setNow] = useState(Date.now)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const navigationAttempt = useRef(0)
  useEffect(() => () => { navigationAttempt.current++ }, [])
  const rows = buildInboxRows(pending, list, workspaceList, now)
  const status = inboxStatus(rows, list, workspaceList)
  const hasCompleted = rows.completed.length > 0
  const hasRows = rows.pending.length > 0 || hasCompleted
  useEffect(() => {
    if (!hasCompleted) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [hasCompleted])

  async function openCompleted(sessionId: string) {
    const attempt = ++navigationAttempt.current
    const origin = window.location.hash
    const isActive = () => navigationAttempt.current === attempt && window.location.hash === origin
    setOpeningId(sessionId)
    try { await openInboxSession(sessions, sessionId, navigate, isActive) }
    catch (error) { if (isActive()) showSnackbar(remoteErrorMessage(error, '会話を開けませんでした。もう一度お試しください。')) }
    // Clear even after an unrelated hash change so the rows cannot stay disabled.
    finally { if (navigationAttempt.current === attempt) setOpeningId(null) }
  }

  return <TabScaffold title="対応待ち">
    <div className={`inbox-content${!hasRows ? ' inbox-is-empty' : ''}`}>
      <div className="inbox-notices">
        {status.workspaceError && <p className="inbox-error" role="alert">{status.workspaceError}</p>}
        {hasRows && status.loadingMessage && <p className="inbox-loading" role="status">{status.loadingMessage}</p>}
        {openingId && <p className="inbox-loading" role="status">会話を開いています</p>}
      </div>
      {rows.pending.length > 0 && <section className="inbox-section" aria-labelledby="inbox-pending-heading">
        <h2 id="inbox-pending-heading">返事が必要</h2>
        <M3eActionList aria-label="返事が必要">
          {rows.pending.map(row => <M3eListAction key={row.key} className="inbox-row"
            aria-label={`${row.title}、${row.workspaceName}、${row.description}`}
            onClick={() => {
              navigationAttempt.current++
              setOpeningId(null)
              presentInteraction(row.pending, { from: 'inbox' })
            }}>
            <Icon slot="leading" name={row.icon} />
            <span className="inbox-title">{row.title}</span>
            <span slot="supporting-text" className="inbox-description"><small>{row.workspaceName}</small> ・ {row.description}</span>
          </M3eListAction>)}
        </M3eActionList>
      </section>}
      {hasCompleted && <section className="inbox-section" aria-labelledby="inbox-completed-heading">
        <h2 id="inbox-completed-heading">終わったもの</h2>
        <M3eActionList aria-label="終わったもの">
          {rows.completed.map(row => <M3eListAction key={row.key} className="inbox-row"
            aria-label={`${row.title}、${row.workspaceName}、${row.description}`}
            disabled={openingId !== null}
            onClick={() => { void openCompleted(row.sessionId) }}>
            <Icon slot="leading" name={row.icon} />
            <span className="inbox-title">{row.title}</span>
            <span slot="supporting-text" className="inbox-description"><small>{row.workspaceName}</small> ・ {row.description}</span>
          </M3eListAction>)}
        </M3eActionList>
      </section>}
      {!hasRows && <div className="inbox-empty" role="status">
        <Icon name={status.loadingMessage ? 'hourglass_empty' : 'front_hand'} />
        {status.loadingMessage ? <p>{status.loadingMessage}</p> : status.showEmpty && <p>対応待ちはありません</p>}
      </div>}
    </div>
  </TabScaffold>
}
