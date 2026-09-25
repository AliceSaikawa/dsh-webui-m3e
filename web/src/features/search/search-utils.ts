export interface MatchRange {
  start: number
  end: number
}

export function normalizeQuery(value: string): string {
  return value.trim()
}

export function shouldSearch(query: string, previousQuery?: string): boolean {
  const normalized = normalizeQuery(query)
  return normalized.length > 0 && normalized !== normalizeQuery(previousQuery ?? '')
}

/** Offsets refer to the original string, so consumers can safely use slice. */
export function findMatchRanges(text: string, query: string): MatchRange[] {
  const normalized = normalizeQuery(query)
  if (!normalized) return []

  const literalQuery = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(literalQuery, 'giu')
  return Array.from(text.matchAll(pattern), match => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

export function selectRecentSessions<T extends { updatedAt: number }>(
  sessions: readonly T[],
  limit = 5,
): T[] {
  return [...sessions]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, Math.trunc(limit)))
}
