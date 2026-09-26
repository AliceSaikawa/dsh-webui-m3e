import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { openSheet, openFullSheet, type OverlayRender, type SheetOptions } from '../../app/overlay/index.ts'
import { createChatSheetLifetime } from './sheet-lifetime.ts'

function createChatSheets() {
  const lifetime = createChatSheetLifetime()
  const open = (opener: typeof openSheet, render: OverlayRender, options?: SheetOptions) => {
    if (!lifetime.isActive()) return () => {}
    let closeOverlay = () => {}
    const close = lifetime.track(() => closeOverlay())
    closeOverlay = opener(() => <ChatSheetContext.Provider value={scope}>
      {typeof render === 'function' ? render(close) : render}
    </ChatSheetContext.Provider>, options)
    return close
  }
  const scope = { ...lifetime,
    open: (render: OverlayRender, options?: SheetOptions) => open(openSheet, render, options),
    openFull: (render: OverlayRender, options?: SheetOptions) => open(openFullSheet, render, options),
  }
  return scope
}

const ChatSheetContext = createContext<ReturnType<typeof createChatSheets> | null>(null)

/** Kept across chat/trace switches, replaced with the owning conversation. */
export function ChatSheets({ children }: { children: ReactNode }) {
  const [scope] = useState(createChatSheets)
  useLayoutEffect(() => { scope.activate(); return scope.dispose }, [scope])
  return <ChatSheetContext.Provider value={scope}>{children}</ChatSheetContext.Provider>
}

export function useChatSheets() {
  const scope = useContext(ChatSheetContext)
  if (!scope) throw new Error('会話のシートを開けませんでした。')
  return scope
}
