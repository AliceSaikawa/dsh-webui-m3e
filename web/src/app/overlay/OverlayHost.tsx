import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { M3eBottomSheet } from '@m3e/react/bottom-sheet'
import { M3eDialog } from '@m3e/react/dialog'
import type { M3eBottomSheetElement } from '@m3e/web/bottom-sheet'
import type { M3eDialogElement } from '@m3e/web/dialog'
import { getOverlays, useOverlays, isTopOverlay, type OverlayEntry } from './store.ts'
import { hideSheet, keepTopInteractive, OverlayPresentation, setSheetHandle } from './presentation.ts'

function observeInert(element: HTMLElement, notify: () => void): () => void {
  const observer = new MutationObserver(notify)
  observer.observe(element, { attributes: true, attributeFilter: ['inert'] })
  return () => observer.disconnect()
}

function OverlayLayer({ entry, presentation }: { entry: OverlayEntry; presentation: OverlayPresentation }) {
  const sheet = useRef<M3eBottomSheetElement>(null)
  const dialog = useRef<M3eDialogElement>(null)
  const content = typeof entry.render === 'function' ? entry.render(entry.close) : entry.render
  useLayoutEffect(() => {
    const element = sheet.current ?? dialog.current
    if (!element) return
    if (presentation.activeId !== entry.id) {
      element.hidden = true
      element.inert = true
    }
    if (sheet.current) setSheetHandle(sheet.current, entry.kind === 'sheet')
    const keepInteractive = () => keepTopInteractive(element, notify => observeInert(element, notify))
    let stopInteractive: (() => void) | undefined = presentation.isUserClose(entry.id)
      ? keepInteractive() : undefined
    const unregister = presentation.register(entry.id, {
      async show() {
        element.hidden = false
        stopInteractive?.()
        stopInteractive = keepInteractive()
        if (sheet.current) { sheet.current.open = true; await sheet.current.updateComplete }
        else if (dialog.current) { dialog.current.open = true; await dialog.current.show() }
      },
      async hide() {
        stopInteractive?.()
        stopInteractive = undefined
        if (sheet.current) await hideSheet(sheet.current)
        else if (dialog.current) await dialog.current.hide()
        element.hidden = true
        element.inert = true
      },
    })
    return () => { stopInteractive?.(); unregister() }
  }, [entry.id, entry.kind, presentation])
  const closed = () => {
    if (presentation.isUserClose(entry.id) && isTopOverlay(entry.id)) entry.close()
  }
  const cancel = (event: Event) => { if (!entry.dismissible) event.preventDefault() }
  if (entry.kind === 'dialog') return <M3eDialog ref={dialog} closeLabel="閉じる"
    aria-label={entry.label ?? '確認'} disableClose={!entry.dismissible} onClosed={closed} onCancel={cancel}>
    <div className="dialog-content">{content}</div>
  </M3eDialog>
  return <M3eBottomSheet ref={sheet} modal handle={entry.kind === 'sheet'} hideable={entry.dismissible}
    handleLabel="シートの高さを変更" detents={entry.kind === 'full' ? ['full'] : ['fit', 'full']}
    className={entry.kind === 'full' ? 'full-sheet' : 'bottom-sheet'} aria-label={entry.label ?? '操作'}
    onCancel={cancel} onClosed={closed}>
    <div className="sheet-content">{content}</div>
  </M3eBottomSheet>
}

export function OverlayHost() {
  const entries = useOverlays()
  const [retained, setRetained] = useState(entries)
  const [previous, setPrevious] = useState(entries)
  const presentation = useMemo(() => new OverlayPresentation(id => {
    if (!getOverlays().some(entry => entry.id === id)) setRetained(current => current.filter(entry => entry.id !== id))
  }), [])
  if (previous !== entries) {
    setPrevious(entries)
    // A removed modal stays mounted until its native close animation and locks finish.
    const closing = retained.find(entry => entry.id === presentation.activeId && !entries.includes(entry))
    setRetained(closing ? [...entries, closing] : entries)
  }
  useLayoutEffect(() => { presentation.select(entries.at(-1)?.id) }, [entries, presentation])
  const locked = retained.length > 0
  useLayoutEffect(() => {
    if (!locked) return
    // M3E owns the document lock; retain the app's inner scroll positions across the entire stack.
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-scroll-area]')]
    const original = nodes.map(node => node.style.overflow)
    nodes.forEach(node => { node.style.overflow = 'hidden' })
    return () => nodes.forEach((node, index) => { node.style.overflow = original[index] ?? '' })
  }, [locked])
  // Stable keys retain form input, busy state and in-flight request results beneath an interruption.
  return retained.map(entry => <OverlayLayer key={entry.id} entry={entry} presentation={presentation} />)
}
