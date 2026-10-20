import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { showSnackbar } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { useMessages } from '../../i18n/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useChatSheets } from './ChatSheets.tsx'
import { messageForkOperation, type ForkState } from './fork-operation.ts'
import { beginChatLongPress } from './long-press.ts'
import { chatActionMessages } from './messages.ts'
import { TextSelectSheet } from './TextSelectSheet.tsx'
import { createMessageTextSource, type MessageBody, type MessageTextSource } from './text-selection.ts'

const noSubscription = () => () => {}
const idle: ForkState = { status: 'idle' }
const idleSnapshot = () => idle

function ActionsSheet({ sessionId, source, body, seq, close }: {
  sessionId: string
  source: MessageTextSource
  body: MessageBody
  seq?: number
  close: () => void
}) {
  const messages = useMessages(chatActionMessages)
  const { sessions } = useDsh()
  const sheets = useChatSheets()
  const operation = seq === undefined ? undefined : messageForkOperation(sessions, sessionId, seq)
  const state = useSyncExternalStore(operation?.subscribe ?? noSubscription, operation?.getSnapshot ?? idleSnapshot, idleSnapshot)
  const busy = state.status === 'pending'
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    // This runs again when an approval uncovers the sheet. Completion remains
    // in the operation while this component is absent; navigation is claimed once.
    if (!sheets.isActive()) return
    const id = operation?.claimNavigation()
    if (id) { close(); navigate(`/s/${encodeURIComponent(id)}`) }
  }, [state, operation, close, sheets])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source.getSnapshot().text)
      if (alive.current) { close(); showSnackbar(messages.copied) }
    } catch { if (alive.current) setError(messages.copyFailed) }
  }
  const selectText = () => {
    if (!sheets.isActive()) return
    // Snapshot so a later stream chunk cannot rewrite the text under the selection.
    const snapshot = source.getSnapshot()
    close()
    sheets.openFull(closeSelect => <TextSelectSheet state={snapshot} body={body} close={closeSelect} />, { label: messages.selectTitle })
  }
  const fork = () => {
    if (!sheets.isActive() || !operation) return
    setError('')
    void operation.start()
  }
  const text = source.getSnapshot().text
  return <section className="chat-detail"><h2>{messages.actionsTitle}</h2>
    <div className="chat-sheet-actions"><M3eButton disabled={!text || busy} onClick={() => void copy()}><Icon name="content_copy" />{messages.copy}</M3eButton>
      <M3eButton disabled={!text || busy} onClick={selectText}><Icon name="text_select_start" />{messages.selectText}</M3eButton>
      <M3eButton disabled={seq === undefined || busy || state.status === 'success'} onClick={fork}><Icon name="call_split" />{busy ? messages.forking : messages.fork}</M3eButton></div>
    {seq === undefined && <p className="muted">{messages.forkPending}</p>}
    {state.status === 'success' && <div role="status"><p>{messages.forkCreated}</p><M3eButton onClick={() => { close(); navigate(`/s/${encodeURIComponent(state.sessionId)}`) }}>{messages.openFork}</M3eButton></div>}
    {state.status === 'error' && <p role="alert">{state.message}</p>}
    {error && <p role="alert">{error}</p>}<div className="actions"><M3eButton onClick={close}>{messages.close}</M3eButton></div>
  </section>
}

/** Message operations open only after a hold; scrolling cancels the hold. */
export function MessageActions({ sessionId, text, seq, children, active, body, streaming = false }: {
  sessionId: string
  text: string
  seq?: number
  children: ReactNode
  active: boolean
  body: MessageBody
  streaming?: boolean
}) {
  const messages = useMessages(chatActionMessages)
  const sheets = useChatSheets()
  const [source] = useState(() => createMessageTextSource({ text, streaming }))
  useLayoutEffect(() => { source.set({ text, streaming }) }, [source, text, streaming])
  const hold = useRef<{ press: ReturnType<typeof beginChatLongPress>; x: number; y: number; pointerId: number } | null>(null)
  const cancel = () => { hold.current?.press.cancel(); hold.current = null }
  const finish = () => { hold.current?.press.finish(); hold.current = null }
  useLayoutEffect(() => { if (!active) cancel(); return cancel }, [active])
  const show = () => {
    if (active) sheets.open(close => <ActionsSheet sessionId={sessionId} source={source} body={body} seq={seq} close={close} />, { label: messages.actionsTitle })
  }
  const start = (event: PointerEvent<HTMLDivElement>) => {
    cancel()
    if (!active || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button, a, summary, m3e-icon-button')) return
    hold.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      press: beginChatLongPress(document, event.pointerId, show) }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (hold.current?.pointerId !== event.pointerId) return
    hold.current.press.move(event.clientX - hold.current.x, event.clientY - hold.current.y)
  }
  const leave = () => { if (hold.current?.press.didFire()) finish(); else cancel() }
  return <div className="chat-message-action" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onPointerLeave={leave}
    onContextMenu={event => event.preventDefault()}>
    {children}
  </div>
}
