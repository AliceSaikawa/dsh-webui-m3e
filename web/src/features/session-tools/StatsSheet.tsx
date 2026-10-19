import { M3eButton } from '@m3e/react/button'
import { M3eList, M3eListItem } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { useSession } from '../../dsh/session.ts'
import { contextPercent, formatTokens, maxTurn, reasoningLabel, type ContextPressure, type ModelSelection, type Usage } from './presentation.ts'
import { sessionToolsMessages } from './messages.ts'

export function StatsSheet({ sessionId, close }: { sessionId: string; close(): void }) {
  const text = useMessages(sessionToolsMessages)
  const locale = useLocale()
  const { projection, records } = useSession(sessionId)
  const usage = projection<Usage>('tokenUsage')
  const pressure = projection<ContextPressure>('contextPressure')
  const selection = projection<ModelSelection>('modelSelection')
  const percent = contextPercent(pressure)
  const model = selection?.next ?? selection?.lastUsed
  return <section className="st-stats">
    <h2>{text.stats}</h2>
    {percent !== undefined && <div className="st-card">
      <div className="st-between"><span>{text.contextUsage}</span><strong>{percent}%</strong></div>
      <progress className="st-progress" max={100} value={Math.min(100, percent)} aria-label={text.contextUsageLabel(percent)} />
    </div>}
    <M3eList className="st-details" aria-label={text.statsListLabel}>
      <M3eListItem><Icon slot="leading" name="data_usage" />{text.token}
        <span slot="supporting-text">{text.tokenUsageLine(
          formatTokens(usage?.uncachedInputTokens, locale, text),
          formatTokens(usage?.outputTokens, locale, text),
          formatTokens(usage?.cacheReadTokens, locale, text),
          formatTokens(usage?.cacheWriteTokens, locale, text),
        )}</span>
      </M3eListItem>
      <M3eListItem><Icon slot="leading" name="replay" />{text.turn}
        <span slot="supporting-text">{maxTurn(records)}</span>
      </M3eListItem>
      <M3eListItem><Icon slot="leading" name="smart_toy" />{text.model}
        <span slot="supporting-text">{text.modelLine(model?.model ?? text.notRetrieved, reasoningLabel(model?.reasoningEffort, text))}</span>
      </M3eListItem>
    </M3eList>
    <div className="st-actions"><M3eButton onClick={close}>{text.close}</M3eButton></div>
  </section>
}
