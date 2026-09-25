import { useEffect, useLayoutEffect, useRef } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eTabs, M3eTab } from '@m3e/react/tabs'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { ConnectionBanner } from '../../app/shell/ConnectionBanner.tsx'
import { back, navigate } from '../../app/router.ts'
import { useOverlays } from '../../app/overlay/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { useSession } from '../../dsh/session.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { usePendingInteractions, resetDeferred } from '../../dsh/interactions.ts'
import { ChatView } from '../chat/ChatView.tsx'
import { TraceView } from '../trace/TraceView.tsx'
import { Composer } from '../composer/Composer.tsx'
import { presentInteraction } from '../interactions/InteractionSheet.tsx'
import { PendingChip } from '../interactions/PendingChip.tsx'
import { SessionMenuButton } from '../session-tools/SessionMenu.tsx'

export function ConversationScreen({ sessionId, tab = 'chat' }: { sessionId: string; tab?: 'chat' | 'trace' }) {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const { face, snapshot } = useSession(sessionId)
  const pending = usePendingInteractions(sessionId)
  const current = pending.find(item => !item.deferred)
  const overlays = useOverlays()
  const answering = !!current || overlays.some(entry => entry.sessionId === sessionId && entry.interactionKey)
  const contentRef = useRef<HTMLElement>(null)
  const chatTabRef = useRef<HTMLElement | null>(null)
  const traceTabRef = useRef<HTMLElement | null>(null)
  const previousTab = useRef(tab)
  useLayoutEffect(() => {
    const changed = previousTab.current !== tab
    previousTab.current = tab
    if (!changed) return
    const focused = document.activeElement
    const hiddenPanel = contentRef.current?.querySelector<HTMLElement>(':scope > .conversation-panel[hidden]')
    // A hash change can hide the focused content without a tab click. Also cover
    // focus lost when the composer disappears, while leaving overlay focus alone.
    if (focused === document.body || (focused && hiddenPanel?.contains(focused))) {
      const selectedTab = tab === 'chat' ? chatTabRef : traceTabRef
      selectedTab.current?.focus({ preventScroll: true })
    }
  }, [tab])
  useEffect(() => {
    // Selection consumes the unread completion mark, so only this screen opens a session.
    // Missing or failed sessions show the error below instead of attempting an ineffective retry.
    if (!face || face.getSnapshot().removed || face.getSnapshot().openState === 'error') return
    if (sessions.list.getSnapshot().current !== sessionId) sessions.open(sessionId)
  }, [face, sessionId, sessions])
  useEffect(() => { resetDeferred(sessionId) }, [sessionId])
  useEffect(() => {
    if (!current) return
    return presentInteraction(current, { from: 'conversation' })
  }, [current])
  const base = `/s/${encodeURIComponent(sessionId)}`
  return <section className="screen conversation-screen"><header className="top-bar">
    <M3eIconButton aria-label="戻る" onClick={back}><Icon name="arrow_back" /></M3eIconButton>
    <h1>{list.byId[sessionId]?.displayTitle ?? '会話'}</h1><SessionMenuButton sessionId={sessionId} />
  </header><ConnectionBanner />
    <M3eTabs className="conversation-tabs" stretch disableSwipe disablePagination variant="primary" previousPageLabel="前のタブ" nextPageLabel="次のタブ">
      <M3eTab ref={element => { chatTabRef.current = element }} selected={tab === 'chat'} onClick={() => navigate(base, { replace: true })}>チャット</M3eTab>
      <M3eTab ref={element => { traceTabRef.current = element }} selected={tab === 'trace'} onClick={() => navigate(`${base}/trace`, { replace: true })}>トレース</M3eTab>
    </M3eTabs>
    <main ref={contentRef} className="screen-content conversation-content">
      {snapshot.openState === 'error' ? <div className="conversation-panel" data-scroll-area><div className="placeholder"><p role="alert">{remoteErrorMessage(snapshot.openError)}</p><M3eButton onClick={back}>一覧に戻る</M3eButton></div></div>
        : <>
          <div className="conversation-panel" role="tabpanel" aria-label="チャット" hidden={tab !== 'chat'} inert={tab !== 'chat'} data-scroll-area={tab === 'chat' ? true : undefined}>
            <ChatView sessionId={sessionId} active={tab === 'chat'} />
          </div>
          <div className="conversation-panel" role="tabpanel" aria-label="トレース" hidden={tab !== 'trace'} inert={tab !== 'trace'} data-scroll-area={tab === 'trace' ? true : undefined}>
            <TraceView sessionId={sessionId} active={tab === 'trace'} />
          </div>
        </>}
    </main>
    {tab === 'chat' && snapshot.openState !== 'error' && <footer className="conversation-footer"><PendingChip sessionId={sessionId} />{!answering && <Composer target={{ kind: 'session', sessionId }} />}</footer>}
  </section>
}
