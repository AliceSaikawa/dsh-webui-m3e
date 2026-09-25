import { useSyncExternalStore, type ReactNode } from 'react'

export type CloseOverlay = () => void
export type OverlayRender = ReactNode | ((close: CloseOverlay) => ReactNode)
export interface SheetOptions {
  dismissible?: boolean
  label?: string
  interactionKey?: string
  sessionId?: string
}
export interface OverlayEntry extends SheetOptions {
  id: number
  kind: 'sheet' | 'full' | 'dialog'
  render: OverlayRender
  close: CloseOverlay
}
let nextId = 0
let entries: readonly OverlayEntry[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
const snapshot = () => entries
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useOverlays() { return useSyncExternalStore(subscribe, snapshot, snapshot) }
export function hasOpenOverlay(): boolean { return entries.length > 0 }
export function isTopOverlay(id: number): boolean { return entries.at(-1)?.id === id }

function open(kind: OverlayEntry['kind'], render: OverlayRender, options: SheetOptions): CloseOverlay {
  const id = ++nextId
  const close = () => {
    if (!entries.some(entry => entry.id === id)) return
    entries = entries.filter(entry => entry.id !== id)
    emit()
  }
  entries = [...entries, { ...options, dismissible: options.dismissible ?? true, id, kind, render, close }]
  emit()
  return close
}
export function openSheet(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('sheet', render, options) }
export function openFullSheet(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('full', render, options) }
export function openDialog(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('dialog', render, options) }
