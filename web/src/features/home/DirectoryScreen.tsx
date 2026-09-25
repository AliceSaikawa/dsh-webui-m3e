import { useEffect, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eAssistChip, M3eChipSet } from '@m3e/react/chips'
import { Icon } from '../../app/icons/Icon.tsx'
import { back } from '../../app/router.ts'
import { ConnectionBanner } from '../../app/shell/ConnectionBanner.tsx'
import { useConnection } from '../../app/shell/index.ts'
import { openDialog, showSnackbar, TextPromptDialog } from '../../app/overlay/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { directoryPicker, isNativeUnavailable, nativeUnavailableMessage, type DirectoryListing } from './directory.ts'
import { setCurrentWorkspace } from './preferences.ts'
import { shortenHomePath } from './data.ts'
import './home.css'

export function DirectoryScreen() {
  const { remote, workspaces } = useDsh()
  const picker = directoryPicker(remote)
  const { connected } = useConnection()
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nativeOnly, setNativeOnly] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const currentPath = useRef<string | undefined>(undefined)
  const mounted = useRef(true)
  async function load(path?: string) {
    abort.current?.abort()
    const controller = new AbortController(); abort.current = controller
    setLoading(true); setError(''); setNativeOnly(false)
    if (!picker) { setError('フォルダの選択を利用できません。'); setLoading(false); return }
    try {
      const next = unwrapRemoteResult(await picker.list(path, controller.signal))
      if (controller.signal.aborted || !mounted.current) return
      currentPath.current = next.path; setListing(next)
    } catch (failure) {
      if (controller.signal.aborted || !mounted.current) return
      const native = isNativeUnavailable(failure)
      const message = native ? nativeUnavailableMessage : remoteErrorMessage(failure)
      setNativeOnly(native); setError(message); showSnackbar(message)
    } finally { if (!controller.signal.aborted && mounted.current) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true
    if (connected) void load(currentPath.current)
    else setLoading(false)
    return () => { mounted.current = false; abort.current?.abort() }
    // The RPC namespace identity is stable; reconnect reloads the same location.
  }, [remote, connected])
  function createFolder() {
    if (!listing || !picker || saving || loading || !connected) return
    const path = listing.path
    openDialog(close => <TextPromptDialog title="新しいフォルダ" label="フォルダ名" onCancel={close} onConfirm={async name => {
      try {
        unwrapRemoteResult(await picker.createDirectory(path, name))
        close(); showSnackbar('フォルダを作りました')
        if (mounted.current) await load(path)
      } catch (failure) { showSnackbar(remoteErrorMessage(failure)) }
    }} />, { label: '新しいフォルダ' })
  }
  async function addWorkspace() {
    if (!listing || saving || loading || !connected || error) return
    setSaving(true)
    try {
      const item = await workspaces.create({ path: listing.path })
      setCurrentWorkspace(item.workspaceId)
      if (mounted.current) { showSnackbar('ワークスペースを追加しました'); back() }
    } catch (failure) { if (mounted.current) showSnackbar(remoteErrorMessage(failure)) }
    finally { if (mounted.current) setSaving(false) }
  }
  return <section className="screen page-screen home-picker"><header className="top-bar">
    <M3eIconButton aria-label="フォルダの選択を閉じる" disabled={saving} onClick={back}><Icon name="close" /></M3eIconButton><h1>フォルダを選ぶ</h1>
  </header><ConnectionBanner /><main className="screen-content" data-scroll-area>
    <p className="home-picker-explanation">DSH が動いている機械のフォルダを選んでください。</p>
    {listing && <nav aria-label="フォルダの階層" className="home-crumbs"><M3eChipSet>
      {listing.crumbs.map(crumb => <M3eAssistChip key={crumb.path} disabled={loading || saving || !connected} aria-current={crumb.path === listing.path ? 'location' : undefined}
        onClick={() => { void load(crumb.path) }}>{crumb.path === listing.home ? '~' : crumb.name}</M3eAssistChip>)}
    </M3eChipSet></nav>}
    {listing && <p className="home-current-path">{shortenHomePath(listing.path, listing.home)}</p>}
    {error && <div className="home-picker-error" role="alert"><p>{error}</p>{!nativeOnly && <M3eButton disabled={!connected || loading} onClick={() => { void load(currentPath.current) }}>もう一度読み込む</M3eButton>}</div>}
    {loading ? <p className="home-picker-explanation" role="status">フォルダを読み込んでいます…</p> : listing && <>
      <ul className="home-folders">{listing.entries.filter(entry => !entry.hidden).map(entry => <li key={entry.path}>
        <button type="button" className="home-folder-row" disabled={saving || !connected} onClick={() => { void load(entry.path) }}>
          <Icon name="folder" /><span>{entry.name}</span><Icon name="chevron_right" /></button>
      </li>)}</ul>
      {!listing.entries.some(entry => !entry.hidden) && <p className="home-picker-explanation">この中に表示できるフォルダはありません。</p>}
      {listing.truncated && <p className="home-picker-explanation" role="status">1,000 件を超えるフォルダは一部だけ表示します</p>}
    </>}
  </main><footer className="page-footer home-picker-footer">
    <M3eButton variant="outlined" disabled={!listing || loading || saving || !connected || !!error} onClick={createFolder}><Icon name="create_new_folder" />新しいフォルダ</M3eButton>
    <M3eButton variant="filled" disabled={!listing || loading || saving || !connected || !!error} onClick={() => { void addWorkspace() }}>{saving ? '追加しています…' : 'ここを追加'}</M3eButton>
  </footer></section>
}
