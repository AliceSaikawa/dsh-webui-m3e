import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { M3eButton } from '@m3e/react/button'
import { M3eExpandableListItem, M3eList, M3eListItem, type M3eExpandableListItemElement } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import type { ContentBlock, ImageAttachmentRef, SessionFace } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { findTraceRow, formatCount, prettyJson, selectTrace, terminationLabel, type TraceRow } from './model.ts'
import { recordDurationText, recordInputSupporting, recordOutputText, recordResultText, recordUsageText } from './record-summary.ts'

function ImageAttachment({ attachment, face }: { attachment: ImageAttachmentRef; face: SessionFace | undefined }) {
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
      if (!result.ok) { setError('画像を読み込めませんでした。'); return }
      const blob = new Blob([new Uint8Array(result.value.data)], { type: result.value.attachment.mediaType })
      objectUrl.current = URL.createObjectURL(blob)
      setUrl(objectUrl.current)
    } catch { if (alive.current) setError('画像を読み込めませんでした。') }
    finally { if (alive.current) setLoading(false) }
  }
  return <div className="trace-attachment">
    <p>{attachment.name ?? '添付画像'}（{attachment.width} × {attachment.height}、{formatCount(attachment.bytes)} バイト）</p>
    {url ? <img src={url} alt={attachment.name ?? '添付画像'} /> : <M3eButton variant="text" disabled={loading || !face} onClick={() => { void load() }}>{loading ? '読み込み中…' : '画像を表示'}</M3eButton>}
    {error && <p role="alert" className="trace-error">{error}</p>}
  </div>
}

function Content({ content, face }: { content: readonly ContentBlock[]; face: SessionFace | undefined }) {
  if (!content.length) return <p className="muted">本文は記録されていません。</p>
  return <div className="trace-blocks">{content.map((block, index) => {
    switch (block.type) {
      case 'text': return <p className="trace-text" key={index}>{block.text}</p>
      case 'reasoning': return <details key={index}><summary>思考</summary><p className="trace-text">{block.text}</p></details>
      case 'tool-call': return <details key={index}><summary>ツール呼び出し：{block.name}</summary><pre>{prettyJson(block.arguments)}</pre></details>
      case 'tool-result': return <details key={index}><summary>ツールの結果{block.isError ? '・失敗' : ''}</summary><Content content={block.content} face={face} /></details>
      case 'image': return <ImageAttachment key={`${block.attachment.attachmentId}:${index}`} attachment={block.attachment} face={face} />
      case 'file': return <p key={index}>添付ファイル：{block.attachment.name}（{formatCount(block.attachment.bytes)} バイト）</p>
      default: return <p key={index} className="muted">この内容は表示に対応していません。</p>
    }
  })}</div>
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
  const { face, records, stream, snapshot } = useSession(sessionId)
  const row = useMemo(() => findTraceRow(selectTrace(records, stream, snapshot.running), initialRow.id) ?? initialRow,
    [records, stream, snapshot.running, initialRow])
  const duration = <InfoRow icon="timer" label="所要時間" supporting={recordDurationText(row)} />
  return <article className="trace-record">
    <h2>{row.title}{row.turn === null ? '' : `（ターン ${row.turn}）`}</h2>
    {row.termination ? <p className={row.failed ? 'trace-error' : 'muted'} role="status">{terminationLabel(row.termination)}：{row.termination.message}</p>
      : row.failed && <p className="trace-error" role="status">失敗{row.error ? `：${row.error}` : ''}</p>}
    {row.depth > 0 && <p className="trace-note">入れ子の深さ：{row.depth}</p>}
    {(row.kind === 'assistant' || row.kind === 'compaction') && <M3eList className="trace-record-list" aria-label="記録の内容">
      {duration}
      <InfoRow icon="data_usage" label="トークン" supporting={recordUsageText(row.usage)} />
      {row.retries > 0 && (row.attempts?.length
        ? <ExpandRow icon="history" label="確定しなかった試行" supporting={`未確定の試行 ${row.retries} 回`} render={() =>
          <ol>{row.attempts?.map((attempt, index) => <li key={attempt.seq}>試行 {index + 1}：{attempt.termination
            ? `${terminationLabel(attempt.termination)}・${attempt.termination.message}`
            : '終了理由は記録されていません。'}</li>)}</ol>} />
        : <InfoRow icon="history" label="確定しなかった試行" supporting={`未確定の試行 ${row.retries} 回`} />)}
      <ExpandRow key={`input:${row.id}`} icon="input" label="入力" supporting={recordInputSupporting} lazy render={() => <>
        <p className="trace-note">読み込み済みの入力記録です。未読み込みの履歴や内部の指示は含みません。</p>
        <Content content={row.input} face={face} />
      </>} />
      <ExpandRow icon="output" label="出力" supporting={recordOutputText(row)} render={() => <Content content={row.content} face={face} />} />
    </M3eList>}
    {(row.kind === 'tool' || row.kind === 'subtool') && <M3eList className="trace-record-list" aria-label="記録の内容">
      <ExpandRow icon="data_object" label="引数" supporting={row.arguments ? undefined : '記録されていません'} initiallyOpen={!!row.arguments}
        render={() => row.arguments ? <pre>{prettyJson(row.arguments)}</pre> : <p>引数は記録されていません。</p>} />
      <ExpandRow icon="output" label="結果" supporting={recordResultText(row)} initiallyOpen
        render={() => row.running ? <p>結果を待っています。</p> : <Content content={row.content} face={face} />} />
      {duration}
    </M3eList>}
    {row.kind === 'user' && <><h3>本文と添付</h3><Content content={row.content} face={face} /></>}
    <div className="actions"><M3eButton variant="text" onClick={close}>閉じる</M3eButton></div>
  </article>
}
