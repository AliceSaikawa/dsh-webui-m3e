import { M3eButton } from '@m3e/react/button'
import { M3eList, M3eListItem } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
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
    <M3eList className="st-details" aria-label="会話の統計">
      <M3eListItem><Icon slot="leading" name="data_usage" />トークン
        <span slot="supporting-text">入力 {formatTokens(usage?.uncachedInputTokens)} ・ 出力 {formatTokens(usage?.outputTokens)} ・ キャッシュ読み込み {formatTokens(usage?.cacheReadTokens)} ・ キャッシュ書き込み {formatTokens(usage?.cacheWriteTokens)}</span>
      </M3eListItem>
      <M3eListItem><Icon slot="leading" name="replay" />ターン
        <span slot="supporting-text">{maxTurn(records)}</span>
      </M3eListItem>
      <M3eListItem><Icon slot="leading" name="smart_toy" />モデル
        <span slot="supporting-text">{model?.model ?? '未取得'} ・ 考える深さ {reasoningLabel(model?.reasoningEffort)}</span>
      </M3eListItem>
    </M3eList>
    <div className="st-actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </section>
}
