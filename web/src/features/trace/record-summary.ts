import type { TokenUsage } from '../../dsh/services.ts'
import { SOURCE_LOCALE, type Locale } from '../../i18n/locale.ts'
import { formatCount, formatDuration, type TraceRow } from './model.ts'
import { traceText, type TraceMessages } from './messages.ts'

export function recordDurationText(row: Pick<TraceRow, 'running' | 'durationMs' | 'firstOutputMs'>,
  text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): string {
  if (row.running) return text.rowRunning
  const duration = formatDuration(row.durationMs, text, locale)
  if (row.firstOutputMs === undefined) return duration
  return text.durationWithFirstOutput(duration, formatDuration(row.firstOutputMs, text, locale))
}

function optionalCount(value: number | undefined, text: TraceMessages, locale: Locale): string {
  return value === undefined ? text.notRecorded : formatCount(value, locale)
}
export function recordUsageText(usage: TokenUsage | undefined, text: TraceMessages = traceText, locale: Locale = SOURCE_LOCALE): string {
  if (!usage) return text.usageNone
  return text.usageSummary(
    formatCount(usage.inputTokens, locale),
    formatCount(usage.outputTokens, locale),
    optionalCount(usage.cacheReadTokens, text, locale),
    optionalCount(usage.cacheWriteTokens, text, locale),
  )
}

export function recordOutputText(row: Pick<TraceRow, 'kind' | 'running' | 'content'>, text: TraceMessages = traceText): string {
  if (row.kind === 'compaction') return row.running ? text.compactionBuilding : text.compactionSummary
  let reasoning = 0, textCount = 0, calls = 0
  for (const block of row.content) {
    if (block.type === 'reasoning') reasoning++
    else if (block.type === 'text') textCount++
    else if (block.type === 'tool-call') calls++
  }
  return text.outputSummary(reasoning, textCount, calls)
}

export function recordResultText(row: Pick<TraceRow, 'running' | 'failed'>, text: TraceMessages = traceText): string | undefined {
  if (row.running) return text.resultWaitingSupporting
  return row.failed ? text.terminationError : undefined
}
