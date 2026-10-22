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
import { useMessages } from '../../i18n/index.ts'
import { selectWorkspace, orderSessions, pinnedFirst, pinnedFirstInOrder, visibleSessions, type ArchivedFilter, type OrderBy } from './data.ts'
import { homeMessages } from './messages.ts'
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

const ARCHIVED_FILTER_ITEMS: readonly { value: ArchivedFilter; labelKey: 'archivedHide' | 'archivedShow' | 'archivedOnly'; icon: string }[] = [
  { value: 'default', labelKey: 'archivedHide', icon: 'visibility_off' },
  { value: 'show', labelKey: 'archivedShow', icon: 'visibility' },
  { value: 'only', labelKey: 'archivedOnly', icon: 'inventory_2' },
]

const ORDER_ITEMS: readonly { value: OrderBy; labelKey: 'orderUpdated' | 'orderManual'; icon: string }[] = [
  { value: 'updated', labelKey: 'orderUpdated', icon: 'schedule' },
  { value: 'manual', labelKey: 'orderManual', icon: 'format_list_numbered' },
]

export function HomeScreen() {
  const dsh = useDsh()
  const text = useMessages(homeMessages)
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
  const sortCaption = pinned.size ? text.sortCaptionPinned : text.sortCaption
  const updatedOrder = preferences.orderBy === 'updated'
  const listCaption = preferences.archivedFilter === 'only' ? text.listCaptionArchived(rows.length, updatedOrder)
    : preferences.archivedFilter === 'show' ? text.listCaptionWithArchived(rows.length, updatedOrder)
      : text.listCaption(rows.length, updatedOrder)
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
      showSnackbar(ids.length === 1 ? text.archiveDoneOne : text.archiveDone(completed.length))
      setMode('normal')
    } catch (error) {
      showSnackbar(text.archiveFailed(completed.length, remoteErrorMessage(normalizeWorkspaceError(error))))
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
    catch (error) { setRefreshError(remoteErrorMessage(error, text.refreshFailed)) }
    finally { refreshPending.current = false; setRefreshing(false) }
  }
  const changeMode = (value: Mode) => { menu.current?.hide(); setMode(value); setSelected(new Set()) }
  const toolbar = <>
    {mode === 'normal' ? <M3eIconButton aria-label={text.workspaceSwitcher} onClick={event => { if (event.currentTarget instanceof HTMLElement) drawerTrigger.current = event.currentTarget; setDrawerOpen(true) }}><Icon name="menu" /></M3eIconButton>
      : <M3eIconButton aria-label={text.exitActions} disabled={busy} onClick={() => changeMode('normal')}><Icon name="close" /></M3eIconButton>}
    <h1 className="home-title">{mode === 'sort' ? text.sortModeTitle : mode === 'select' ? text.selectedCount(selectedIds.length) : workspace?.title ?? text.listFallbackTitle}</h1>
    {mode === 'normal' && <M3eIconButton aria-label={text.listMenu} onClick={event => { if (event.currentTarget instanceof HTMLElement) void menu.current?.toggle(event.currentTarget) }}><Icon name="more_vert" /></M3eIconButton>}
    {mode === 'sort' && <M3eButton disabled={busy} onClick={() => changeMode('normal')}>{text.done}</M3eButton>}
    {mode === 'select' && <M3eButton disabled={busy || !connected || !selectedIds.length} onClick={() => { void archive(selectedIds) }}>{text.archiveSelected(selectedIds.length)}</M3eButton>}
  </>
  return <M3eDrawerContainer ref={drawer} start={drawerOpen} startMode="over" className="home-drawer-container"
    onChange={event => { if (event.target === drawer.current) setDrawerOpen(drawer.current?.start ?? false) }}>
    <WorkspaceDrawer items={snapshot.items} currentId={workspace?.workspaceId} homePath={directory.homePath} open={drawerOpen}
      canAdd={directory.canAdd} connected={connected} onClose={() => setDrawerOpen(false)}
      onSelect={id => { setCurrentWorkspace(id); setDrawerOpen(false) }}
      onActions={item => { setDrawerOpen(false); workspaceActions(dsh, item, snapshot.items, text) }} />
    <TabScaffold topBar={toolbar} fab={mode === 'normal' && <M3eFab aria-label={text.newSession} disabled={!connected || !workspace || loading}
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
        {(pull > 20 || refreshing) && <p className="home-refresh" role="status">{refreshing ? text.refreshing : pull >= 72 ? text.releaseToRefresh : text.pullToRefresh}</p>}
        {snapshot.error && <p className="home-error" role="alert">{remoteErrorMessage(snapshot.error)}</p>}
        {refreshError && <p className="home-error" role="alert">{refreshError}</p>}
        {((loading && slowLoading) || snapshot.error || refreshError) && <div className="home-list-recovery">
          {loading && !refreshError && !snapshot.error && <p role="status">{text.loadingIncomplete}</p>}
          {list.phase === 'pending' || refreshError ? <M3eButton disabled={!connected || refreshing} onClick={() => { void refresh() }}>{text.reloadSessions}</M3eButton> : null}
          <M3eButton onClick={() => window.location.reload()}>{text.reloadPage}</M3eButton>
        </div>}
        {loading ? <div aria-label={text.loadingSessions} role="status" className="home-skeletons">{[1, 2, 3, 4].map(id => <div className="home-skeleton" key={id}><span /><div><i /><i /></div></div>)}</div>
          : !workspace ? <div className="home-empty"><Icon name="create_new_folder" /><h2>{text.noWorkspace}</h2><p>{text.noWorkspaceHint}</p>
            {directory.canAdd && <M3eButton variant="filled" disabled={!connected} onClick={() => navigate('/workspaces/add')}>{text.addWorkspace}</M3eButton>}
            {!directory.canAdd && directory.ready && <p className="muted">{text.pickerUnavailable}</p>}</div>
          : rows.length === 0 ? (preferences.archivedFilter === 'only'
            ? <div className="home-empty"><Icon name="inventory_2" /><h2>{text.noArchivedSessions}</h2></div>
            : <div className="home-empty"><Icon name="chat_bubble" /><h2>{text.noSessions}</h2><p>{text.noSessionsHint}</p></div>)
          : <><p className="home-list-caption">{mode === 'sort' ? sortCaption : mode === 'select' ? text.selectCaption : listCaption}</p>
            <ul className="home-sessions" aria-label={text.sessionsLabel}>{rows.map(row => {
              const position = unpinnedIndex.get(row.id) ?? -1
              const archived = archivedIds.has(row.id)
              return <SessionRow key={row.id} row={row} mode={mode} pinned={pinned.has(row.id)} archived={archived}
                selected={selected.has(row.id)} disabled={busy} canMutate={connected} first={position === 0} last={position === unpinned.length - 1}
                onToggle={() => { if (canEditHomeSession(row)) setSelected(value => { const next = new Set(value); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next }) }}
                onActions={() => sessionActions(dsh, row, () => { void archive([row.id]) }, pinned.has(row.id), archived, text)} onArchive={() => { void archive([row.id]) }}
                onMove={before => { void move(row.id, before) }} onMoveUp={() => { void move(row.id, unpinned[position - 1]?.id) }}
                onMoveDown={() => { void move(row.id, unpinned[position + 2]?.id) }} />
            })}</ul></>}
      </div>
    </TabScaffold>
    <M3eMenu ref={menu} aria-label={text.listMenu} className="home-menu" positionX="before">
      {ORDER_ITEMS.map(item => <M3eMenuItem key={item.value} role="menuitemradio" aria-checked={preferences.orderBy === item.value ? 'true' : 'false'}
        onClick={() => { menu.current?.hide(); setOrderBy(item.value) }}>
        <Icon slot="icon" name={item.icon} />{text[item.labelKey]}
        {preferences.orderBy === item.value && <Icon slot="trailing-icon" name="check" />}
      </M3eMenuItem>)}
      {preferences.orderBy === 'manual' && <M3eMenuItem disabled={!workspace || !operable || !connected || loading} onClick={() => changeMode('sort')}><Icon slot="icon" name="swap_vert" />{text.sortAction}</M3eMenuItem>}
      <M3eMenuItem disabled={!workspace || !operable || !connected || loading} onClick={() => changeMode('select')}><Icon slot="icon" name="checklist" />{text.selectAndArchive}</M3eMenuItem>
      <M3eMenuItem disabled={!workspace || !connected || loading} onClick={() => { menu.current?.hide(); if (workspace) renameWorkspace(dsh, workspace, text) }}><Icon slot="icon" name="edit" />{text.renameAction}</M3eMenuItem>
      <M3eMenuItem role="menuitemcheckbox" aria-checked={preferences.showSubagents} onClick={() => { menu.current?.hide(); setShowSubagents(!preferences.showSubagents) }}>
        <Icon slot="icon" name="account_tree" />{text.showSubagents}<span slot="trailing-icon" inert><M3eSwitch checked={preferences.showSubagents} tabIndex={-1} aria-hidden="true" /></span>
      </M3eMenuItem>
      {ARCHIVED_FILTER_ITEMS.map(item => <M3eMenuItem key={item.value} role="menuitemradio" aria-checked={preferences.archivedFilter === item.value ? 'true' : 'false'}
        onClick={() => { menu.current?.hide(); setArchivedFilter(item.value) }}>
        <Icon slot="icon" name={item.icon} />{text[item.labelKey]}
        {preferences.archivedFilter === item.value && <Icon slot="trailing-icon" name="check" />}
      </M3eMenuItem>)}
    </M3eMenu>
  </M3eDrawerContainer>
}
