import { memo, useMemo, useRef } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import { showSnackbar } from '../../app/overlay/index.ts'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { AttachmentImage, FileAttachment, PreviewImage } from './Attachments.tsx'
import { MessageActions } from './MessageActions.tsx'
import { ChatSheets, useChatSheets } from './ChatSheets.tsx'
import { ToolDetail } from './ToolDetail.tsx'
import { appendLiveRows, buildSettledChat, formatCommandPresentation, formatDuration, summarizeToolArguments, toolIcon, type ChatRow } from './model.ts'
import { useChatScroll } from './useChatScroll.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { chatMessages } from './messages.ts'
import './chat.css'

function Progress({ children }: { children: string }) {
  return <div className="chat-progress" role="status"><span aria-hidden="true" className="chat-progress-dot" />{children}</div>
}

/** Memoized so rows that keep their identity skip Markdown rendering while a reply streams. */
const Row = memo(function Row({ row, sessionId, face, active }: { row: ChatRow; sessionId: string; face?: SessionFace; active: boolean }) {
  const sheets = useChatSheets()
  const text = useMessages(chatMessages)
  const locale = useLocale()
  if (row.kind === 'user') return <article className="chat-user" aria-label={text.userMessageLabel}>
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}>
      {row.text && <p className="chat-bubble">{row.text}</p>}
      <div className="chat-attachments">{row.content.map((block, index) => block.type === 'image'
        ? <AttachmentImage key={index} attachment={block.attachment} face={face} />
        : block.type === 'file' ? <FileAttachment key={index} attachment={block.attachment} /> : null)}</div>
    </MessageActions></article>
  if (row.kind === 'assistant') return row.text ? <article className="chat-assistant" aria-label={text.assistantMessageLabel} aria-busy={row.streaming}>
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}><ChatMarkdown>{row.text}</ChatMarkdown></MessageActions>
  </article> : null
  if (row.kind === 'reasoning') return <details className="chat-reasoning"><summary><Icon name="psychology" /><span className="chat-row-label">{row.streaming ? text.thinking : text.thoughtContent}</span>
    {row.durationMs !== undefined && <span className="chat-reasoning-duration">{formatDuration(row.durationMs, text, locale)}</span>}<Icon className="chat-chevron" name="expand_more" /></summary>
    <ChatMarkdown>{row.text || text.reasoningWaiting}</ChatMarkdown></details>
  if (row.kind === 'tool') {
    const summary = summarizeToolArguments(row.arguments)
    const label = row.status === 'running' ? text.statusRunning : row.status === 'error' ? text.statusFailed : text.statusDone
    return <button type="button" className={`chat-tool ${row.status === 'error' ? 'chat-tool-error' : ''}`}
      onClick={() => sheets.open(close => <ToolDetail sessionId={sessionId} initial={row} close={close} />, { label: text.toolDetailLabel })}>
      <Icon name={toolIcon(row.name)} />
      <span className="chat-tool-body"><strong>{row.name || text.toolFallbackName}</strong><span>{summary && <span className="chat-tool-summary">{summary}</span>}
        <span>{label}{row.durationMs !== undefined && `${text.toolMetaSeparator}${formatDuration(row.durationMs, text, locale)}`}</span></span></span><Icon name={row.status === 'error' ? 'error' : row.status === 'running' ? 'pending' : 'chevron_right'} />
    </button>
  }
  if (row.kind === 'system' || row.kind === 'context') {
    const title = row.kind === 'system' ? text.systemPrompt : row.role === 'recall' ? text.recalledContext : text.injectedContext
    const label = row.kind === 'context' ? row.label : null
    return <details className="chat-context"><summary><Icon name={row.kind === 'system' ? 'settings' : row.role === 'recall' ? 'history' : 'description'} />
      <span className="chat-row-label">{title}{label && <span className="chat-context-source">{label}</span>}</span><Icon className="chat-chevron" name="expand_more" /></summary>
      {row.text && <pre className="chat-context-body">{row.text}</pre>}
      {row.kind === 'context' && <div className="chat-attachments chat-context-attachments">{row.content.map((block, index) => block.type === 'image'
        ? <AttachmentImage key={index} attachment={block.attachment} face={face} />
        : block.type === 'file' ? <FileAttachment key={index} attachment={block.attachment} /> : null)}</div>}</details>
  }
  if (row.kind === 'command-input') {
    return <article className="chat-user chat-command-input" aria-label={text.commandInputLabel}>
      <p className="chat-bubble chat-bubble-command">{row.text}</p>
    </article>
  }
  if (row.kind === 'command') {
    const presentation = formatCommandPresentation(row, text)
    const body = presentation.failureReason ?? row.text
    const className = `chat-command${row.status === 'error' ? ' chat-command-error' : ''}`
    return body ? <details className={className}><summary><Icon name={presentation.icon} /><span className="chat-row-label">{presentation.label}</span><Icon className="chat-chevron" name="expand_more" /></summary><ChatMarkdown>{body}</ChatMarkdown></details>
      : <p className={`${className} chat-command-static`}><Icon name={presentation.icon} /><span>{presentation.label}</span></p>
  }
  if (row.kind !== 'pending') return null
  return <article className="chat-user chat-pending" aria-label={text.pendingMessageLabel}>
    {row.text && <p className="chat-bubble">{row.text}</p>}<div className="chat-attachments">{row.submission.attachments.map((attachment, index) => attachment.type === 'image'
      ? <PreviewImage key={index} url={attachment.value.previewUrl} name={attachment.value.name} />
      : <FileAttachment key={index} attachment={attachment.value} />)}</div><small>{text.pendingSending}</small>
  </article>
})

