import type { SessionListState } from './services.ts'

/** Baseline ids plus addressed children synthesized by the controller's projectList. */
export function sessionRowIds(list: Pick<SessionListState, 'ids' | 'byId'>): string[] {
  return [...new Set([...list.ids, ...Object.entries(list.byId)
    .filter(([id, row]) => row.id === id && row.origin === 'subagent' && !!row.parentId)
    .map(([id]) => id)])]
}
