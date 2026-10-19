import { useId, useRef, useState } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eMenu, M3eMenuItem, M3eMenuTrigger, type M3eMenuElement } from '@m3e/react/menu'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, openSheet, showSnackbar, TextPromptDialog } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { useSessionJobs } from '../../dsh/jobs.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { hasChildren, menuActions, runningJobCount, type MenuAction } from './presentation.ts'
import { useMessages } from '../../i18n/index.ts'
import { sessionToolsMessages } from './messages.ts'
import { StatsSheet } from './StatsSheet.tsx'
import './session-tools.css'

const menuIcons: Record<MenuAction, string> = {
  rename: 'edit', stats: 'monitoring', files: 'folder',
  jobs: 'pending_actions', subagents: 'account_tree', goal: 'flag', archive: 'inventory_2',
}

export function SessionMenuButton({ sessionId }: { sessionId: string }) {
  const text = useMessages(sessionToolsMessages)
  const menuLabels: Record<MenuAction, string> = {
    rename: text.rename, stats: text.stats, files: text.files,
    jobs: text.jobs, subagents: text.subagents, goal: text.goal, archive: text.archive,
  }
  const { sessions, workspaces } = useDsh()
  const list = useSnapshot(sessions.list)
  const { face, projection, snapshot } = useSession(sessionId)
  const goal = projection<{ goal: unknown }>('goal')?.goal
  const id = useId()
  const menu = useRef<M3eMenuElement>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const jobRows = useSessionJobs(sessionId)
  const count = runningJobCount(jobRows.rows)
  const items = menuActions(hasChildren(sessionId, list.projectionsBySession[sessionId], list.byId), goal)

  async function select(action: MenuAction) {
    if (pending.current) return
    menu.current?.hide()
    if (action === 'rename') {
      if (!face) return
      openDialog(close => <TextPromptDialog title={text.rename} label={text.renameField} initialValue={list.byId[sessionId]?.displayTitle ?? ''}
        onCancel={close} onConfirm={async title => { await sessions.using(sessionId, { source: 'm3e.rename' }, async reference => unwrapRemoteResult(await reference.binding.session.rename(title))); close(); showSnackbar(text.renamed) }} />, { label: text.rename })
    } else if (action === 'stats') {
      openSheet(close => <StatsSheet sessionId={sessionId} close={close} />, { label: text.stats })
    } else if (action === 'archive') {
      pending.current = true
      setBusy(true)
      try { await workspaces.archiveSession(sessionId); navigate('/', { replace: true }); showSnackbar(text.archived) }
      catch (error) { showSnackbar(remoteErrorMessage(error, text.archiveFailed)) }
      finally { pending.current = false; setBusy(false) }
    } else navigate(`/s/${encodeURIComponent(sessionId)}/${action}`)
  }
  return <>
    <M3eIconButton aria-label={text.menuLabel} disabled={busy}>
      <M3eMenuTrigger htmlFor={id}><Icon name="more_vert" /></M3eMenuTrigger>
    </M3eIconButton>
    <M3eMenu ref={menu} id={id} positionX="before" positionY="below" className="st-menu" aria-label={text.menuLabel}>
      {items.map(action => <M3eMenuItem key={action} disabled={busy || ((action === 'rename' || action === 'archive') && (!face || snapshot.removed || !!snapshot.subagent))} onClick={() => { void select(action) }}>
        <Icon name={menuIcons[action]} slot="icon" />{menuLabels[action]}
        {action === 'jobs' && jobRows.status !== 'ready' && <span slot="trailing-icon" aria-label={jobRows.status === 'error' ? text.jobsCheckingFailed : text.jobsChecking}><Icon name={jobRows.status === 'error' ? 'error' : 'pending'} /></span>}
        {action === 'jobs' && jobRows.status === 'ready' && count > 0 && <span slot="trailing-icon" className="st-badge" aria-label={text.liveJobCount(count)}>{count}</span>}
      </M3eMenuItem>)}
    </M3eMenu>
  </>
}
