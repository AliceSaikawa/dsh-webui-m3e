import { useSyncExternalStore } from 'react'

// The appearance store runs in the browser and in tests compiled without the DOM
// lib (tsconfig.host.json), so declare the window shape it actually uses.
declare const window: {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  dispatchEvent(event: Event): void
}

export type Appearance = 'system' | 'light' | 'dark'
const storageKey = 'dsh-m3e-appearance'
const eventName = 'm3e:appearance'
let fallback: Appearance = 'system'
export function getAppearance(): Appearance {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch { return fallback }
}
export function setAppearance(value: Appearance): void {
  fallback = value
  try { localStorage.setItem(storageKey, value) } catch { /* Storage can be disabled. */ }
  window.dispatchEvent(new Event(eventName))
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener)
  window.addEventListener(eventName, listener)
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(eventName, listener) }
}
export function useAppearance(): Appearance { return useSyncExternalStore(subscribe, getAppearance, () => 'system') }

export const DEFAULT_THEME_COLOR = '#6750A4'
export const THEME_COLOR_PRESETS: readonly { color: string; label: string }[] = [
  { color: '#6750A4', label: '紫（既定）' },
  { color: '#0B57D0', label: '青' },
  { color: '#006A6A', label: '青緑' },
  { color: '#386A20', label: '緑' },
  { color: '#8C4A00', label: '橙' },
  { color: '#B3261E', label: '赤' },
]
const colorStorageKey = 'dsh-m3e-theme-color'
const defaultThemeColor = DEFAULT_THEME_COLOR.toLowerCase()
let colorFallback = defaultThemeColor
export function normalizeThemeColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : undefined
}
export function getThemeColor(): string {
  try {
    return normalizeThemeColor(localStorage.getItem(colorStorageKey)) ?? defaultThemeColor
  } catch { return colorFallback }
}
export function setThemeColor(color: string): void {
  const normalized = normalizeThemeColor(color)
  if (!normalized) return
  colorFallback = normalized
  try { localStorage.setItem(colorStorageKey, normalized) } catch { /* Storage can be disabled. */ }
  window.dispatchEvent(new Event(eventName))
}
export function useThemeColor(): string { return useSyncExternalStore(subscribe, getThemeColor, () => defaultThemeColor) }
