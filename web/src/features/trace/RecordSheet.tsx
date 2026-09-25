import { useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import type { ContentBlock, ImageAttachmentRef, SessionFace, TokenUsage } from '../../dsh/services.ts'
import { useSession } from '../../dsh/session.ts'
import { findTraceRow, formatCount, formatDuration, prettyJson, selectTrace, terminationLabel, type TraceRow } from './model.ts'

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

function Usage({ usage }: { usage: TokenUsage | undefined }) {
  if (!usage) return <p className="muted">トークン数は記録されていません。</p>
  return <dl className="trace-metrics">
    <div><dt>入力（キャッシュを除く）</dt><dd>{formatCount(usage.inputTokens)}</dd></div>
    <div><dt>出力</dt><dd>{formatCount(usage.outputTokens)}</dd></div>
    <div><dt>キャッシュ読み込み</dt><dd>{usage.cacheReadTokens === undefined ? '未記録' : formatCount(usage.cacheReadTokens)}</dd></div>
    <div><dt>キャッシュ書き込み</dt><dd>{usage.cacheWriteTokens === undefined ? '未記録' : formatCount(usage.cacheWriteTokens)}</dd></div>
  </dl>
}

/** Closed input details do not resolve or mount the potentially long history. */
function InputDetails({ row, face }: { row: TraceRow; face: SessionFace | undefined }) {
  const [expanded, setExpanded] = useState(false)
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>入力</summary>
    {expanded && <><p className="trace-note">読み込み済みの入力記録です。未読み込みの履歴や内部の指示は含みません。</p><Content content={row.input} face={face} /></>}
  </details>
}

export function RecordSheet({ sessionId, initialRow, close }: { sessionId: string; initialRow: TraceRow; close: () => void }) {
  const { face, records, stream, snapshot } = useSession(sessionId)
  const row = useMemo(() => findTraceRow(selectTrace(records, stream, snapshot.running), initialRow.id) ?? initialRow,
    [records, stream, snapshot.running, initialRow])
  const counts = { reasoning: 0, text: 0, calls: 0 }
  for (const block of row.content) {
    if (block.type === 'reasoning') counts.reasoning++
    if (block.type === 'text') counts.text++
    if (block.type === 'tool-call') counts.calls++
  }
  return <article className="trace-record">
    <h2>{row.title}{row.turn === null ? '' : `（ターン ${row.turn}）`}</h2>
    {row.termination ? <p className={row.failed ? 'trace-error' : 'muted'} role="status">{terminationLabel(row.termination)}：{row.termination.message}</p>
      : row.failed && <p className="trace-error" role="status">失敗{row.error ? `：${row.error}` : ''}</p>}
    {row.kind !== 'user' && <><h3>所要時間</h3><p>{row.running ? '開始済み・実行中' : formatDuration(row.durationMs)}
      {row.firstOutputMs !== undefined && <><br />最初の出力まで {formatDuration(row.firstOutputMs)}</>}
    </p></>}
    {row.retries > 0 && <p>未確定の試行 {row.retries} 回</p>}
    {!!row.attempts?.length && <details><summary>確定しなかった試行</summary><ol>{row.attempts.map((attempt, index) =>
      <li key={attempt.seq}>試行 {index + 1}：{attempt.termination
        ? `${terminationLabel(attempt.termination)}・${attempt.termination.message}`
        : '終了理由は記録されていません。'}</li>)}</ol></details>}
    {(row.kind === 'assistant' || row.kind === 'compaction') && <>
      <h3>トークン</h3><Usage usage={row.usage} />
      <InputDetails key={row.id} row={row} face={face} />
      <details><summary>出力{row.kind === 'assistant' && <span className="trace-note">思考 {counts.reasoning} ・ テキスト {counts.text} ・ ツール呼び出し {counts.calls}</span>}</summary>
        <Content content={row.content} face={face} />
      </details>
    </>}
    {(row.kind === 'tool' || row.kind === 'subtool') && <>
      {row.depth > 0 && <p className="trace-note">入れ子の深さ：{row.depth}</p>}
      <details open><summary>引数</summary>{row.arguments ? <pre>{prettyJson(row.arguments)}</pre> : <p>引数は記録されていません。</p>}</details>
      <details open><summary>結果</summary>{row.running ? <p>結果を待っています。</p> : <Content content={row.content} face={face} />}</details>
    </>}
    {row.kind === 'user' && <><h3>本文と添付</h3><Content content={row.content} face={face} /></>}
    <div className="actions"><M3eButton variant="text" onClick={close}>閉じる</M3eButton></div>
  </article>
}
