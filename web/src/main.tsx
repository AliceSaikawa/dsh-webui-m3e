import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { bootDsh } from './dsh/boot.ts'
import { initializeInteractions } from './dsh/interactions.ts'
import type { InteractionContext } from './dsh/interactions-store.ts'
import { initializeRouter } from './app/router.ts'
import { classifyBootFailure, SUPPORTED_DSH_VERSION } from '../../src/shared/dsh-compat.ts'
import { connectDshLocale, currentLocale, FIRST_LOCALE_WAIT_MS, messagesOf, startLocale, waitAtMost } from './i18n/index.ts'
import { bootMessages, errorMessages } from './app/messages.ts'
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
  async (ctx) => {
    initializeRouter()
    initializeInteractions(ctx as unknown as InteractionContext)
    // Paint in DSH's language when it arrives soon; otherwise paint now and switch later.
    await waitAtMost(connectDshLocale(ctx).ready, FIRST_LOCALE_WAIT_MS)
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
    const errors = messagesOf(errorMessages, currentLocale())
    const offline = navigator.onLine === false
    element.textContent = offline
      ? errors.offlineTitle
      : kind === 'not-host'
      ? text.notHost
      : kind === 'incompatible'
      ? text.incompatible(SUPPORTED_DSH_VERSION)
      : text.failed
    if (offline) element.append(document.createElement('br'), errors.offlineMessage)
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
