import { memo, useMemo, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { AttachmentImage } from './Attachments.tsx'
import { buildChatRows, formatDuration, formatToolArguments, type ChatContentBlock, type ChatRow } from './model.ts'
import { clipToolResult, toolErrorMessage } from './tool-output.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { chatMessages, toolDetailMessages } from './messages.ts'

type ToolRow = Extract<ChatRow, { kind: 'tool' }>

const ResultText = memo(function ResultText({ text }: { text: string }) {
  return <pre className="chat-json">{text}</pre>
})

const ResultBlocks = memo(function ResultBlockList({ blocks, face, close }: { blocks: readonly ChatContentBlock[]; face?: SessionFace; close: () => void }) {
  const text = useMessages(toolDetailMessages)
  return <>{blocks.map((block, index) => {
    if (block.type === 'text') return <ResultText key={index} text={block.text} />
    if (block.type === 'image') return <AttachmentImage key={index} attachment={block.attachment} face={face} beforeExpand={close} />
    const label = block.type === 'unsupported' ? block.originalType : ({ reasoning: text.reasoning, file: text.file, 'tool-call': text.toolCall } as const)[block.type]
    return <p className="muted" key={index}>{text.kind(label)}</p>
  })}</>
})

export function ToolDetail({ sessionId, initial, close }: { sessionId: string; initial: ToolRow; close: () => void }) {
  const { face, records, stream } = useSession(sessionId)
  const chat = useMessages(chatMessages)
  const text = useMessages(toolDetailMessages)
  const locale = useLocale()
  // Keep a running tool sheet current when its result arrives.
  const recorded = useMemo(() => buildChatRows(records, null, [], chat).find((item): item is ToolRow => item.kind === 'tool' && item.callKey === initial.callKey), [records, initial.callKey, chat])
  const row = useMemo(() => recorded ?? buildChatRows([], stream, [], chat).find((item): item is ToolRow => item.kind === 'tool' && item.callKey === initial.callKey) ?? initial, [recorded, stream, initial, chat])
  const [expanded, setExpanded] = useState(false)
  const clipped = useMemo(() => clipToolResult(row.result), [row.result])
  const argumentsText = useMemo(() => formatToolArguments(row.arguments), [row.arguments])
  const errorText = useMemo(() => toolErrorMessage(row.error, text), [row.error, text])
  return <section className="chat-detail"><h2>{text.title}</h2>
    <h3>{row.name}</h3><p className={row.status === 'error' ? 'chat-error-text' : 'muted'}>{row.status === 'running' ? chat.statusRunning : row.status === 'error' ? chat.statusFailed : chat.statusDone}</p>
    <h3 className="chat-detail-heading"><Icon name="data_object" />{text.argumentsHeading}</h3><pre className="chat-json">{argumentsText}</pre>
    <h3 className="chat-detail-heading"><Icon name="output" />{text.resultHeading}</h3>{row.result.length ? <ResultBlocks blocks={expanded ? row.result : clipped.blocks} face={face} close={close} />
      : <p className="muted">{row.status === 'running' ? text.waitingResult : text.emptyResult}</p>}
    {row.status === 'error' && <div className="chat-error-text"><p>{text.executionFailed}</p>{errorText && <pre className="chat-json">{errorText}</pre>}</div>}
    {!expanded && clipped.truncated && <M3eButton onClick={() => setExpanded(true)}>{text.showMore}</M3eButton>}
    <h3 className="chat-detail-heading"><Icon name="timer" />{text.durationHeading}</h3><p className="muted">{row.durationMs === undefined ? text.durationUnknown : formatDuration(row.durationMs, chat, locale)}</p>
    <div className="actions"><M3eButton onClick={close}>{text.close}</M3eButton></div>
  </section>
}
