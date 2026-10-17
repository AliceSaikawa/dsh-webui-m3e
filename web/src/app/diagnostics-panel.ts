import { currentLocale, messagesOf } from '../i18n/index.ts'
import { diagnosticsMessages } from './messages.ts'
import {
  diagnosticsEnabled, diagnosticsRequest, diagnosticsStorageKey, formatDiagnostics, frameStats, pushEvent,
  type DiagnosticsSnapshot,
} from './diagnostics.ts'

/**
 * The ?diag panel (#98). Plain DOM without React, started before DSH boots, so
 * it also shows values on the start-up failure screen. The panel lets touches
 * through except on its own buttons, and it is a manual popover that moves
 * back on top whenever a sheet or dialog enters the top layer.
 */

function storage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
}

/** Start the panel when ?diag asks for it or it was left on. */
export function startDiagnosticsIfRequested(): void {
  const store = storage()
  const request = diagnosticsRequest(location.search)
  try {
    if (request === 'on') store?.setItem(diagnosticsStorageKey, '1')
    if (request === 'off') store?.removeItem(diagnosticsStorageKey)
  } catch { /* Storage can be disabled; the query still applies to this load. */ }
  if (!diagnosticsEnabled(location.search, store?.getItem(diagnosticsStorageKey))) return
  if (document.body) startDiagnostics()
  else document.addEventListener('DOMContentLoaded', () => startDiagnostics(), { once: true })
}

const probeStyle = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;'

function makeProbe(css: string): HTMLDivElement {
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = probeStyle + css
  document.body.append(probe)
  return probe
}

function describeElement(element: Element | null): string | undefined {
  if (!element || element === document.body || element === document.documentElement) return undefined
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const name = element.getAttribute('aria-label') ?? element.getAttribute('name')
  return `${tag}${id}${name ? ` "${name.slice(0, 24)}"` : ''}`
}

function displayMode(): string {
  for (const mode of ['fullscreen', 'standalone', 'minimal-ui', 'browser']) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode
  }
  return '-'
}

const buttonStyle = 'pointer-events:auto;min-height:36px;padding:0 10px;border:1px solid rgb(255 255 255 / 0.5);border-radius:18px;background:rgb(0 0 0 / 0.4);color:inherit;font:inherit;'

