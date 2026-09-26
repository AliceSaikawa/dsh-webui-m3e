import type { TokenUsage } from '../../dsh/services.ts'
import { formatCount, formatDuration, type TraceRow } from './model.ts'

/** Supporting text of the record rows laid out as in Canvas `record`. */
export const recordInputSupporting = '送ったメッセージとツールの結果'

export function recordDurationText(row: Pick<TraceRow, 'running' | 'durationMs' | 'firstOutputMs'>): string {
  if (row.running) return '開始済み・実行中'
  const first = row.firstOutputMs === undefined ? '' : `（最初の出力まで ${formatDuration(row.firstOutputMs)}）`
  return `${formatDuration(row.durationMs)}${first}`
}

function optionalCount(value: number | undefined): string {
  return value === undefined ? '未記録' : formatCount(value)
}
export function recordUsageText(usage: TokenUsage | undefined): string {
  if (!usage) return 'トークン数は記録されていません'
  return [
    `入力 ${formatCount(usage.inputTokens)}（キャッシュを除く）`,
    `出力 ${formatCount(usage.outputTokens)}`,
    `キャッシュ読み込み ${optionalCount(usage.cacheReadTokens)}`,
    `キャッシュ書き込み ${optionalCount(usage.cacheWriteTokens)}`,
  ].join(' ・ ')
}

export function recordOutputText(row: Pick<TraceRow, 'kind' | 'running' | 'content'>): string {
  if (row.kind === 'compaction') return row.running ? '要約を作っています' : 'まとめた要約'
  let reasoning = 0, text = 0, calls = 0
  for (const block of row.content) {
    if (block.type === 'reasoning') reasoning++
    else if (block.type === 'text') text++
    else if (block.type === 'tool-call') calls++
  }
  return `思考 ${reasoning} ・ テキスト ${text} ・ ツール呼び出し ${calls}`
}

export function recordResultText(row: Pick<TraceRow, 'running' | 'failed'>): string | undefined {
  if (row.running) return '結果を待っています'
  return row.failed ? '失敗' : undefined
}
