import { useSyncExternalStore, type ReactNode } from 'react'
import { conversationSessionId } from '../conversation-route.ts'

export type CloseOverlay = () => void
export type OverlayRender = ReactNode | ((close: CloseOverlay) => ReactNode)
export type OverlayOwner = { kind: 'conversation'; sessionId: string } | { kind: 'route'; path: string }
export interface SheetOptions {
  dismissible?: boolean
  label?: string
  interactionKey?: string
  sessionId?: string
  /** Omitted ownership follows the route where the overlay was opened. */
  owner?: OverlayOwner
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
export const getOverlays = snapshot
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useOverlays() { return useSyncExternalStore(subscribe, snapshot, snapshot) }
export function hasOpenOverlay(): boolean { return entries.length > 0 }
export function isTopOverlay(id: number): boolean { return entries.at(-1)?.id === id }

function routePath(path: string): string {
  const raw = path.replace(/^#/, '') || '/'
  const separator = raw.indexOf('?')
  const pathname = (separator < 0 ? raw : raw.slice(0, separator)).replace(/\/$/, '') || '/'
  const query = new URLSearchParams(separator < 0 ? '' : raw.slice(separator + 1)).toString()
  return pathname + (query ? `?${query}` : '')
}
export function overlayOwnerForRoute(path: string): OverlayOwner {
  const normalized = routePath(path)
  const sessionId = conversationSessionId(normalized)
  if (sessionId !== undefined) return { kind: 'conversation', sessionId }
  return { kind: 'route', path: normalized }
}
export function closeOverlaysOutsideRoute(path: string): void {
  const owner = overlayOwnerForRoute(path)
  const remaining = entries.filter(entry => !entry.owner || (entry.owner.kind === 'conversation'
    ? owner.kind === 'conversation' && owner.sessionId === entry.owner.sessionId
    : routePath(entry.owner.path) === routePath(path)))
  if (remaining.length === entries.length) return
  entries = remaining
  emit()
}

function open(kind: OverlayEntry['kind'], render: OverlayRender, options: SheetOptions): CloseOverlay {
  const id = ++nextId
  const close = () => {
    if (!entries.some(entry => entry.id === id)) return
    entries = entries.filter(entry => entry.id !== id)
    emit()
  }
  const location = (globalThis as typeof globalThis & { window?: { location: { hash: string } } }).window?.location
  const owner = options.owner ?? overlayOwnerForRoute(location?.hash ?? '/')
  entries = [...entries, { ...options, owner, dismissible: options.dismissible ?? true, id, kind, render, close }]
  emit()
  return close
}
export function openSheet(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('sheet', render, options) }
export function openFullSheet(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('full', render, options) }
export function openDialog(render: OverlayRender, options: SheetOptions = {}): CloseOverlay { return open('dialog', render, options) }
