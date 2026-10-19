import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { M3eButton } from '@m3e/react/button'
import { M3eExpandableListItem, M3eList, M3eListItem, type M3eExpandableListItemElement } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import type { ImageAttachmentRef, SessionFace } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { findTraceRow, formatCount, formatJson, selectTrace, terminationLabel, type TraceInputBlock, type TraceRow } from './model.ts'
import { traceMessages } from './messages.ts'
import { recordDurationText, recordOutputText, recordResultText, recordUsageText } from './record-summary.ts'

function ImageAttachment({ attachment, face }: { attachment: ImageAttachmentRef; face: SessionFace | undefined }) {
  const text = useMessages(traceMessages)
  const locale = useLocale()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  const objectUrl = useRef('')
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [])
  const load = async () => {
    if (!face || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await face.readAttachment(attachment.attachmentId)
      if (!alive.current) return
      if (!result.ok) { setError(text.imageLoadFailed); return }
      const blob = new Blob([new Uint8Array(result.value.data)], { type: result.value.attachment.mediaType })
      objectUrl.current = URL.createObjectURL(blob)
      setUrl(objectUrl.current)
    } catch { if (alive.current) setError(text.imageLoadFailed) }
    finally { if (alive.current) setLoading(false) }
  }
  const name = attachment.name ?? text.imageFallbackName
  return <div className="trace-attachment">
    <p>{text.imageInfo(name, attachment.width, attachment.height, formatCount(attachment.bytes, locale))}</p>
    {url ? <img src={url} alt={name} /> : <M3eButton variant="text" disabled={loading || !face} onClick={() => { void load() }}>{loading ? text.loading : text.imageShow}</M3eButton>}
    {error && <p role="alert" className="trace-error">{error}</p>}
  </div>
}

function Content({ content, face }: { content: readonly TraceInputBlock[]; face: SessionFace | undefined }) {
  const text = useMessages(traceMessages)
  const locale = useLocale()
  if (!content.length) return <p className="muted">{text.contentEmpty}</p>
  return <div className="trace-blocks">{content.map((block, index) => {
    switch (block.type) {
      case 'text': return <p className="trace-text" key={index}>{block.text}</p>
      case 'reasoning': return <details key={index}><summary>{text.reasoningSummary}</summary><p className="trace-text">{block.text}</p></details>
      case 'tool-call': return <details key={index}><summary>{text.toolCallSummary(block.name)}</summary><Json value={block.arguments} /></details>
      case 'tool-output': return <details key={index}><summary>{text.toolOutputSummary(block.isError === true)}</summary><Content content={block.content} face={face} /></details>
      case 'image': return <ImageAttachment key={`${block.attachment.attachmentId}:${index}`} attachment={block.attachment} face={face} />
      case 'file': return <p key={index}>{text.fileInfo(block.attachment.name, formatCount(block.attachment.bytes, locale))}</p>
      default: return <p key={index} className="muted">{text.contentUnsupported}</p>
    }
  })}</div>
}

/**
 * Formatted JSON. `partial` covers text the model already formatted with
 * omission marks, which no longer parses as JSON here.
 */
function Json({ value, partial = false }: { value: unknown; partial?: boolean }) {
  const text = useMessages(traceMessages)
  const locale = useLocale()
  const json = formatJson(value, text, locale)
  return <>
    <pre>{json.text}</pre>
    {(json.partial || partial) && <p className="trace-note">{text.jsonNote}</p>}
  </>
}

function InfoRow({ icon, label, supporting }: { icon: string; label: string; supporting: string }) {
  return <M3eListItem className="trace-record-row">
    <Icon slot="leading" name={icon} />{label}
    <span slot="supporting-text">{supporting}</span>
  </M3eListItem>
}

/**
 * A Canvas `record` row that opens its detail in place instead of nesting a
 * sheet. A lazy row renders nothing while closed, so a closed input never
 * resolves or mounts the potentially long history.
 */
