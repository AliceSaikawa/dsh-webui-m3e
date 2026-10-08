import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RetainedScrollPanel } from '../../web/src/app/shell/RetainedScrollPanel.tsx'
import { useChatScroll } from '../../web/src/features/chat/useChatScroll.ts'
import type { SessionFace } from '../../web/src/dsh/services.ts'

// Real DOM + production hook/retained panel, with only pagination controlled by
// the test. Fixed row heights make the identity and pixel assertions independent
// of fonts, network timing and custom-element upgrades.
function Fixture() {
  const [active, setActive] = useState(true)
  const [first, setFirst] = useState(100)
  const [last, setLast] = useState(150)
  const [pending, setPending] = useState(false)
  const [settle, setSettle] = useState<(() => void) | null>(null)
  const face = { loadOlder: () => new Promise<void>(resolve => {
    setPending(true)
    setSettle(() => () => { setFirst(value => value - 20); setPending(false); resolve() })
  }) } as SessionFace
  const scroll = useChatScroll({ face, revision: `${first}:${last}`, active, ready: true,
    loadingOlder: pending, hasMore: true, onLoadError: () => { throw new Error('unexpected load error') } })
  return <>
    <button onClick={() => setActive(value => !value)}>表示切替</button>
    <button onClick={() => setFirst(value => value - 20)}>別タブで先頭追加</button>
    <button onClick={() => { void scroll.loadOlder() }}>読込開始</button>
    <button disabled={!settle} onClick={() => { settle?.(); setSettle(null) }}>読込完了</button>
    <button onClick={() => setLast(value => value + 1)}>末尾追加</button>
    <button onClick={scroll.toLatest}>最新へ</button>
    <output>{pending ? '読込中' : '待機'}</output>
    <RetainedScrollPanel active={active} label="チャット">
      <div ref={scroll.viewport} className="chat-scroll" data-scroll-area onScroll={scroll.onScroll}
        onWheel={event => { if (event.deltaY < 0) scroll.stopFollowing() }}
        style={{ height: 300, overflow: 'auto', overflowAnchor: 'none' }}>
        <div ref={scroll.content}>{Array.from({ length: last - first }, (_, index) => first + index).map(key =>
          <div key={key} data-chat-key={String(key)} style={{ height: 100 }}>記録 {key}</div>)}</div>
      </div>
    </RetainedScrollPanel>
  </>
}
createRoot(document.getElementById('app')!).render(<StrictMode><Fixture /></StrictMode>)
