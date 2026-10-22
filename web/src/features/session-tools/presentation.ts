import type { SessionJob, SessionSummary, SessionWireEvent, SessionProjectionSnapshot } from '../../dsh/services.ts'
import { formatNumber } from '../../i18n/format.ts'
import { SOURCE_LOCALE, type Locale } from '../../i18n/locale.ts'
import { isLiveJob } from './operations.ts'
import { sessionToolsMessages, type SessionToolsText } from './messages.ts'

/** Japanese texts used when no dictionary is passed (non-React calls, tests). */
const defaultText: SessionToolsText = sessionToolsMessages.ja

export interface ContextPressure { pressureTokens?: number | null; projectedTokens?: number | null; contextWindow?: number | null }
export interface Usage { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface ModelSelection { next?: Model | null; lastUsed?: Model | null }
interface Model { model: string; reasoningEffort?: string }

export function contextPercent(value?: ContextPressure | null): number | undefined {
  const tokens = value?.pressureTokens ?? value?.projectedTokens
  const window = value?.contextWindow
  if (tokens == null || window == null || !Number.isFinite(tokens) || !Number.isFinite(window) || tokens < 0 || window <= 0) return undefined
  return Math.round(tokens / window * 100)
}

export interface CacheHit {
  /** The rate in percent, rounded for display (never 100 for a partial hit). */
  readonly value: number
  /** Decimal places that `value` is rounded to. */
  readonly fractionDigits: number
}

/**
 * Cache-hit rate of the whole conversation, matching the stock screen
 * (dsh-client-ui-chat `cacheHitPercent`): cache reads over the three input-side
 * buckets (uncached input + cache read + cache write). Returns undefined when
 * any bucket is missing or no input was sent, so no "0%" or "NaN%" is shown.
 * Ratios round to whole percent, ties up. A partial hit that would round to 100
 * keeps adding decimals until it stays below 100; only a full hit is 100.
 */
export function cacheHit(usage?: Usage | null): CacheHit | undefined {
  const buckets = [usage?.uncachedInputTokens, usage?.cacheReadTokens, usage?.cacheWriteTokens]
  if (!buckets.every((tokens): tokens is number => typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0)) return undefined
  const read = BigInt(buckets[1]!)
  const input = BigInt(buckets[0]!) + read + BigInt(buckets[2]!)
  if (input === 0n) return undefined
  if (read === input) return { value: 100, fractionDigits: 0 }
  for (let fractionDigits = 0; ; fractionDigits++) {
    const scale = 100n * 10n ** BigInt(fractionDigits)
    const units = (2n * read * scale + input) / (2n * input)
    if (units < scale) return { value: Number(units) / 10 ** fractionDigits, fractionDigits }
  }
}

/**
 * Token counts. Japanese and Chinese use a unit of 10,000 for values of
 * 10,000 and above; English prints the full count with grouping. The formatted
 * value and its placement follow the page language (formatNumber).
 */
export function formatTokens(value: number | undefined, locale: Locale = SOURCE_LOCALE, text: SessionToolsText = defaultText): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return text.notRetrieved
  if (locale === 'en' || value < 10000) return formatNumber(locale, Math.floor(value))
  return text.tenThousandTokens(formatNumber(locale, value / 10000, { maximumFractionDigits: 1 }))
}

export function maxTurn(records: readonly SessionWireEvent[]): number {
  return records.reduce((max, record) => {
    const data = record.data
    if (record.type !== 'turn/start' || !data || typeof data !== 'object' || !('turn' in data)) return max
    return typeof data.turn === 'number' && Number.isSafeInteger(data.turn) ? Math.max(max, data.turn) : max
  }, 0)
}

export function reasoningLabel(effort: string | undefined, text: SessionToolsText = defaultText): string {
  const labels: Record<string, string> = {
    none: text.reasoningNone, off: text.reasoningNone, minimal: text.reasoningMinimal, low: text.reasoningLow,
    medium: text.reasoningMedium, high: text.reasoningHigh, xhigh: text.reasoningVeryHigh, max: text.reasoningMax, ultra: text.reasoningMax,
  }
  return effort ? labels[effort] ?? text.reasoningConfigured : text.reasoningUnspecified
}

export type Child = { kind: 'child'; id: string; label?: string; activity: 'running' | 'inactive'; mode: 'one-shot' | 'continuable'; migrationRequired?: boolean }
export type ExternalChild = { kind: 'external'; id: string; label?: string }
export type CatalogEntry = Child | ExternalChild | { kind: 'diagnostic'; id: string }
export function catalogEntries(catalog?: SessionProjectionSnapshot, summaries: Record<string, SessionSummary> = {}): CatalogEntry[] {
  return (catalog?.values.subagentCatalog ?? []).filter(entry => entry && typeof entry.id === 'string' && (entry.mode === 'unknown' || entry.mode === 'one-shot' || entry.mode === 'continuable' || entry.mode === 'external')).map(entry => entry.mode === 'unknown'
    ? { kind: 'diagnostic', id: entry.id }
    : entry.mode === 'external'
    ? { kind: 'external', id: entry.id, ...(entry.label ? { label: entry.label } : {}) }
    : { kind: 'child', id: entry.id, label: entry.label, mode: entry.mode, activity: summaries[entry.id]?.running ? 'running' : 'inactive',
      ...(summaries[entry.id]?.formatStatus === 'migration-required' ? { migrationRequired: true } : {}) } as Child)
}
export function catalogRows(entries: readonly CatalogEntry[]): { children: Child[]; externals: ExternalChild[]; diagnosticCount: number } {
  return { children: entries.filter((entry): entry is Child => entry.kind === 'child'),
    externals: entries.filter((entry): entry is ExternalChild => entry.kind === 'external'),
    diagnosticCount: entries.filter(entry => entry.kind === 'diagnostic').length }
}
export function childAddress(parentSessionId: string, child: Child) {
  return { parentSessionId, childSessionId: child.id, mode: child.mode }
}
export function hasChildren(sessionId: string, catalog: SessionProjectionSnapshot | undefined, summaries: Record<string, SessionSummary>): boolean {
  return catalogEntries(catalog).some(entry => entry.kind !== 'diagnostic') || Object.values(summaries).some(summary => summary.parentId === sessionId && summary.origin === 'subagent')
}
export type MenuAction = 'rename' | 'stats' | 'files' | 'jobs' | 'subagents' | 'goal' | 'archive'
export function menuActions(children: boolean, goal: unknown): MenuAction[] {
  return ['rename', 'stats', 'files', 'jobs', ...(children ? ['subagents' as const] : []), ...(goal ? ['goal' as const] : []), 'archive']
}
export function runningJobCount(jobs: readonly SessionJob[] = []): number { return jobs.filter(isLiveJob).length }
