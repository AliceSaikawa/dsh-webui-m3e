import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { bootDsh } from './dsh/boot.ts'
import { initializeInteractions } from './dsh/interactions.ts'
import type { InteractionContext } from './dsh/interactions-store.ts'
import { initializeRouter } from './app/router.ts'
import { classifyBootFailure, SUPPORTED_DSH_VERSION } from '../../src/shared/dsh-compat.ts'

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
).catch(
  (error: unknown) => {
    console.error(error)
    const kind = classifyBootFailure(error instanceof Error ? error.message : String(error))
    element.textContent = kind === 'not-host'
      ? '起動に失敗しました。このページは DSH の Host が描いたページではありません。開発用の画面は ?mock を付けて開いてください。'
      : kind === 'incompatible'
      ? `起動に失敗しました。この DSH の版に M3E の画面が対応していない可能性があります。M3E の画面は DSH ${SUPPORTED_DSH_VERSION} で確かめています。`
      : '起動に失敗しました。ページを読み直してください。'
    if (kind === 'not-host') return
    // The stock index honors ?ui=classic, so a broken M3E page never strands the device.
    const back = document.createElement('a')
    back.href = '/?ui=classic'
    back.textContent = '今の画面に戻す'
    element.append(document.createElement('br'), back)
  },
)
