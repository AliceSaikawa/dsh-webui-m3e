import { useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Markdown } from '../../app/Markdown.tsx'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { AttachmentImage } from './Attachments.tsx'
import { buildChatRows, formatDuration, formatToolArguments, type ChatContentBlock, type ChatRow } from './model.ts'
import { clipToolResult } from './tool-result.ts'

type ToolRow = Extract<ChatRow, { kind: 'tool' }>

function ResultBlocks({ blocks, face, close }: { blocks: readonly ChatContentBlock[]; face?: SessionFace; close: () => void }) {
  return <>{blocks.map((block, index) => {
    if (block.type === 'text') return <Markdown key={index}>{block.text}</Markdown>
    if (block.type === 'image') return <AttachmentImage key={index} attachment={block.attachment} face={face} beforeExpand={close} />
    if (block.type === 'tool-result') return <div key={index} className="chat-nested-result"><ResultBlocks blocks={block.content} face={face} close={close} /></div>
    const label = block.type === 'unsupported' ? block.originalType : ({ reasoning: '考えた内容', file: 'ファイル', 'tool-call': 'ツール呼び出し' } as const)[block.type]
    return <p className="muted" key={index}>種類：{label}</p>
  })}</>
}

export function ToolDetail({ sessionId, initial, close }: { sessionId: string; initial: ToolRow; close: () => void }) {
  const { face, records, stream } = useSession(sessionId)
  // Keep a running tool sheet current when its result arrives.
  const row = buildChatRows(records, stream).find((item): item is ToolRow => item.kind === 'tool' && item.callId === initial.callId) ?? initial
  const [expanded, setExpanded] = useState(false)
  const clipped = clipToolResult(row.result)
  return <section className="chat-detail"><h2>ツール呼び出しの詳細</h2>
    <h3>{row.name}</h3><p className={row.status === 'error' ? 'chat-error-text' : 'muted'}>{row.status === 'running' ? '実行中' : row.status === 'error' ? '失敗' : '完了'}
      {' ・ '}{row.durationMs === undefined ? '所要時間は不明です' : formatDuration(row.durationMs)}</p>
    <h3>引数</h3><pre className="chat-json">{formatToolArguments(row.arguments)}</pre>
    <h3>結果</h3>{row.result.length ? <ResultBlocks blocks={expanded ? row.result : clipped.blocks} face={face} close={close} />
      : <p className="muted">{row.status === 'running' ? '結果を待っています…' : '結果の本文はありません。'}</p>}
    {row.status === 'error' && <p className="chat-error-text">ツールの実行に失敗しました。</p>}
    {!expanded && clipped.truncated && <M3eButton onClick={() => setExpanded(true)}>続きを表示</M3eButton>}
    <div className="actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </section>
}
