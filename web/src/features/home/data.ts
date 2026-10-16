import type { SessionSummary, WorkspaceView } from '../../dsh/services.ts'

export function selectWorkspace(items: readonly WorkspaceView[], savedId?: string | null): WorkspaceView | undefined {
  return items.find(item => item.workspaceId === savedId) ?? items[0]
}

export type ArchivedFilter = 'default' | 'show' | 'only'

export type OrderBy = 'manual' | 'updated'

export function visibleSessions(
  workspace: WorkspaceView | undefined,
  byId: Record<string, SessionSummary>,
  archived: readonly string[],
  showSubagents: boolean,
  archivedFilter: ArchivedFilter = 'default',
): SessionSummary[] {
  const archivedIds = new Set(archived)
  return (workspace?.sessionIds ?? []).flatMap(id => {
    const session = Object.hasOwn(byId, id) ? byId[id] : undefined
    if (!session || (!showSubagents && session.origin === 'subagent')) return []
    const isArchived = archivedIds.has(id)
    if (archivedFilter === 'default' && isArchived) return []
    if (archivedFilter === 'only' && !isArchived) return []
    return [session]
  })
}

export function orderSessions(rows: readonly SessionSummary[], orderBy: OrderBy): SessionSummary[] {
  if (orderBy === 'manual') return [...rows]
  const time = (row: SessionSummary) => (Number.isFinite(row.updatedAt) ? row.updatedAt : Number.NEGATIVE_INFINITY)
  return [...rows].sort((a, b) => {
    const aTime = time(a), bTime = time(b)
    if (aTime !== bTime) return aTime > bTime ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function pinnedFirst(rows: readonly SessionSummary[], pinnedIds: readonly string[]): { rows: SessionSummary[]; pinned: ReadonlySet<string> } {
  const byId = new Map(rows.map(row => [row.id, row]))
  const ordered = [...new Set(pinnedIds)].flatMap(id => {
    const row = byId.get(id)
    return row ? [row] : []
  })
  const pinned = new Set(ordered.map(row => row.id))
  return { rows: [...ordered, ...rows.filter(row => !pinned.has(row.id))], pinned }
}

export function formatUpdatedAt(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return '日時不明'
  const pad = (value: number) => String(value).padStart(2, '0')
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

export function folderName(path?: string): string {
  if (!path) return '作業フォルダなし'
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

export function shortenHomePath(path: string, homePath?: string): string {
  if (!homePath) return path
  const home = homePath.replace(/[\\/]+$/u, '')
  if (!home) return path
  if (path === home || path === homePath) return '~'
  return path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path
}

export type ModelIcon = { kind: 'deepseek' | 'generic' } | { kind: 'initial'; initial: string }

export function modelIcon(selection: unknown): ModelIcon {
  if (!selection || typeof selection !== 'object') return { kind: 'generic' }
  const { provider, model } = selection as { provider?: unknown; model?: unknown }
  const modelName = typeof model === 'string' ? model.trim() : ''
  if (!modelName) return { kind: 'generic' }
  const providerName = typeof provider === 'string' ? provider.trim() : ''
  if (/^deepseek(?:[-_/\s]|$)/iu.test(providerName) || /(?:^|\/)deepseek(?:[-_/\s]|$)/iu.test(modelName)) {
    return { kind: 'deepseek' }
  }
  return { kind: 'initial', initial: Array.from(modelName)[0]!.toUpperCase() }
}
