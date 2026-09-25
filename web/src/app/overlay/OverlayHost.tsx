import { useEffect } from 'react'
import { M3eBottomSheet } from '@m3e/react/bottom-sheet'
import { M3eDialog } from '@m3e/react/dialog'
import { useOverlays, isTopOverlay } from './store.ts'

export function OverlayHost() {
  const entries = useOverlays()
  const active = entries.at(-1)
  const locked = entries.length > 0
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement
    return () => { queueMicrotask(() => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }) }
  }, [active?.id])
  useEffect(() => {
    if (!locked) return
    const nodes = [document.body, ...document.querySelectorAll<HTMLElement>('[data-scroll-area]')]
    const original = nodes.map(node => node.style.overflow)
    nodes.forEach(node => { node.style.overflow = 'hidden' })
    return () => nodes.forEach((node, index) => { node.style.overflow = original[index] ?? '' })
  }, [locked])
  if (!active) return null
  const content = typeof active.render === 'function' ? active.render(active.close) : active.render
  const closed = () => { if (isTopOverlay(active.id)) active.close() }
  const cancel = (event: Event) => {
    if (!active.dismissible) event.preventDefault()
  }
  if (active.kind === 'dialog') return <M3eDialog key={active.id} open closeLabel="閉じる"
    aria-label={active.label ?? '確認'} disableClose={!active.dismissible} onClosed={closed} onCancel={cancel}>
    <div className="dialog-content">{content}</div>
  </M3eDialog>
  return <M3eBottomSheet key={active.id} open modal handle={active.kind === 'sheet'} hideable={active.dismissible}
    handleLabel="シートの高さを変更" detents={active.kind === 'full' ? ['full'] : ['fit', 'full']}
    className={active.kind === 'full' ? 'full-sheet' : 'bottom-sheet'} aria-label={active.label ?? '操作'}
    onCancel={cancel} onClosed={closed}>
    <div className="sheet-content">{content}</div>
  </M3eBottomSheet>
}
