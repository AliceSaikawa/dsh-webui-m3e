/**
 * On-device measurement panel for checks on real phones (#98). Opening the
 * page with `?diag` turns it on and remembers that in localStorage, so a home
 * screen launch (start_url /m3e/ has no query) keeps showing it. `?diag=0` or
 * the panel's close button turns it off. Nothing here runs unless it is on.
 *
 * This file holds the pure parts; diagnostics-panel.ts reads the DOM.
 */

export const diagnosticsStorageKey = 'dsh-m3e-diagnostics'

/** What the query asks for: `?diag`/`?diag=1` → on, `?diag=0` → off, otherwise nothing. */
export function diagnosticsRequest(search: string): 'on' | 'off' | undefined {
  const params = new URLSearchParams(search)
  if (!params.has('diag')) return undefined
  const value = params.get('diag')
  return value === '0' || value === 'false' || value === 'off' ? 'off' : 'on'
}

/** Whether to show the panel, given the query and the remembered choice. */
export function diagnosticsEnabled(search: string, stored: string | null | undefined): boolean {
  const request = diagnosticsRequest(search)
  return request ? request === 'on' : stored === '1'
}

export interface FrameStats { fps: number; worst: number }

/**
 * Frame rate and longest gap from requestAnimationFrame times (ms, ascending)
 * within the last `window` ms. Undefined until there are two frames.
 */
export function frameStats(times: readonly number[], window = 1000): FrameStats | undefined {
  if (times.length < 2) return undefined
  const end = times[times.length - 1]!
  const recent = times.filter(time => time >= end - window)
  if (recent.length < 2) return undefined
  const span = recent[recent.length - 1]! - recent[0]!
  if (span <= 0) return undefined
  let worst = 0
  for (let index = 1; index < recent.length; index += 1) worst = Math.max(worst, recent[index]! - recent[index - 1]!)
  return { fps: ((recent.length - 1) * 1000) / span, worst }
}

/** Keep the newest `limit` entries. */
export function pushEvent(log: readonly string[], entry: string, limit = 10): string[] {
  return [...log, entry].slice(-limit)
}

export interface DiagnosticsSnapshot {
  build: string
  userAgent: string
  displayMode: string
  orientation: string
  dpr: number
  screen: { width: number; height: number; availWidth: number; availHeight: number }
  layout: { innerWidth: number; innerHeight: number; clientWidth: number; clientHeight: number }
  visual?: { width: number; height: number; offsetTop: number; offsetLeft: number; pageTop: number; scale: number }
  units: { dvh: number; svh: number; lvh: number }
  safeArea: { top: number; right: number; bottom: number; left: number }
  app?: { top: number; height: number }
  bottomBar?: number
  focus?: string
  frames?: FrameStats
  events: readonly string[]
}

export interface DiagnosticsLabels {
  title: string
  screen: string
  orientation: string
  displayMode: string
  keyboard: string
  appArea: string
  top: string
  height: string
  bottomBar: string
  visualBottom: string
  focus: string
  none: string
  frames: string
  worstFrame: string
  events: string
}

const px = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

/**
 * Space between the bottom of the visual viewport and the bottom of the
 * layout viewport. With a software keyboard open in a browser that shrinks
 * only the visual viewport this is about the keyboard height.
 */
export function keyboardEstimate(snapshot: Pick<DiagnosticsSnapshot, 'layout' | 'visual'>): number | undefined {
  const { visual, layout } = snapshot
  if (!visual) return undefined
  return Math.max(0, layout.innerHeight - visual.offsetTop - visual.height)
}

/** Plain text for the panel and the clipboard. */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot, text: DiagnosticsLabels): string {
  const { screen, layout, visual, units, safeArea } = snapshot
  const keyboard = keyboardEstimate(snapshot)
  const lines = [
    `${text.title}  ${snapshot.build}`,
    `${text.screen} ${screen.width}×${screen.height} (avail ${screen.availWidth}×${screen.availHeight})  DPR ${snapshot.dpr.toFixed(2)}`,
    `${text.orientation} ${snapshot.orientation}  ${text.displayMode} ${snapshot.displayMode}`,
    `inner ${layout.innerWidth}×${layout.innerHeight}  client ${layout.clientWidth}×${layout.clientHeight}`,
    visual
      ? `visual ${px(visual.width)}×${px(visual.height)}  offset ${px(visual.offsetLeft)},${px(visual.offsetTop)}  pageTop ${px(visual.pageTop)}  scale ${visual.scale.toFixed(2)}`
      : 'visual -',
    `dvh ${px(units.dvh)}  svh ${px(units.svh)}  lvh ${px(units.lvh)}`,
    `safe-area ${px(safeArea.top)} ${px(safeArea.right)} ${px(safeArea.bottom)} ${px(safeArea.left)} (top right bottom left)`,
    `${text.keyboard} ${keyboard === undefined ? '-' : px(keyboard)}`,
    snapshot.app ? `${text.appArea} ${text.top} ${px(snapshot.app.top)} ${text.height} ${px(snapshot.app.height)}` : `${text.appArea} -`,
    `${text.bottomBar} ${snapshot.bottomBar === undefined ? '-' : px(snapshot.bottomBar)}  ${text.visualBottom} ${visual ? px(visual.offsetTop + visual.height) : '-'}`,
    `${text.focus} ${snapshot.focus ?? text.none}`,
    snapshot.frames ? `${text.frames} ${snapshot.frames.fps.toFixed(0)} fps  ${text.worstFrame} ${snapshot.frames.worst.toFixed(1)} ms` : `${text.frames} -`,
    `UA ${snapshot.userAgent}`,
  ]
  if (snapshot.events.length) lines.push(`${text.events}:`, ...snapshot.events)
  return lines.join('\n')
}
