import { useRef } from 'react'
import { M3eNavMenu, M3eNavMenuItem } from '@m3e/react/nav-menu'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate } from '../../app/router.ts'
import type { WorkspaceView } from '../../dsh/services.ts'
import { shortenHomePath } from './data.ts'
import { useRowGesture } from './gestures.ts'

function WorkspaceItem({ item, homePath, selected, onSelect, onActions, connected }: {
  item: WorkspaceView; homePath?: string; selected: boolean; onSelect(): void; onActions(): void; connected: boolean
}) {
  const gesture = useRowGesture({ onClick: onSelect, onLongPress: connected ? onActions : undefined })
  return <div className="home-workspace-entry" {...gesture.handlers}>
    <M3eNavMenuItem data-workspace-id={item.workspaceId} selected={selected} aria-current={selected ? 'true' : undefined} aria-label={`${item.title}、${shortenHomePath(item.path, homePath)}`}>
      <Icon slot="icon" name="folder" />
      <span slot="label" className="home-workspace-label"><strong>{item.title}</strong><small>{shortenHomePath(item.path, homePath)}</small></span>
    </M3eNavMenuItem>
  </div>
}

export function WorkspaceDrawer({ items, currentId, homePath, open, canAdd, connected, onClose, onSelect, onActions }: {
  items: readonly WorkspaceView[]; currentId?: string; homePath?: string; open: boolean; canAdd: boolean; connected: boolean
  onClose(): void; onSelect(id: string): void; onActions(item: WorkspaceView): void
}) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return <div slot="start" className="home-drawer" role="dialog" aria-modal={open ? true : undefined} aria-label="ワークスペースを切り替え"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}
    onPointerDown={event => { if (event.isPrimary) start.current = { x: event.clientX, y: event.clientY } }}
    onPointerCancel={() => { start.current = null }}
    onPointerUp={event => {
      const point = start.current; start.current = null
      if (point && point.x - event.clientX > 72 && point.x - event.clientX > Math.abs(point.y - event.clientY) * 2) onClose()
    }}>
    <header className="home-drawer-heading"><h2>ワークスペース</h2><M3eIconButton aria-label="閉じる" onClick={onClose}><Icon name="close" /></M3eIconButton></header>
    <nav aria-label="ワークスペース"><M3eNavMenu onKeyDownCapture={event => {
      if (!['Enter', ' ', 'F10'].includes(event.key)) return
      const activeId = event.currentTarget.getAttribute('aria-activedescendant')
      const active = event.currentTarget.items.find(item => item.id === activeId)
      if (!active || active.disabled) return
      const item = items.find(value => value.workspaceId === active.dataset.workspaceId)
      if (event.shiftKey && event.key === 'F10') {
        if (item && connected) { event.preventDefault(); onActions(item) }
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (item) onSelect(item.workspaceId)
        else if (active.dataset.addWorkspace && connected) { onClose(); navigate('/workspaces/add') }
      }
    }}>
      {items.map(item => <WorkspaceItem key={item.workspaceId} item={item} homePath={homePath} connected={connected}
        selected={item.workspaceId === currentId} onSelect={() => onSelect(item.workspaceId)} onActions={() => onActions(item)} />)}
      {canAdd && <M3eNavMenuItem data-add-workspace="true" disabled={!connected} onClick={() => { onClose(); navigate('/workspaces/add') }}>
        <Icon slot="icon" name="add" /><span slot="label">ワークスペースを追加</span>
      </M3eNavMenuItem>}
    </M3eNavMenu></nav>
    <p className="home-drawer-hint">長押しで名前の変更・並べ替え・登録の解除</p>
  </div>
}
