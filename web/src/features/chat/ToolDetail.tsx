import { memo, useMemo, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { AttachmentImage } from './Attachments.tsx'
import { buildChatRows, formatDuration, formatToolArguments, type ChatContentBlock, type ChatRow } from './model.ts'
import { clipToolResult, toolErrorMessage } from './tool-output.ts'

type ToolRow = Extract<ChatRow, { kind: 'tool' }>

const ResultText = memo(function ResultText({ text }: { text: string }) {
  return <pre className="chat-json">{text}</pre>
})

const ResultBlocks = memo(function ResultBlockList({ blocks, face, close }: { blocks: readonly ChatContentBlock[]; face?: SessionFace; close: () => void }) {
  return <>{blocks.map((block, index) => {
    if (block.type === 'text') return <ResultText key={index} text={block.text} />
    if (block.type === 'image') return <AttachmentImage key={index} attachment={block.attachment} face={face} beforeExpand={close} />
    const label = block.type === 'unsupported' ? block.originalType : ({ reasoning: '考えた内容', file: 'ファイル', 'tool-call': 'ツール呼び出し' } as const)[block.type]
    return <p className="muted" key={index}>種類：{label}</p>
  })}</>
})

export function ToolDetail({ sessionId, initial, close }: { sessionId: string; initial: ToolRow; close: () => void }) {
  const { face, records, stream } = useSession(sessionId)
  // Keep a running tool sheet current when its result arrives.
  const recorded = useMemo(() => buildChatRows(records).find((item): item is ToolRow => item.kind === 'tool' && item.callKey === initial.callKey), [records, initial.callKey])
  const row = useMemo(() => recorded ?? buildChatRows([], stream).find((item): item is ToolRow => item.kind === 'tool' && item.callKey === initial.callKey) ?? initial, [recorded, stream, initial])
  const [expanded, setExpanded] = useState(false)
  const clipped = useMemo(() => clipToolResult(row.result), [row.result])
  const argumentsText = useMemo(() => formatToolArguments(row.arguments), [row.arguments])
  const errorText = useMemo(() => toolErrorMessage(row.error), [row.error])
  return <section className="chat-detail"><h2>ツール呼び出しの詳細</h2>
    <h3>{row.name}</h3><p className={row.status === 'error' ? 'chat-error-text' : 'muted'}>{row.status === 'running' ? '実行中' : row.status === 'error' ? '失敗' : '完了'}</p>
    <h3 className="chat-detail-heading"><Icon name="data_object" />引数</h3><pre className="chat-json">{argumentsText}</pre>
    <h3 className="chat-detail-heading"><Icon name="output" />結果</h3>{row.result.length ? <ResultBlocks blocks={expanded ? row.result : clipped.blocks} face={face} close={close} />
      : <p className="muted">{row.status === 'running' ? '結果を待っています…' : '結果の本文はありません。'}</p>}
    {row.status === 'error' && <div className="chat-error-text"><p>ツールの実行に失敗しました。</p>{errorText && <pre className="chat-json">{errorText}</pre>}</div>}
    {!expanded && clipped.truncated && <M3eButton onClick={() => setExpanded(true)}>続きを表示</M3eButton>}
    <h3 className="chat-detail-heading"><Icon name="timer" />所要時間</h3><p className="muted">{row.durationMs === undefined ? '所要時間は不明です' : formatDuration(row.durationMs)}</p>
    <div className="actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </section>
}
