import { useId, useRef, useState } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eMenu, M3eMenuItem, M3eMenuTrigger, type M3eMenuElement } from '@m3e/react/menu'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, openSheet, showSnackbar, TextPromptDialog } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { hasChildren, menuActions, runningJobCount, type MenuAction } from './presentation.ts'
import { StatsSheet } from './StatsSheet.tsx'
import './session-tools.css'

const labels: Record<MenuAction, [string, string]> = {
  rename: ['題名を変える', 'edit'], stats: ['統計', 'bar_chart'], files: ['ファイル', 'folder'],
  jobs: ['ジョブ', 'work'], subagents: ['サブエージェント', 'account_tree'], goal: ['ゴール', 'flag'], archive: ['アーカイブ', 'archive'],
}

export function SessionMenuButton({ sessionId }: { sessionId: string }) {
  const { sessions, workspaces } = useDsh()
  const list = useSnapshot(sessions.list)
  const { face, projection, snapshot } = useSession(sessionId)
  const goal = projection<{ goal: unknown }>('goal')?.goal
  const id = useId()
  const menu = useRef<M3eMenuElement>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const count = runningJobCount(list.jobsBySession[sessionId])
  const items = menuActions(hasChildren(sessionId, list.subagentsByParent[sessionId], list.byId), goal)

  async function select(action: MenuAction) {
    if (pending.current) return
    menu.current?.hide()
    if (action === 'rename') {
      if (!face) return
      openDialog(close => <TextPromptDialog title="題名を変える" label="題名" initialValue={list.byId[sessionId]?.displayTitle ?? ''}
        onCancel={close} onConfirm={async title => { unwrapRemoteResult(await face.rename(title)); close(); showSnackbar('題名を変更しました') }} />, { label: '題名を変える' })
    } else if (action === 'stats') {
      openSheet(close => <StatsSheet sessionId={sessionId} close={close} />, { label: '統計' })
    } else if (action === 'archive') {
      pending.current = true
      setBusy(true)
      try { await workspaces.archiveSession(sessionId); navigate('/', { replace: true }); showSnackbar('アーカイブしました') }
      catch (error) { showSnackbar(remoteErrorMessage(error, 'アーカイブできませんでした。')) }
      finally { pending.current = false; setBusy(false) }
    } else navigate(`/s/${encodeURIComponent(sessionId)}/${action}`)
  }
  return <>
    <M3eIconButton aria-label="会話のメニュー" disabled={busy}>
      <M3eMenuTrigger htmlFor={id}><Icon name="more_vert" /></M3eMenuTrigger>
    </M3eIconButton>
    <M3eMenu ref={menu} id={id} positionX="before" positionY="below" className="st-menu" aria-label="会話のメニュー">
      {items.map(action => <M3eMenuItem key={action} disabled={busy || ((action === 'rename' || action === 'archive') && (!face || snapshot.removed || !!snapshot.subagent))} onClick={() => { void select(action) }}>
        <Icon name={labels[action][1]} slot="icon" />{labels[action][0]}
        {action === 'jobs' && count > 0 && <span slot="trailing-icon" className="st-badge" aria-label={`実行中・停止中 ${count} 件`}>{count}</span>}
      </M3eMenuItem>)}
    </M3eMenu>
  </>
}
