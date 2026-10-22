import { useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { openDialog, openSheet, showSnackbar, TextPromptDialog } from '../../app/overlay/index.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { DshServices, WorkspaceView, SessionSummary } from '../../dsh/services.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import { messagesOf } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/index.ts'
import type { HomeMessages } from './data.ts'
import { homeMessages } from './messages.ts'
import { normalizeWorkspaceError, workspaceOperation } from './workspace-errors.ts'

/** The texts of this sheet in the page language at the moment they are shown. */
function liveText(): HomeMessages {
  return messagesOf(homeMessages, currentLocale())
}

export async function attempt(action: () => Promise<unknown>): Promise<boolean> {
  try { await action(); return true }
  catch (error) { showSnackbar(remoteErrorMessage(normalizeWorkspaceError(error))); return false }
}

function prompt(title: string, initialValue: string, save: (value: string) => Promise<unknown>) {
  openDialog(close => <TextPromptDialog title={title} initialValue={initialValue} onCancel={close}
    onConfirm={async value => { await save(value); close() }} />, { label: title })
}

export function renameWorkspace(dsh: DshServices, workspace: WorkspaceView, text: HomeMessages = liveText()) {
  prompt(text.renameWorkspaceTitle, workspace.title, title => workspaceOperation(() => dsh.workspaces.rename(workspace.workspaceId, title)))
}

async function setPinned(dsh: DshServices, row: SessionSummary, pinned: boolean, text: HomeMessages): Promise<void> {
  if (await attempt(() => pinned ? dsh.workspaces.pinSession(row.id) : dsh.workspaces.unpinSession(row.id))) {
    showSnackbar(pinned ? text.pinnedDone : text.unpinnedDone)
  }
}

async function unarchive(dsh: DshServices, row: SessionSummary, text: HomeMessages): Promise<void> {
  if (await attempt(() => dsh.workspaces.unarchiveSession(row.id))) showSnackbar(text.unarchivedDone)
}

export function sessionActions(dsh: DshServices, row: SessionSummary, archive: () => void, pinned: boolean, archived: boolean, text: HomeMessages = liveText()) {
  if (row.origin === 'subagent') return
  openSheet(close => <div className="home-actions"><h2>{row.displayTitle}</h2>
    <M3eButton onClick={() => {
      close()
      prompt(text.renameSessionTitle, row.displayTitle, async title => {
        await dsh.sessions.using(row.id, { source: 'm3e.rename' }, async reference => {
          unwrapRemoteResult(await reference.binding.session.rename(title))
        })
      })
    }}><Icon name="edit" />{text.renameSessionTitle}</M3eButton>
    {archived
      ? <M3eButton onClick={() => { close(); void unarchive(dsh, row, text) }}><Icon name="unarchive" />{text.unarchiveAction}</M3eButton>
      : <>{pinned
        ? <M3eButton onClick={() => { close(); void setPinned(dsh, row, false, text) }}><Icon name="keep_off" />{text.unpinAction}</M3eButton>
        : <M3eButton onClick={() => { close(); void setPinned(dsh, row, true, text) }}><Icon name="push_pin" />{text.pinAction}</M3eButton>}
        <M3eButton onClick={() => { close(); archive() }}><Icon name="inventory_2" />{text.archive}</M3eButton></>}
  </div>, { label: row.displayTitle })
}

function DeleteWorkspace({ dsh, workspace, close, text }: { dsh: DshServices; workspace: WorkspaceView; close(): void; text: HomeMessages }) {
  const [busy, setBusy] = useState(false)
  return <div><h2>{text.removeWorkspaceQuestion}</h2><p>{text.removeWorkspaceDescription(workspace.title)}</p>
    <div className="actions"><M3eButton disabled={busy} onClick={close}>{text.cancel}</M3eButton>
      <M3eButton variant="filled" disabled={busy} onClick={async () => {
        setBusy(true)
        if (await attempt(() => dsh.workspaces.delete(workspace.workspaceId))) { close(); showSnackbar(liveText().removedWorkspace) }
        setBusy(false)
      }}>{text.removeWorkspaceAction}</M3eButton></div></div>
}

function WorkspaceOrder({ dsh, workspace, items, close, text }: { dsh: DshServices; workspace: WorkspaceView; items: readonly WorkspaceView[]; close(): void; text: HomeMessages }) {
  const [busy, setBusy] = useState(false)
  const move = async (before?: string) => {
    if (busy) return
    setBusy(true)
    if (await attempt(() => dsh.workspaces.insertBefore(workspace.workspaceId, before))) close()
    setBusy(false)
  }
  return <div className="home-actions"><h2>{text.reorderWorkspaces}</h2><p>{text.reorderWorkspacesHint(workspace.title)}</p>
    {items.filter(item => item.workspaceId !== workspace.workspaceId).map(item => <M3eButton key={item.workspaceId} disabled={busy}
      onClick={() => { void move(item.workspaceId) }}>{text.moveWorkspaceBefore(item.title)}</M3eButton>)}
    <M3eButton disabled={busy} onClick={() => { void move() }}>{text.moveLast}</M3eButton>
  </div>
}

export function workspaceActions(dsh: DshServices, workspace: WorkspaceView, items: readonly WorkspaceView[], text: HomeMessages = liveText()) {
  openSheet(close => <div className="home-actions"><h2>{text.workspaceActions}</h2><p className="muted">{workspace.title}</p>
    <M3eButton onClick={() => { close(); renameWorkspace(dsh, workspace, text) }}><Icon name="edit" />{text.renameAction}</M3eButton>
    <M3eButton onClick={() => { close(); openSheet(done => <WorkspaceOrder dsh={dsh} workspace={workspace} items={items} close={done} text={text} />, { label: text.reorderWorkspaces }) }}><Icon name="sort" />{text.sortAction}</M3eButton>
    <M3eButton onClick={() => { close(); openDialog(done => <DeleteWorkspace dsh={dsh} workspace={workspace} close={done} text={text} />, { label: text.removeWorkspaceLabel }) }}><Icon name="folder_off" />{text.removeWorkspaceAction}</M3eButton>
  </div>, { label: text.workspaceActions })
}
