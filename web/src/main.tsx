import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { bootDsh } from './dsh/boot.ts'
import { initializeInteractions } from './dsh/interactions.ts'
import type { InteractionContext } from './dsh/interactions-store.ts'
import { initializeRouter } from './app/router.ts'
import { classifyBootFailure, HOST_BUILD_META, isStaleHostHalf, SUPPORTED_DSH_VERSION } from '../../src/shared/dsh-compat.ts'

const element = document.getElementById('app')!

const mock = import.meta.env.DEV && new URLSearchParams(location.search).has('mock')
const context = mock
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
    // After the plugin is replaced, DSH serves the new page at once but keeps
    // the old Host half until it restarts; that pairing fails to boot.
    const staleHost = kind !== 'not-host' && !mock &&
      isStaleHostHalf(document.querySelector<HTMLMetaElement>(`meta[name="${HOST_BUILD_META}"]`)?.content, import.meta.url)
    element.textContent = kind === 'not-host'
      ? '起動に失敗しました。このページは DSH の Host が描いたページではありません。開発用の画面は ?mock を付けて開いてください。'
      : staleHost
      ? '起動に失敗しました。M3E を入れ替えたあと、DSH がまだ再起動されていない可能性があります。DSH を再起動してから読み直してください。'
      : kind === 'incompatible'
      ? `起動に失敗しました。この DSH の版に M3E の画面が対応していない可能性があります。M3E の画面は DSH ${SUPPORTED_DSH_VERSION} で確かめています。`
      : '起動に失敗しました。ページを読み直してください。'
    // A standalone PWA has no browser reload control. Keep recovery independent
    // of React and custom-element startup so it also works after loading fails.
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = '読み直す'
    retry.style.cssText = 'min-height: 48px; padding: 0 16px; font: inherit'
    retry.addEventListener('click', () => location.reload())
    element.append(document.createElement('br'), retry)
    if (kind === 'not-host') return
    // The stock index honors ?ui=classic, so a broken M3E page never strands the device.
    const back = document.createElement('a')
    back.href = '/?ui=classic'
    back.textContent = '今の画面に戻す'
    element.append(document.createElement('br'), back)
  },
)
