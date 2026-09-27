import { memo, useMemo, useRef } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import { showSnackbar } from '../../app/overlay/index.ts'
import { back } from '../../app/router.ts'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { AttachmentImage, FileAttachment, PreviewImage } from './Attachments.tsx'
import { MessageActions } from './MessageActions.tsx'
import { ChatSheets, useChatSheets } from './ChatSheets.tsx'
import { ToolDetail } from './ToolDetail.tsx'
import { appendLiveRows, buildSettledChat, commandPresentation, formatDuration, summarizeToolArguments, toolIcon, type ChatRow } from './model.ts'
import { useChatScroll } from './useChatScroll.ts'
import './chat.css'

function Progress({ children }: { children: string }) {
  return <div className="chat-progress" role="status"><span aria-hidden="true" className="chat-progress-dot" />{children}</div>
}

/** Memoized so rows that keep their identity skip Markdown rendering while a reply streams. */
const Row = memo(function Row({ row, sessionId, face, active }: { row: ChatRow; sessionId: string; face?: SessionFace; active: boolean }) {
  const sheets = useChatSheets()
  if (row.kind === 'user') return <article className="chat-user" aria-label="自分のメッセージ">
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}>
      {row.text && <p className="chat-bubble">{row.text}</p>}
      <div className="chat-attachments">{row.content.map((block, index) => block.type === 'image'
        ? <AttachmentImage key={index} attachment={block.attachment} face={face} />
        : block.type === 'file' ? <FileAttachment key={index} attachment={block.attachment} /> : null)}</div>
    </MessageActions></article>
  if (row.kind === 'assistant') return row.text ? <article className="chat-assistant" aria-label="AI のメッセージ" aria-busy={row.streaming}>
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}><ChatMarkdown>{row.text}</ChatMarkdown></MessageActions>
  </article> : null
  if (row.kind === 'reasoning') return <details className="chat-reasoning"><summary><Icon name="psychology" /><span className="chat-row-label">{row.streaming ? '考えています…' : '考えた内容'}</span>
    {row.durationMs !== undefined && <span className="chat-reasoning-duration">{formatDuration(row.durationMs)}</span>}<Icon className="chat-chevron" name="expand_more" /></summary>
    <ChatMarkdown>{row.text || '内容を待っています…'}</ChatMarkdown></details>
  if (row.kind === 'tool') {
    const summary = summarizeToolArguments(row.arguments)
    const label = row.status === 'running' ? '実行中' : row.status === 'error' ? '失敗' : '完了'
    return <button type="button" className={`chat-tool ${row.status === 'error' ? 'chat-tool-error' : ''}`}
      onClick={() => sheets.open(close => <ToolDetail sessionId={sessionId} initial={row} close={close} />, { label: 'ツール呼び出しの詳細' })}>
      <Icon name={toolIcon(row.name)} />
      <span className="chat-tool-body"><strong>{row.name || 'ツール'}</strong><span>{summary && <span className="chat-tool-summary">{summary}</span>}
        <span>{label}{row.durationMs !== undefined && ` ・ ${formatDuration(row.durationMs)}`}</span></span></span><Icon name={row.status === 'error' ? 'error' : row.status === 'running' ? 'pending' : 'chevron_right'} />
    </button>
  }
  if (row.kind === 'system' || row.kind === 'context') {
    const title = row.kind === 'system' ? 'システムプロンプト' : row.role === 'recall' ? '別の会話から参照' : '追加された文脈'
    const label = row.kind === 'context' ? row.label : null
    return <details className="chat-context"><summary><Icon name={row.kind === 'system' ? 'settings' : row.role === 'recall' ? 'history' : 'description'} />
      <span className="chat-row-label">{title}{label && <span className="chat-context-source">{label}</span>}</span><Icon className="chat-chevron" name="expand_more" /></summary>
      <pre className="chat-context-body">{row.text}</pre></details>
  }
  if (row.kind === 'command') {
    const presentation = commandPresentation(row)
    const text = presentation.failureReason ?? row.text
    const className = `chat-command${row.status === 'error' ? ' chat-command-error' : ''}`
    return text ? <details className={className}><summary><Icon name={presentation.icon} /><span className="chat-row-label">{presentation.label}</span><Icon className="chat-chevron" name="expand_more" /></summary><ChatMarkdown>{text}</ChatMarkdown></details>
      : <p className={`${className} chat-command-static`}><Icon name={presentation.icon} /><span>{presentation.label}</span></p>
  }
  if (row.kind !== 'pending') return null
  return <article className="chat-user chat-pending" aria-label="送信中のメッセージ">
    {row.text && <p className="chat-bubble">{row.text}</p>}<div className="chat-attachments">{row.submission.attachments.map((attachment, index) => attachment.type === 'image'
      ? <PreviewImage key={index} url={attachment.value.previewUrl} name={attachment.value.name} />
      : <FileAttachment key={index} attachment={attachment.value} />)}</div><small>送信中…</small>
  </article>
})

