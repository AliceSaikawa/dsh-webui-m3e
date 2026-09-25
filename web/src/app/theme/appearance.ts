import { useSyncExternalStore } from 'react'

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