function ExpandRow({ icon, label, supporting, initiallyOpen = false, lazy = false, render }: {
  icon: string; label: string; supporting?: string; initiallyOpen?: boolean; lazy?: boolean; render: () => ReactNode
}) {
  const [mounted, setMounted] = useState(!lazy || initiallyOpen)
  const initialized = useRef(false)
  // The wrapper assigns `open` on every render, which would undo the user's
  // toggle. Set the initial state once and let the element own it afterwards.
  const attach = useCallback((element: M3eExpandableListItemElement | null) => {
    if (!element || initialized.current) return
    initialized.current = true
    if (initiallyOpen) element.open = true
  }, [initiallyOpen])
  const own = (event: Event) => event.target === event.currentTarget
  // The collapsible measures its content right after `opening`; render first.
  return <M3eExpandableListItem ref={attach} className="trace-record-row"
    onOpening={lazy ? (event: Event) => { if (own(event)) flushSync(() => setMounted(true)) } : undefined}
    onClosed={lazy ? (event: Event) => { if (own(event)) setMounted(false) } : undefined}>
    <Icon slot="leading" name={icon} />{label}
    {supporting && <span slot="supporting-text">{supporting}</span>}
    <div slot="items" role="listitem" className="trace-record-panel">{mounted && render()}</div>
  </M3eExpandableListItem>
}

export function RecordSheet({ sessionId, initialRow, close }: { sessionId: string; initialRow: TraceRow; close: () => void }) {
  const text = useMessages(traceMessages)
  const locale = useLocale()
  const { face, records, stream, snapshot } = useSession(sessionId)
  const row = useMemo(() => findTraceRow(selectTrace(records, stream, snapshot.running, text, locale), initialRow.id) ?? initialRow,
    [records, stream, snapshot.running, text, locale, initialRow])
  const duration = <InfoRow icon="timer" label={text.durationLabel} supporting={recordDurationText(row, text, locale)} />
  return <article className="trace-record">
    <h2>{text.recordHeading(row.title, row.turn)}</h2>
    {row.termination ? <p className={row.failed ? 'trace-error' : 'muted'} role="status">{text.terminationStatus(terminationLabel(row.termination, text), row.termination.message)}</p>
      : row.failed && <p className="trace-error" role="status">{row.error ? text.failureWithReason(row.error) : text.terminationError}</p>}
    {row.depth > 0 && <p className="trace-note">{text.nestedDepth(row.depth)}</p>}
    {(row.kind === 'assistant' || row.kind === 'compaction') && <M3eList className="trace-record-list" aria-label={text.recordContentLabel}>
      {duration}
      <InfoRow icon="data_usage" label={text.tokensLabel} supporting={recordUsageText(row.usage, text, locale)} />
      {row.retries > 0 && (row.attempts?.length
        ? <ExpandRow icon="history" label={text.uncommittedAttemptsLabel} supporting={text.uncommittedAttemptsSupporting(row.retries)} render={() =>
          <ol>{row.attempts?.map((attempt, index) => <li key={attempt.seq}>{attempt.termination
            ? text.attemptFailed(index + 1, terminationLabel(attempt.termination, text), attempt.termination.message)
            : text.attemptNoReason(index + 1)}</li>)}</ol>} />
        : <InfoRow icon="history" label={text.uncommittedAttemptsLabel} supporting={text.uncommittedAttemptsSupporting(row.retries)} />)}
      <ExpandRow key={`input:${row.id}`} icon="input" label={text.inputLabel} supporting={text.recordInputSupporting} lazy render={() => <>
        <p className="trace-note">{text.inputNote}</p>
        <Content content={row.input} face={face} />
      </>} />
      <ExpandRow icon="output" label={text.outputLabel} supporting={recordOutputText(row, text)} render={() => <Content content={row.content} face={face} />} />
    </M3eList>}
    {(row.kind === 'tool' || row.kind === 'subtool') && <M3eList className="trace-record-list" aria-label={text.recordContentLabel}>
      <ExpandRow icon="data_object" label={text.argumentsLabel} supporting={row.arguments ? undefined : text.notRecordedSupporting} initiallyOpen={!!row.arguments}
        render={() => row.arguments ? <Json value={row.arguments} partial={row.partialText} /> : <p>{text.argumentsNotRecorded}</p>} />
      <ExpandRow icon="output" label={text.resultLabel} supporting={recordResultText(row, text)} initiallyOpen
        render={() => row.running ? <p>{text.resultWaitingBody}</p> : <Content content={row.content} face={face} />} />
      {duration}
    </M3eList>}
    {row.kind === 'user' && <><h3>{text.bodyAndAttachments}</h3><Content content={row.content} face={face} /></>}
    <div className="actions"><M3eButton variant="text" onClick={close}>{text.close}</M3eButton></div>
  </article>
}
