import type { SessionSummary, WorkspaceView } from '../../dsh/services.ts'

export function selectWorkspace(items: readonly WorkspaceView[], savedId?: string | null): WorkspaceView | undefined {
  return items.find(item => item.workspaceId === savedId) ?? items[0]
}

export function visibleSessions(
  workspace: WorkspaceView | undefined,
  byId: Record<string, SessionSummary>,
  archived: readonly string[],
  showSubagents: boolean,
): SessionSummary[] {
  const archivedIds = new Set(archived)
  return (workspace?.sessionIds ?? []).flatMap(id => {
    const session = Object.hasOwn(byId, id) ? byId[id] : undefined
    return session && !archivedIds.has(id) && (showSubagents || session.origin !== 'subagent') ? [session] : []
  })
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