/** A key resets scroll and expanded rows when routing to a different session. */
export function ChatView({ sessionId, active }: { sessionId: string; active: boolean }) {
  return <ChatSheets key={sessionId}><SessionChat sessionId={sessionId} active={active} /></ChatSheets>
}

function SessionChat({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { face, snapshot, records, stream } = useSession(sessionId)
  const settled = useMemo(() => buildSettledChat(records), [records])
  const rows = useMemo(() => appendLiveRows(settled, stream, snapshot.pendingSubmissions), [settled, stream, snapshot.pendingSubmissions])
  const revision = useMemo(() => ({ rows, error: snapshot.lastAgentError, waiting: snapshot.awaitingFirstTurn, open: snapshot.openState }), [rows, snapshot.lastAgentError, snapshot.awaitingFirstTurn, snapshot.openState])
  const scroll = useChatScroll({ face, revision, active, ready: snapshot.openState === 'open', loadingOlder: snapshot.loadingOlder, hasMore: snapshot.hasMore,
    onLoadError: () => showSnackbar('前のメッセージを読み込めませんでした。もう一度お試しください。') })
  const touchY = useRef<number | null>(null)
  return <section className="chat-view" aria-label="チャット">
    <div className="chat-scroll" ref={scroll.viewport} data-scroll-area tabIndex={0} onScroll={scroll.onScroll}
      onClickCapture={event => { if ((event.target as HTMLElement).closest('summary')) scroll.stopFollowing() }}
      onWheel={event => { if (event.deltaY < 0) scroll.stopFollowing() }}
      onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null }}
      onTouchMove={event => { const y = event.touches[0]?.clientY; if (y !== undefined && touchY.current !== null && y - touchY.current > 8) scroll.stopFollowing() }}
      onTouchEnd={() => { touchY.current = null }}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) scroll.stopFollowing() }}>
      <div className="chat-rows" ref={scroll.content}>
        {snapshot.openState === 'loading' || snapshot.openState === 'cold' ? <div className="chat-state"><Progress>会話を読み込んでいます…</Progress></div>
          : snapshot.openState === 'error' ? <div className="chat-state"><p role="alert">{remoteErrorMessage(snapshot.openError)}</p><M3eButton onClick={back}>一覧に戻る</M3eButton></div>
            : <>
              <div className="chat-older">{snapshot.loadingOlder || scroll.requesting ? <Progress>前のメッセージを読み込んでいます…</Progress>
                : snapshot.hasMore && <M3eButton onClick={() => void scroll.loadOlder()}>前のメッセージを読み込む</M3eButton>}</div>
              {rows.length === 0 && <div className="chat-state"><Icon name="chat_bubble" /><h2>何をしますか</h2><p>下の入力欄からメッセージを送れます。</p></div>}
              {rows.map(row => <div key={row.key} data-chat-key={row.key}><Row row={row} sessionId={sessionId} face={face} active={active} /></div>)}
              {snapshot.awaitingFirstTurn && <Progress>AI の応答を待っています…</Progress>}
              {stream && !stream.content.some(block => block.type !== 'text' || block.text.length > 0) && <Progress>返事を生成しています…</Progress>}
              {snapshot.lastAgentError && <aside className="chat-error-card" role="alert"><Icon name="error" /><div><h3>AI の処理が止まりました</h3><p>{snapshot.lastAgentError}</p></div></aside>}
            </>}
      </div>
    </div>
    {active && scroll.latestVisible && <M3eButton variant="filled" className="chat-latest" onClick={scroll.toLatest}><Icon name="arrow_downward" />最新へ</M3eButton>}
  </section>
}
