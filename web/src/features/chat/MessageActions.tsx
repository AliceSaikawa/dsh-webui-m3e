import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet, showSnackbar } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useDsh } from '../../dsh/services.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'

function ActionsSheet({ sessionId, text, seq, close }: { sessionId: string; text: string; seq?: number; close: () => void }) {
  const { sessions } = useDsh()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      if (alive.current) { close(); showSnackbar('コピーしました。') }
    } catch { if (alive.current) setError('コピーできませんでした。本文を選択してコピーしてください。') }
  }
  const fork = async () => {
    if (seq === undefined || busy) return
    setBusy(true)
    setError('')
    try {
      const id = await sessions.fork({ sessionId, atSeq: seq })
      if (alive.current) { close(); navigate(`/s/${encodeURIComponent(id)}`) }
    } catch (cause) {
      if (alive.current) { setError(remoteErrorMessage(cause, '会話を分岐できませんでした。')); setBusy(false) }
    }
  }
  return <section className="chat-detail"><h2>メッセージの操作</h2>
    <div className="chat-sheet-actions"><M3eButton disabled={!text || busy} onClick={() => void copy()}><Icon name="content_copy" />コピー</M3eButton>
      <M3eButton disabled={seq === undefined || busy} onClick={() => void fork()}><Icon name="fork_right" />{busy ? '分岐しています…' : 'ここから分岐'}</M3eButton></div>
    {seq === undefined && <p className="muted">送信・生成が確定すると、この位置から分岐できます。</p>}
    {error && <p role="alert">{error}</p>}<div className="actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </section>
}

/** Scrolling cancels the hold. The explicit button also supports keyboard users. */
export function MessageActions({ sessionId, text, seq, children, active }: { sessionId: string; text: string; seq?: number; children: ReactNode; active: boolean }) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const triggered = useRef(false)
  const cancel = () => { if (hold.current) clearTimeout(hold.current.timer); hold.current = null }
  useLayoutEffect(() => { if (!active) cancel(); return cancel }, [active])
  const show = () => { if (active) openSheet(close => <ActionsSheet sessionId={sessionId} text={text} seq={seq} close={close} />, { label: 'メッセージの操作' }) }
  const start = (event: PointerEvent<HTMLDivElement>) => {
    cancel()
    triggered.current = false
    if (!active || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button, a, summary, m3e-icon-button')) return
    hold.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { hold.current = null; triggered.current = true; show() }, 550) }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 10) cancel()
  }
  const contextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!active || (event.target as HTMLElement).closest('button, a, summary, m3e-icon-button')) return
    event.preventDefault(); cancel()
    if (!triggered.current) { triggered.current = true; show() }
  }
  return <div className="chat-message-action" onPointerDown={start} onPointerMove={move} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onContextMenu={contextMenu} onClickCapture={event => { if (triggered.current) { triggered.current = false; event.preventDefault(); event.stopPropagation() } }}>
    {children}<M3eIconButton className="chat-message-menu" aria-label="メッセージの操作" onClick={() => show()}><Icon name="more_horiz" /></M3eIconButton>
  </div>
}
