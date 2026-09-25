import { useMemo, useRef } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { Markdown } from '../../app/Markdown.tsx'
import { openSheet, showSnackbar } from '../../app/overlay/index.ts'
import { back } from '../../app/router.ts'
import { useSession } from '../../dsh/session.ts'
import type { SessionFace } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { AttachmentImage, FileAttachment, PreviewImage } from './Attachments.tsx'
import { MessageActions } from './MessageActions.tsx'
import { ToolDetail } from './ToolDetail.tsx'
import { buildChatRows, commandPresentation, formatDuration, summarizeToolArguments, type ChatRow } from './model.ts'
import { useChatScroll } from './useChatScroll.ts'
import './chat.css'

function Progress({ children }: { children: string }) {
  return <div className="chat-progress" role="status"><span aria-hidden="true" className="chat-progress-dot" />{children}</div>
}

function Row({ row, sessionId, face, active }: { row: ChatRow; sessionId: string; face?: SessionFace; active: boolean }) {
  if (row.kind === 'user') return <article className="chat-user" aria-label="自分のメッセージ">
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}>
      {row.text && <p className="chat-bubble">{row.text}</p>}
      <div className="chat-attachments">{row.content.map((block, index) => block.type === 'image'
        ? <AttachmentImage key={index} attachment={block.attachment} face={face} />
        : block.type === 'file' ? <FileAttachment key={index} attachment={block.attachment} /> : null)}</div>
    </MessageActions></article>
  if (row.kind === 'assistant') return row.text ? <article className="chat-assistant" aria-label="AI のメッセージ" aria-busy={row.streaming}>
    <MessageActions sessionId={sessionId} text={row.text} seq={row.seq} active={active}><Markdown>{row.text}</Markdown></MessageActions>
  </article> : null
  if (row.kind === 'reasoning') return <details className="chat-reasoning"><summary><Icon name="psychology" />{row.streaming ? '考えています…' : '考えた内容'}<Icon className="chat-chevron" name="expand_more" /></summary>
    <Markdown>{row.text || '内容を待っています…'}</Markdown></details>
  if (row.kind === 'tool') {
    const summary = summarizeToolArguments(row.arguments)
    const label = row.status === 'running' ? '実行中' : row.status === 'error' ? '失敗' : '完了'
    return <button type="button" className={`chat-tool ${row.status === 'error' ? 'chat-tool-error' : ''}`}
      onClick={() => openSheet(close => <ToolDetail sessionId={sessionId} initial={row} close={close} />, { label: 'ツール呼び出しの詳細' })}>
      <Icon name={row.status === 'error' ? 'error' : row.status === 'running' ? 'pending' : 'terminal'} />
      <span className="chat-tool-body"><strong>{row.name || 'ツール'}</strong><span>{summary && <span className="chat-tool-summary">{summary}</span>}
        <span>{label}{row.durationMs !== undefined && ` ・ ${formatDuration(row.durationMs)}`}</span></span></span><Icon name="chevron_right" />
    </button>
  }
  if (row.kind === 'system') return <p className="chat-system">{row.text}</p>
  if (row.kind === 'command') {
    const presentation = commandPresentation(row)
    if (row.status === 'error') return <aside className="chat-error-card" role="alert"><Icon name={presentation.icon} />
      <div><h3>{presentation.label}</h3><Markdown>{presentation.failureReason ?? row.text}</Markdown></div></aside>
    return row.text ? <details className="chat-command"><summary><Icon name={presentation.icon} />{presentation.label}<Icon name="expand_more" /></summary><Markdown>{row.text}</Markdown></details>
      : <p className="chat-system">{presentation.label}</p>
  }
  if (row.kind !== 'pending') return null
  return <article className="chat-user chat-pending" aria-label="送信中のメッセージ">
    {row.text && <p className="chat-bubble">{row.text}</p>}<div className="chat-attachments">{row.submission.attachments.map((attachment, index) => attachment.type === 'image'
      ? <PreviewImage key={index} url={attachment.value.previewUrl} name={attachment.value.name} />
      : <FileAttachment key={index} attachment={attachment.value} />)}</div><small>送信中…</small>
  </article>
}

/** A key resets scroll and expanded rows when routing to a different session. */
export function ChatView({ sessionId, active }: { sessionId: string; active: boolean }) { return <SessionChat key={sessionId} sessionId={sessionId} active={active} /> }

function SessionChat({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { face, snapshot, records, stream } = useSession(sessionId)
  const rows = useMemo(() => buildChatRows(records, stream, snapshot.pendingSubmissions), [records, stream, snapshot.pendingSubmissions])
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
