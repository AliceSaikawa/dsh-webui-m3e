import { useEffect, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eFab } from '@m3e/react/fab'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eDrawerContainer, type M3eDrawerContainerElement } from '@m3e/react/drawer-container'
import { M3eMenu, M3eMenuItem, type M3eMenuElement } from '@m3e/react/menu'
import { M3eSwitch } from '@m3e/react/switch'
import { TabScaffold, useConnection } from '../../app/shell/index.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { getOverlays } from '../../app/overlay/store.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { selectWorkspace, orderSessions, pinnedFirst, pinnedFirstInOrder, visibleSessions, type ArchivedFilter, type OrderBy } from './data.ts'
import { useHomePreferences, setCurrentWorkspace, setShowSubagents, setArchivedFilter, setOrderBy } from './preferences.ts'
import { attempt, renameWorkspace, sessionActions, workspaceActions } from './actions.tsx'
import { WorkspaceDrawer } from './WorkspaceDrawer.tsx'
import { SessionRow } from './SessionRow.tsx'
import { useDirectoryAvailability } from './directory.ts'
import { normalizeWorkspaceError } from './workspace-errors.ts'
import { canEditHomeSession } from './session-navigation.ts'
import { scheduleLoadingRecovery } from './loading-recovery.ts'
import './home.css'

type Mode = 'normal' | 'sort' | 'select'

const ARCHIVED_FILTER_ITEMS: readonly { value: ArchivedFilter; label: string; icon: string }[] = [
  { value: 'default', label: 'アーカイブ済みを隠す', icon: 'visibility_off' },
  { value: 'show', label: 'アーカイブ済みも表示', icon: 'visibility' },
  { value: 'only', label: 'アーカイブ済みだけ表示', icon: 'inventory_2' },
]

const ORDER_ITEMS: readonly { value: OrderBy; label: string; icon: string }[] = [
  { value: 'updated', label: '最近の更新順', icon: 'schedule' },
  { value: 'manual', label: '手動の順', icon: 'format_list_numbered' },
]

