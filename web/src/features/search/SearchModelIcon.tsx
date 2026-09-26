import type { CSSProperties } from 'react'
import type { SessionSummary } from '../../dsh/services.ts'
import deepseekIcon from '../home/model-icons/deepseek.svg'
import genericIcon from '../home/model-icons/generic.svg'
import { selectSearchModelIcon } from './search-model-icon.ts'

export function SearchModelIcon({ row }: { row: SessionSummary | undefined }) {
  const icon = selectSearchModelIcon(row?.projectionValues)
  return <span slot="leading" className="search-session-icon" aria-hidden="true">
    {icon.kind === 'initial' ? icon.initial : <span className="search-model-glyph"
      style={{ '--search-model-icon': `url("${icon.kind === 'deepseek' ? deepseekIcon : genericIcon}")` } as CSSProperties} />}
  </span>
}
