import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { bootDsh } from './dsh/boot.ts'
import { initializeInteractions } from './dsh/interactions.ts'
import type { InteractionContext } from './dsh/interactions-store.ts'
import { initializeRouter } from './app/router.ts'

const element = document.getElementById('app')!

const context = import.meta.env.DEV && new URLSearchParams(location.search).has('mock')
  ? import('./dsh/mock/index.ts').then(({ createMockContext }) => createMockContext())
  : bootDsh()

context.then(
  (ctx) => {
    initializeRouter()
    initializeInteractions(ctx as unknown as InteractionContext)
    createRoot(element).render(
      <StrictMode>
        <App ctx={ctx} />
      </StrictMode>,
    )
  },
  (error: unknown) => {
    console.error(error)
    const message = error instanceof Error ? error.message : String(error)
    element.textContent = message.includes('no boot graph')
      ? '起動に失敗しました。このページは DSH の Host が描いたページではありません。開発用の画面は ?mock を付けて開いてください。'
      : '起動に失敗しました。ページを読み直してください。'
  },
)