export function HomeScreen() {
  const dsh = useDsh()
  const list = useSnapshot(dsh.sessions.list)
  const snapshot = useSnapshot(dsh.workspaces.list)
  const preferences = useHomePreferences()
  const workspace = selectWorkspace(snapshot.items, preferences.workspaceId)
  const archivedIds = new Set(snapshot.archivedSessionIds)
  const visible = visibleSessions(workspace, list.byId, snapshot.archivedSessionIds, preferences.showSubagents, preferences.archivedFilter)
  const { rows, pinned } = preferences.orderBy === 'updated'
    ? pinnedFirstInOrder(orderSessions(visible, 'updated'), snapshot.pinnedSessionIds.filter(id => !archivedIds.has(id)))
    : pinnedFirst(orderSessions(visible, 'manual'), snapshot.pinnedSessionIds.filter(id => !archivedIds.has(id)))
  const unpinned = rows.filter(row => !pinned.has(row.id) && !archivedIds.has(row.id))
  const operable = rows.some(row => canEditHomeSession(row) && !archivedIds.has(row.id))
  const unpinnedIndex = new Map(unpinned.map((row, index) => [row.id, index]))
  const sortCaption = pinned.size ? 'つまみをドラッグして順番を変更（ピン留めした行は固定した順に並びます）' : 'つまみをドラッグして順番を変更'
  const orderSuffix = preferences.orderBy === 'updated' ? '・最近の更新順' : ''
  const listCaption = (preferences.archivedFilter === 'only' ? `${rows.length} 件のアーカイブ済みセッション`
    : preferences.archivedFilter === 'show' ? `${rows.length} 件のセッション（アーカイブ済みを含む）` : `${rows.length} 件のセッション`) + orderSuffix
  const { connected } = useConnection()
  const directory = useDirectoryAvailability(dsh.remote, connected)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('normal')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const refreshPending = useRef(false)
  const [pull, setPull] = useState(0)
  const pullStart = useRef<{ x: number; y: number } | null>(null)
  const pullDistance = useRef(0)
  const drawer = useRef<M3eDrawerContainerElement | null>(null)
  const drawerTrigger = useRef<HTMLElement | null>(null)
  const menu = useRef<M3eMenuElement | null>(null)
  const loading = snapshot.phase === 'pending' || list.phase === 'pending'
  const [slowLoading, setSlowLoading] = useState(false)

  useEffect(() => scheduleLoadingRecovery(loading, setSlowLoading), [loading])

  useEffect(() => {
    const element = drawer.current
    if (!element) return
    let cancelled = false
    // The native drawer owns the focus trap and background inert state. Wait
    // for its update before moving into it or back to the now-interactive entry.
    void element.updateComplete.then(() => {
      if (cancelled) return
      if (drawerOpen) element.querySelector<HTMLElement>('.home-drawer m3e-icon-button')?.focus({ preventScroll: true })
      else if (!getOverlays().length && drawerTrigger.current?.isConnected) drawerTrigger.current.focus({ preventScroll: true })
    })
    return () => { cancelled = true }
  }, [drawerOpen])

  useEffect(() => {
    if (snapshot.phase === 'ready' && preferences.workspaceId !== (workspace?.workspaceId ?? null)) setCurrentWorkspace(workspace?.workspaceId ?? null)
  }, [snapshot.phase, workspace?.workspaceId, preferences.workspaceId])
  useEffect(() => { setMode('normal'); setSelected(new Set()) }, [workspace?.workspaceId])
  useEffect(() => { if (preferences.orderBy !== 'manual') setMode(mode => mode === 'sort' ? 'normal' : mode) }, [preferences.orderBy])
  const selectedIds = rows.filter(row => selected.has(row.id) && canEditHomeSession(row)).map(row => row.id)
  async function archive(ids: readonly string[]) {
    ids = ids.filter(id => canEditHomeSession(dsh.sessions.list.getSnapshot().byId[id]))
    if (busyRef.current || !connected || !ids.length) return
    busyRef.current = true; setBusy(true)
    const completed: string[] = []
    try {
      for (const id of ids) { await dsh.workspaces.archiveSession(id); completed.push(id) }
      showSnackbar(ids.length === 1 ? 'アーカイブしました' : `${completed.length} 件をアーカイブしました`)
      setMode('normal')
    } catch (error) {
      showSnackbar(`${completed.length ? `${completed.length} 件をアーカイブしました。` : ''}${remoteErrorMessage(normalizeWorkspaceError(error))}`)
    } finally {
      setSelected(value => new Set([...value].filter(id => !completed.includes(id))))
      busyRef.current = false; setBusy(false)
    }
  }
  async function move(id: string, before?: string) {
    if (!workspace || busyRef.current || !connected || id === before || !canEditHomeSession(dsh.sessions.list.getSnapshot().byId[id])) return
    busyRef.current = true; setBusy(true)
    await attempt(() => dsh.workspaces.insertSessionBefore(workspace.workspaceId, id, before))
    busyRef.current = false; setBusy(false)
  }
  async function refresh() {
    if (refreshPending.current || !connected) return
    refreshPending.current = true; setRefreshing(true); setRefreshError('')
    try { await dsh.sessions.refresh() }
    catch (error) { setRefreshError(remoteErrorMessage(error, 'セッション一覧を読み込めませんでした。もう一度お試しください。')) }
    finally { refreshPending.current = false; setRefreshing(false) }
  }
  const changeMode = (value: Mode) => { menu.current?.hide(); setMode(value); setSelected(new Set()) }
  const toolbar = <>
    {mode === 'normal' ? <M3eIconButton aria-label="ワークスペースを切り替え" onClick={event => { if (event.currentTarget instanceof HTMLElement) drawerTrigger.current = event.currentTarget; setDrawerOpen(true) }}><Icon name="menu" /></M3eIconButton>
      : <M3eIconButton aria-label="操作を終了" disabled={busy} onClick={() => changeMode('normal')}><Icon name="close" /></M3eIconButton>}
    <h1 className="home-title">{mode === 'sort' ? '並べ替え' : mode === 'select' ? `${selectedIds.length} 件選択中` : workspace?.title ?? '一覧'}</h1>
    {mode === 'normal' && <M3eIconButton aria-label="一覧のメニュー" onClick={event => { if (event.currentTarget instanceof HTMLElement) void menu.current?.toggle(event.currentTarget) }}><Icon name="more_vert" /></M3eIconButton>}
    {mode === 'sort' && <M3eButton disabled={busy} onClick={() => changeMode('normal')}>完了</M3eButton>}
    {mode === 'select' && <M3eButton disabled={busy || !connected || !selectedIds.length} onClick={() => { void archive(selectedIds) }}>{selectedIds.length} 件をアーカイブ</M3eButton>}
  </>
  return <M3eDrawerContainer ref={drawer} start={drawerOpen} startMode="over" className="home-drawer-container"
    onChange={event => { if (event.target === drawer.current) setDrawerOpen(drawer.current?.start ?? false) }}>
    <WorkspaceDrawer items={snapshot.items} currentId={workspace?.workspaceId} homePath={directory.homePath} open={drawerOpen}
      canAdd={directory.canAdd} connected={connected} onClose={() => setDrawerOpen(false)}
      onSelect={id => { setCurrentWorkspace(id); setDrawerOpen(false) }}
      onActions={item => { setDrawerOpen(false); workspaceActions(dsh, item, snapshot.items) }} />
    <TabScaffold topBar={toolbar} fab={mode === 'normal' && <M3eFab aria-label="新しいセッション" disabled={!connected || !workspace || loading}
      onClick={() => { if (workspace) navigate(`/new?ws=${encodeURIComponent(workspace.workspaceId)}`) }}><Icon name="add" /></M3eFab>}>
      <div className="home-list" onTouchStart={event => {
        const touch = event.touches[0], scroll = event.currentTarget.closest('[data-scroll-area]')
        if (mode !== 'normal' || !connected || refreshing || event.touches.length !== 1 || !touch || (scroll?.scrollTop ?? 0) > 0) return
        pullStart.current = { x: touch.clientX, y: touch.clientY }
      }} onTouchMove={event => {
        const start = pullStart.current, touch = event.touches[0]
        if (!start || !touch) return
        const dy = touch.clientY - start.y
        if (dy < 0 || Math.abs(touch.clientX - start.x) > 30) { pullStart.current = null; pullDistance.current = 0; setPull(0); return }
        pullDistance.current = Math.min(100, dy); setPull(pullDistance.current)
      }} onTouchEnd={() => {
        const distance = pullDistance.current
        pullStart.current = null; pullDistance.current = 0; setPull(0)
        if (distance >= 72) void refresh()
      }} onTouchCancel={() => { pullStart.current = null; pullDistance.current = 0; setPull(0) }}>
        {(pull > 20 || refreshing) && <p className="home-refresh" role="status">{refreshing ? '読み直しています…' : pull >= 72 ? '離して読み直す' : '下に引っぱって読み直す'}</p>}
        {snapshot.error && <p className="home-error" role="alert">{remoteErrorMessage(snapshot.error)}</p>}
        {refreshError && <p className="home-error" role="alert">{refreshError}</p>}
        {((loading && slowLoading) || snapshot.error || refreshError) && <div className="home-list-recovery">
          {loading && !refreshError && !snapshot.error && <p role="status">一覧の読み込みが完了していません。</p>}
          {list.phase === 'pending' || refreshError ? <M3eButton disabled={!connected || refreshing} onClick={() => { void refresh() }}>セッション一覧を読み直す</M3eButton> : null}
          <M3eButton onClick={() => window.location.reload()}>画面を再読み込み</M3eButton>
        </div>}
        {loading ? <div aria-label="セッションを読み込み中" role="status" className="home-skeletons">{[1, 2, 3, 4].map(id => <div className="home-skeleton" key={id}><span /><div><i /><i /></div></div>)}</div>
          : !workspace ? <div className="home-empty"><Icon name="create_new_folder" /><h2>ワークスペースがありません</h2><p>作業するフォルダを追加してください。</p>
            {directory.canAdd && <M3eButton variant="filled" disabled={!connected} onClick={() => navigate('/workspaces/add')}>ワークスペースを追加</M3eButton>}
            {!directory.canAdd && directory.ready && <p className="muted">フォルダの選択を利用できません。</p>}</div>
          : rows.length === 0 ? (preferences.archivedFilter === 'only'
            ? <div className="home-empty"><Icon name="inventory_2" /><h2>アーカイブ済みのセッションはありません</h2></div>
            : <div className="home-empty"><Icon name="chat_bubble" /><h2>まだセッションがありません</h2><p>右下の ＋ から始められます</p></div>)
          : <><p className="home-list-caption">{mode === 'sort' ? sortCaption : mode === 'select' ? 'アーカイブするセッションを選択' : listCaption}</p>
            <ul className="home-sessions" aria-label="セッション一覧">{rows.map(row => {
              const position = unpinnedIndex.get(row.id) ?? -1
              const archived = archivedIds.has(row.id)
              return <SessionRow key={row.id} row={row} mode={mode} pinned={pinned.has(row.id)} archived={archived}
                selected={selected.has(row.id)} disabled={busy} canMutate={connected} first={position === 0} last={position === unpinned.length - 1}
                onToggle={() => { if (canEditHomeSession(row)) setSelected(value => { const next = new Set(value); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next }) }}
                onActions={() => sessionActions(dsh, row, () => { void archive([row.id]) }, pinned.has(row.id), archived)} onArchive={() => { void archive([row.id]) }}
                onMove={before => { void move(row.id, before) }} onMoveUp={() => { void move(row.id, unpinned[position - 1]?.id) }}
                onMoveDown={() => { void move(row.id, unpinned[position + 2]?.id) }} />
            })}</ul></>}
      </div>
    </TabScaffold>
    <M3eMenu ref={menu} aria-label="一覧のメニュー" className="home-menu" positionX="before">
      {ORDER_ITEMS.map(item => <M3eMenuItem key={item.value} role="menuitemradio" aria-checked={preferences.orderBy === item.value ? 'true' : 'false'}
        onClick={() => { menu.current?.hide(); setOrderBy(item.value) }}>
        <Icon slot="icon" name={item.icon} />{item.label}
        {preferences.orderBy === item.value && <Icon slot="trailing-icon" name="check" />}
      </M3eMenuItem>)}
      {preferences.orderBy === 'manual' && <M3eMenuItem disabled={!workspace || !operable || !connected || loading} onClick={() => changeMode('sort')}><Icon slot="icon" name="swap_vert" />並べ替え</M3eMenuItem>}
      <M3eMenuItem disabled={!workspace || !operable || !connected || loading} onClick={() => changeMode('select')}><Icon slot="icon" name="checklist" />選んでアーカイブ</M3eMenuItem>
      <M3eMenuItem disabled={!workspace || !connected || loading} onClick={() => { menu.current?.hide(); if (workspace) renameWorkspace(dsh, workspace) }}><Icon slot="icon" name="edit" />名前を変える</M3eMenuItem>
      <M3eMenuItem role="menuitemcheckbox" aria-checked={preferences.showSubagents} onClick={() => { menu.current?.hide(); setShowSubagents(!preferences.showSubagents) }}>
        <Icon slot="icon" name="account_tree" />サブエージェントも表示<span slot="trailing-icon" inert><M3eSwitch checked={preferences.showSubagents} tabIndex={-1} aria-hidden="true" /></span>
      </M3eMenuItem>
      {ARCHIVED_FILTER_ITEMS.map(item => <M3eMenuItem key={item.value} role="menuitemradio" aria-checked={preferences.archivedFilter === item.value ? 'true' : 'false'}
        onClick={() => { menu.current?.hide(); setArchivedFilter(item.value) }}>
        <Icon slot="icon" name={item.icon} />{item.label}
        {preferences.archivedFilter === item.value && <Icon slot="trailing-icon" name="check" />}
      </M3eMenuItem>)}
    </M3eMenu>
  </M3eDrawerContainer>
}
