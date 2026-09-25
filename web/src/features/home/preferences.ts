import { useSyncExternalStore } from 'react'
import { createHomePreferencesStore, defaultHomePreferences, homePreferencesStorageKey, type HomePreferences, type PreferenceStorage } from './preferences-store.ts'
export type { HomePreferences } from './preferences-store.ts'

function browserStorage(): PreferenceStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

const preferences = createHomePreferencesStore(browserStorage)
let subscriptions = 0
function storageChanged(event: StorageEvent) {
  if (event.key === homePreferencesStorageKey || event.key === null) preferences.refresh()
}
function subscribe(listener: () => void) {
  const unsubscribe = preferences.subscribe(listener)
  if (typeof window !== 'undefined') {
    if (subscriptions++ === 0) window.addEventListener('storage', storageChanged)
    preferences.refresh()
  }
  return () => {
    unsubscribe()
    if (typeof window !== 'undefined' && --subscriptions === 0) window.removeEventListener('storage', storageChanged)
  }
}

export function useHomePreferences(): HomePreferences {
  return useSyncExternalStore(subscribe, preferences.getSnapshot, () => defaultHomePreferences)
}
export const setCurrentWorkspace = preferences.setCurrentWorkspace
export const setShowSubagents = preferences.setShowSubagents
