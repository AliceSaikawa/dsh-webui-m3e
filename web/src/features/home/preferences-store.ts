import type { ArchivedFilter } from './data.ts'

export interface HomePreferences {
  readonly workspaceId: string | null
  readonly showSubagents: boolean
  readonly archivedFilter: ArchivedFilter
}

export const homePreferencesStorageKey = 'dsh-m3e-home'
export const defaultHomePreferences: HomePreferences = { workspaceId: null, showSubagents: false, archivedFilter: 'default' }
export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function parseHomePreferences(value: string | null): HomePreferences {
  if (!value) return defaultHomePreferences
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultHomePreferences
    const { workspaceId, showSubagents, archivedFilter } = parsed as Record<string, unknown>
    return {
      workspaceId: typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null,
      showSubagents: showSubagents === true,
      archivedFilter: archivedFilter === 'show' || archivedFilter === 'only' ? archivedFilter : 'default',
    }
  } catch { return defaultHomePreferences }
}

/** The injected storage keeps failure behavior testable without a browser. */
export function createHomePreferencesStore(storage: () => PreferenceStorage | undefined) {
  let value: HomePreferences | undefined
  let memoryOnly = false
  const listeners = new Set<() => void>()

  function read(): HomePreferences {
    if (memoryOnly && value) return value
    try { return parseHomePreferences(storage()?.getItem(homePreferencesStorageKey) ?? null) }
    catch { return value ?? defaultHomePreferences }
  }
  function getSnapshot(): HomePreferences { return value ??= read() }
  function publish(next: HomePreferences) {
    const previous = getSnapshot()
    if (previous.workspaceId === next.workspaceId && previous.showSubagents === next.showSubagents && previous.archivedFilter === next.archivedFilter) return
    value = next
    for (const listener of [...listeners]) listener()
  }
  function update(next: HomePreferences) {
    publish(next)
    try {
      const target = storage()
      target?.setItem(homePreferencesStorageKey, JSON.stringify(next))
      memoryOnly = target === undefined
    } catch { memoryOnly = true }
  }
  return {
    getSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh() { publish(read()) },
    setCurrentWorkspace(workspaceId: string | null) { update({ ...getSnapshot(), workspaceId }) },
    setShowSubagents(showSubagents: boolean) { update({ ...getSnapshot(), showSubagents }) },
    setArchivedFilter(archivedFilter: ArchivedFilter) { update({ ...getSnapshot(), archivedFilter }) },
  }
}