/** A key resets scroll and expanded rows when routing to a different session. */
export function ChatView({ sessionId, active }: { sessionId: string; active: boolean }) {
  return <ChatSheets key={sessionId}><SessionChat sessionId={sessionId} active={active} /></ChatSheets>
}

function SessionChat({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { face, snapshot, records, stream } = useSession(sessionId)
  const text = useMessages(chatMessages)
  const settled = useMemo(() => buildSettledChat(records, text), [records, text])
  const rows = useMemo(() => appendLiveRows(settled, stream, snapshot.pendingSubmissions, text), [settled, stream, snapshot.pendingSubmissions, text])
  const revision = useMemo(() => ({ rows, error: snapshot.lastAgentError, waiting: snapshot.awaitingFirstTurn, open: snapshot.openState }), [rows, snapshot.lastAgentError, snapshot.awaitingFirstTurn, snapshot.openState])
  const scroll = useChatScroll({ face, revision, active, ready: snapshot.openState === 'open', loadingOlder: snapshot.loadingOlder, hasMore: snapshot.hasMore,
    onLoadError: () => showSnackbar(text.loadOlderFailed) })
  const touchY = useRef<number | null>(null)
  return <section className="chat-view" aria-label={text.viewLabel}>
    <div className="chat-scroll" ref={scroll.viewport} data-scroll-area tabIndex={0} onScroll={scroll.onScroll}
      onClickCapture={event => { if ((event.target as HTMLElement).closest('summary')) scroll.stopFollowing() }}
      onWheel={event => { if (event.deltaY < 0) scroll.stopFollowing() }}
      onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null }}
      onTouchMove={event => { const y = event.touches[0]?.clientY; if (y !== undefined && touchY.current !== null && y - touchY.current > 8) scroll.stopFollowing() }}
      onTouchEnd={() => { touchY.current = null }}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) scroll.stopFollowing() }}>
      <div className="chat-rows" ref={scroll.content}>
        {snapshot.openState === 'loading' || snapshot.openState === 'cold' ? <div className="chat-state"><Progress>{text.loadingConversation}</Progress></div>
          : <>
              <div className="chat-older">{snapshot.loadingOlder || scroll.requesting ? <Progress>{text.loadingOlder}</Progress>
                : snapshot.hasMore && <M3eButton onClick={() => void scroll.loadOlder()}>{text.loadOlder}</M3eButton>}</div>
              {rows.length === 0 && <div className="chat-state"><Icon name="chat_bubble" /><h2>{text.emptyTitle}</h2><p>{text.emptyBody}</p></div>}
              {rows.map(row => <div key={row.key} data-chat-key={row.key}><Row row={row} sessionId={sessionId} face={face} active={active} /></div>)}
              {snapshot.awaitingFirstTurn && <Progress>{text.awaitingResponse}</Progress>}
              {stream && !stream.content.some(block => block.type !== 'text' || block.text.length > 0) && <Progress>{text.generating}</Progress>}
              {snapshot.lastAgentError && <aside className="chat-error-card" role="alert"><Icon name="error" /><div><h3>{text.stopped}</h3><p>{snapshot.lastAgentError}</p></div></aside>}
            </>}
      </div>
    </div>
    {active && scroll.latestVisible && <M3eButton variant="filled" className="chat-latest" onClick={scroll.toLatest}><Icon name="arrow_downward" />{text.toLatest}</M3eButton>}
  </section>
}