export function startDiagnostics(): () => void {
  const text = messagesOf(diagnosticsMessages, currentLocale())
  const started = performance.now()
  const build = new URL(import.meta.url).pathname.split('/').pop() ?? '-'
  let events: string[] = []
  let frames: number[] = []
  let atBottom = false
  let collapsed = false
  let stopped = false

  const safeProbe = makeProbe('height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);')
  const dvhProbe = makeProbe('height:100dvh;')
  const svhProbe = makeProbe('height:100svh;')
  const lvhProbe = makeProbe('height:100lvh;')

  const panel = document.createElement('div')
  panel.dataset.m3eDiagnostics = ''
  const popover = typeof panel.showPopover === 'function'
  if (popover) panel.popover = 'manual'
  const output = document.createElement('pre')
  output.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;'
  const controls = document.createElement('div')
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;'
  const makeButton = (label: string, onClick: () => void) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText = buttonStyle
    button.addEventListener('click', onClick)
    controls.append(button)
    return button
  }
  panel.append(output, controls)
  // A modal sheet closes on any document click outside itself; a tap on the
  // panel's buttons must not close the sheet being measured.
  for (const type of ['click', 'pointerdown']) panel.addEventListener(type, event => event.stopPropagation())

  const place = () => {
    // Inline styles override the UA's [popover] centering and border.
    panel.style.cssText = [
      'position:fixed', 'inset:auto', 'margin:0', 'border:0', 'box-sizing:border-box',
      'left:calc(env(safe-area-inset-left) + 4px)', 'right:calc(env(safe-area-inset-right) + 4px)', 'width:auto',
      atBottom ? 'bottom:calc(env(safe-area-inset-bottom) + 4px)' : 'top:calc(env(safe-area-inset-top) + 4px)',
      `max-height:${collapsed ? '76px' : '55vh'}`, 'overflow:hidden', 'padding:6px 8px', 'border-radius:8px',
      'background:rgb(0 0 0 / 0.72)', 'color:#fff', 'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
      'pointer-events:none', 'z-index:2147483647', 'text-align:start',
    ].join(';')
  }

  const log = (entry: string) => {
    events = pushEvent(events, `+${Math.round(performance.now() - started)}ms ${entry}`)
  }

  const snapshot = (): DiagnosticsSnapshot => {
    const visual = window.visualViewport
    const safe = getComputedStyle(safeProbe)
    const app = document.querySelector('.app-viewport')?.getBoundingClientRect()
    const bars = [...document.querySelectorAll('.bottom-navigation, .conversation-footer, .page-footer')]
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.height > 0)
    return {
      build,
      userAgent: navigator.userAgent,
      displayMode: displayMode(),
      orientation: screen.orientation?.type ?? '-',
      dpr: window.devicePixelRatio,
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
      layout: {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
      },
      visual: visual ? {
        width: visual.width, height: visual.height, offsetTop: visual.offsetTop, offsetLeft: visual.offsetLeft,
        pageTop: visual.pageTop, scale: visual.scale,
      } : undefined,
      units: {
        dvh: dvhProbe.getBoundingClientRect().height,
        svh: svhProbe.getBoundingClientRect().height,
        lvh: lvhProbe.getBoundingClientRect().height,
      },
      safeArea: {
        top: parseFloat(safe.paddingTop) || 0, right: parseFloat(safe.paddingRight) || 0,
        bottom: parseFloat(safe.paddingBottom) || 0, left: parseFloat(safe.paddingLeft) || 0,
      },
      app: app ? { top: app.top, height: app.height } : undefined,
      bottomBar: bars.length ? Math.max(...bars.map(rect => rect.bottom)) : undefined,
      focus: describeElement(document.activeElement),
      frames: frameStats(frames),
      events,
    }
  }

  let lastText = ''
  const render = () => {
    const next = formatDiagnostics(snapshot(), text)
    if (next !== lastText) { output.textContent = next; lastText = next }
  }

  makeButton(text.move, () => { atBottom = !atBottom; place() })
  const collapseButton = makeButton(text.collapse, () => {
    collapsed = !collapsed
    collapseButton.textContent = collapsed ? text.expand : text.collapse
    place()
  })
  const copyButton = makeButton(text.copy, () => {
    const reset = () => setTimeout(() => { copyButton.textContent = text.copy }, 1500)
    const value = formatDiagnostics(snapshot(), text)
    const write = navigator.clipboard?.writeText(value)
    if (!write) { copyButton.textContent = text.copyFailed; reset(); return }
    write.then(() => { copyButton.textContent = text.copied }, () => { copyButton.textContent = text.copyFailed }).finally(reset)
  })

  const raise = () => {
    if (!popover || stopped || !panel.isConnected) return
    try {
      if (panel.matches(':popover-open')) panel.hidePopover()
      panel.showPopover()
    } catch { /* A popover that cannot be shown stays a fixed element. */ }
  }

  // A modal M3E sheet makes every other body child inert (InertController in
  // @m3e/web/core) and gives it back on close. Keep the panel's buttons usable
  // while a sheet is open; unlock only sets inert back to false.
  const inertObserver = new MutationObserver(() => { if (panel.inert) panel.inert = false })
  inertObserver.observe(panel, { attributes: true, attributeFilter: ['inert'] })

  const listeners: Array<[EventTarget, string, EventListener, boolean]> = []
  const on = (target: EventTarget | null | undefined, type: string, listener: EventListener, capture = false) => {
    if (!target) return
    target.addEventListener(type, listener, capture)
    listeners.push([target, type, listener, capture])
  }
  const visual = window.visualViewport
  on(visual, 'resize', () => log(`visualViewport.resize ${Math.round(visual!.width)}×${Math.round(visual!.height)} top ${Math.round(visual!.offsetTop)}`))
  on(window, 'resize', () => log(`window.resize ${window.innerWidth}×${window.innerHeight}`))
  on(screen.orientation, 'change', () => log(`orientation ${screen.orientation.type}`))
  on(window, 'popstate', () => log(`popstate ${location.hash || location.pathname}`))
  on(window, 'hashchange', () => log(`hashchange ${location.hash}`))
  on(window, 'pageshow', event => log(`pageshow persisted=${(event as PageTransitionEvent).persisted}`))
  on(window, 'pagehide', () => log('pagehide'))
  on(document, 'visibilitychange', () => log(`visibility ${document.visibilityState}`))
  on(document, 'focusin', event => log(`focusin ${describeElement(event.target as Element) ?? '-'}`))
  on(document, 'toggle', event => {
    if (event.target === panel) return
    const state = (event as ToggleEvent).newState
    log(`toggle ${describeElement(event.target as Element) ?? '-'} ${state}`)
    if (state === 'open') queueMicrotask(raise)
  }, true)

  let frame = 0
  let lastRender = 0
  const tick = (time: number) => {
    if (stopped) return
    frames.push(time)
    if (frames.length > 400) frames = frames.slice(-300)
    if (time - lastRender >= 250) { lastRender = time; render() }
    frame = requestAnimationFrame(tick)
  }

  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    inertObserver.disconnect()
    for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture)
    panel.remove()
    for (const probe of [safeProbe, dvhProbe, svhProbe, lvhProbe]) probe.remove()
  }
  makeButton(text.close, () => {
    try { storage()?.removeItem(diagnosticsStorageKey) } catch { /* Storage can be disabled. */ }
    stop()
  })

  place()
  document.body.append(panel)
  raise()
  render()
  frame = requestAnimationFrame(tick)
  return stop
}
