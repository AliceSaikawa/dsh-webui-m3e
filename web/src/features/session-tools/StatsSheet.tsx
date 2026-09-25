import { M3eButton } from '@m3e/react/button'
import { useSession } from '../../dsh/session.ts'
import { contextPercent, formatTokens, maxTurn, reasoningLabel, type ContextPressure, type ModelSelection, type Usage } from './presentation.ts'

export function StatsSheet({ sessionId, close }: { sessionId: string; close(): void }) {
  const { projection, records } = useSession(sessionId)
  const usage = projection<Usage>('tokenUsage')
  const pressure = projection<ContextPressure>('contextPressure')
  const selection = projection<ModelSelection>('modelSelection')
  const percent = contextPercent(pressure)
  const model = selection?.next ?? selection?.lastUsed
  return <section className="st-stats">
    <h2>統計</h2>
    {percent !== undefined && <div className="st-card">
      <div className="st-between"><span>コンテキストの使用率</span><strong>{percent}%</strong></div>
      <progress className="st-progress" max={100} value={Math.min(100, percent)} aria-label={`コンテキストの使用率 ${percent}%`} />
    </div>}
    <dl className="st-details">
      <div><dt>入力トークン</dt><dd>{formatTokens(usage?.uncachedInputTokens)}</dd></div>
      <div><dt>出力トークン</dt><dd>{formatTokens(usage?.outputTokens)}</dd></div>
      <div><dt>キャッシュ読み込み</dt><dd>{formatTokens(usage?.cacheReadTokens)}</dd></div>
      <div><dt>キャッシュ書き込み</dt><dd>{formatTokens(usage?.cacheWriteTokens)}</dd></div>
      <div><dt>ターン</dt><dd>{maxTurn(records)}</dd></div>
      <div><dt>モデル</dt><dd>{model?.model ?? '未取得'}</dd></div>
      <div><dt>考える深さ</dt><dd>{reasoningLabel(model?.reasoningEffort)}</dd></div>
    </dl>
    <div className="st-actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </section>
}
