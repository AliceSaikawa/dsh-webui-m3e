import { useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { openDialog, openSheet, showSnackbar, TextPromptDialog } from '../../app/overlay/index.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { DshServices, WorkspaceView, SessionSummary } from '../../dsh/services.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import { normalizeWorkspaceError, workspaceOperation } from './workspace-errors.ts'

export async function attempt(action: () => Promise<unknown>): Promise<boolean> {
  try { await action(); return true }
  catch (error) { showSnackbar(remoteErrorMessage(normalizeWorkspaceError(error))); return false }
}

function prompt(title: string, initialValue: string, save: (value: string) => Promise<unknown>) {
  openDialog(close => <TextPromptDialog title={title} initialValue={initialValue} onCancel={close}
    onConfirm={async value => { await save(value); close() }} />, { label: title })
}

export function renameWorkspace(dsh: DshServices, workspace: WorkspaceView) {
  prompt('ワークスペースの名前を変える', workspace.title, title => workspaceOperation(() => dsh.workspaces.rename(workspace.workspaceId, title)))
}

export function sessionActions(dsh: DshServices, row: SessionSummary, archive: () => void) {
  if (row.origin === 'subagent') return
  openSheet(close => <div className="home-actions"><h2>セッションの操作</h2><p className="muted">{row.displayTitle}</p>
    <M3eButton onClick={() => {
      close()
      prompt('題名を変える', row.displayTitle, async title => {
        const scope = dsh.sessions.scope(row.id)
        const face = scope && dsh.sessions.sessionOf(scope)
        if (!face) throw new Error('会話が見つかりません。')
        unwrapRemoteResult(await face.rename(title))
      })
    }}><Icon name="edit" />題名を変える</M3eButton>
    <M3eButton onClick={() => { close(); archive() }}><Icon name="archive" />アーカイブ</M3eButton>
  </div>, { label: 'セッションの操作' })
}

function DeleteWorkspace({ dsh, workspace, close }: { dsh: DshServices; workspace: WorkspaceView; close(): void }) {
  const [busy, setBusy] = useState(false)
  return <div><h2>登録を解除しますか</h2><p>「{workspace.title}」の登録を解除します。フォルダの中身は消えません。</p>
    <div className="actions"><M3eButton disabled={busy} onClick={close}>キャンセル</M3eButton>
      <M3eButton variant="filled" disabled={busy} onClick={async () => {
        setBusy(true)
        if (await attempt(() => dsh.workspaces.delete(workspace.workspaceId))) { close(); showSnackbar('登録を解除しました') }
        setBusy(false)
      }}>登録を解除</M3eButton></div></div>
}

function WorkspaceOrder({ dsh, workspace, items, close }: { dsh: DshServices; workspace: WorkspaceView; items: readonly WorkspaceView[]; close(): void }) {
  const [busy, setBusy] = useState(false)
  const move = async (before?: string) => {
    if (busy) return
    setBusy(true)
    if (await attempt(() => dsh.workspaces.insertBefore(workspace.workspaceId, before))) close()
    setBusy(false)
  }
  return <div className="home-actions"><h2>ワークスペースを並べ替え</h2><p>「{workspace.title}」の移動先を選んでください。</p>
    {items.filter(item => item.workspaceId !== workspace.workspaceId).map(item => <M3eButton key={item.workspaceId} disabled={busy}
      onClick={() => { void move(item.workspaceId) }}>「{item.title}」の前へ</M3eButton>)}
    <M3eButton disabled={busy} onClick={() => { void move() }}>最後へ</M3eButton>
  </div>
}

export function workspaceActions(dsh: DshServices, workspace: WorkspaceView, items: readonly WorkspaceView[]) {
  openSheet(close => <div className="home-actions"><h2>ワークスペースの操作</h2><p className="muted">{workspace.title}</p>
    <M3eButton onClick={() => { close(); renameWorkspace(dsh, workspace) }}><Icon name="edit" />名前を変える</M3eButton>
    <M3eButton onClick={() => { close(); openSheet(done => <WorkspaceOrder dsh={dsh} workspace={workspace} items={items} close={done} />, { label: 'ワークスペースを並べ替え' }) }}><Icon name="sort" />並べ替え</M3eButton>
    <M3eButton onClick={() => { close(); openDialog(done => <DeleteWorkspace dsh={dsh} workspace={workspace} close={done} />, { label: '登録の解除' }) }}><Icon name="folder_off" />登録を解除</M3eButton>
  </div>, { label: 'ワークスペースの操作' })
}
