import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { bootDsh } from './dsh/boot.ts'
import { initializeInteractions } from './dsh/interactions.ts'
import type { InteractionContext } from './dsh/interactions-store.ts'
import { initializeRouter } from './app/router.ts'
import { classifyBootFailure, SUPPORTED_DSH_VERSION } from '../../src/shared/dsh-compat.ts'
import { connectDshLocale, currentLocale, messagesOf, startLocale } from './i18n/index.ts'
import { bootMessages } from './app/messages.ts'
import { applyStoredTheme } from './app/theme/index.ts'
import { markTabShowedM3e } from '../../src/shared/ui-choice.ts'

// Mark the tab before any boot work, so even a failed boot marks the tab.
// Reading sessionStorage itself can throw when storage is blocked.
try {
  markTabShowedM3e(globalThis.sessionStorage)
} catch {
  // The mark is optional; boot continues without it.
}

applyStoredTheme()
startLocale()
const element = document.getElementById('app')!

const context = import.meta.env.DEV && new URLSearchParams(location.search).has('mock')
  ? import('./dsh/mock/index.ts').then(({ createMockContext }) => createMockContext())
  : bootDsh()

context.then(
  (ctx) => {
    initializeRouter()
    initializeInteractions(ctx as unknown as InteractionContext)
    connectDshLocale(ctx)
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
    const text = messagesOf(bootMessages, currentLocale())
    element.textContent = kind === 'not-host'
      ? text.notHost
      : kind === 'incompatible'
      ? text.incompatible(SUPPORTED_DSH_VERSION)
      : text.failed
    // A standalone PWA has no browser reload control. Keep recovery independent
    // of React and custom-element startup so it also works after loading fails.
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = text.reload
    retry.style.cssText = 'min-height: 48px; padding: 0 16px; font: inherit'
    retry.addEventListener('click', () => location.reload())
    element.append(document.createElement('br'), retry)
    if (kind === 'not-host') return
    // The stock index honors ?ui=classic, so a broken M3E page never strands the device.
    const back = document.createElement('a')
    back.href = '/?ui=classic'
    back.textContent = text.classic
    element.append(document.createElement('br'), back)
  },
)
