/**
 * Which Web UI this device uses. The choice lives in a first-party cookie so
 * each browser (and each home-screen PWA, which has its own jar) decides for
 * itself; the Host stays unaware of it.
 *
 * A tab that has rendered the M3E UI also leaves a mark in `sessionStorage`
 * (see `TAB_MARK_KEY`). `sessionStorage` is per tab and shared between `/` and
 * `/m3e/` of the same origin, so removing `/m3e/` from the URL keeps that tab
 * on the stock UI without changing the cookie.
 *
 * `planIndexVisit` and `uiChoiceCookie` are also serialized into the inline
 * script the Host taps into the stock index, so they must stay self-contained:
 * no references to anything outside their own bodies.
 */

export type UiChoice = 'm3e' | 'classic'

/** Where the tab mark lives: set when a tab has shown the M3E UI. */
export const TAB_MARK_KEY = 'dsh-webui-m3e:shown'

/** What the stock index should do on load. */
export interface IndexVisitPlan {
  /** Choice to record, from an explicit `?ui=` in the URL. */
  store?: UiChoice
  /** Where to go instead of rendering the stock UI. */
  redirect?: string
}

/**
 * Read this device's choice from `document.cookie`.
 * @param cookie - the cookie header string.
 * @returns `'m3e'` only when chosen explicitly; the stock UI otherwise.
 */
export function readUiChoice(cookie: string): UiChoice {
  return /(?:^|;\s*)dsh-webui=m3e(?:;|$)/.test(cookie) ? 'm3e' : 'classic'
}

/**
 * Mark this tab as one that has shown the M3E UI.
 * @param storage - `sessionStorage`, or undefined when unavailable.
 */
export function markTabShowedM3e(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(TAB_MARK_KEY, '1')
  } catch {
    // Storage can throw in private mode or when it is blocked. The mark only
    // keeps a tab on the stock UI, so failing to write it is harmless.
  }
}

/**
 * Serialize a choice as a `document.cookie` assignment.
 * @param choice - the UI to remember for this device.
 * @returns the cookie string (one year, whole origin, same-site only).
 */
export function uiChoiceCookie(choice: UiChoice): string {
  return `dsh-webui=${choice}; Path=/; Max-Age=31536000; SameSite=Strict`
}

/**
 * Decide what the stock index does for this visit. `?ui=m3e` / `?ui=classic`
 * record a choice (the escape hatch when one UI is broken); otherwise the
 * stored choice applies, unless this tab has shown M3E. Only the stock index
 * paths are ever moved. The tab mark never wins over an explicit `?ui=`, so
 * `?ui=m3e` still switches a tab that has shown M3E.
 * @param location - the page location.
 * @param cookie - `document.cookie`.
 * @param tabShowedM3e - whether this tab already rendered the M3E UI.
 * @returns the plan; empty when the stock UI should load.
 */
export function planIndexVisit(
  location: { pathname: string; search: string; hash: string },
  cookie: string,
  tabShowedM3e = false,
): IndexVisitPlan {
  if (location.pathname !== '/' && location.pathname !== '/index.html') return {}
  const asked = new URLSearchParams(location.search).get('ui')
  const store = asked === 'm3e' || asked === 'classic' ? asked : undefined
  const stored = /(?:^|;\s*)dsh-webui=m3e(?:;|$)/.test(cookie) ? 'm3e' : 'classic'
  const choice = store ?? (tabShowedM3e ? 'classic' : stored)
  return {
    ...(store === undefined ? {} : { store }),
    ...(choice === 'm3e' ? { redirect: `/m3e/${location.hash}` } : {}),
  }
}

/**
 * The inline script the Host taps into every index head. It runs before the
 * stock bundle starts, so a device that chose M3E leaves before the stock UI
 * renders. A tab that has shown M3E stays on the stock UI instead, unless the
 * URL asks for M3E explicitly.
 * @returns classic-script source using the page's `location` and `document`.
 */
export function uiChoiceScript(): string {
  return (
    `(()=>{try{` +
    `let shown=false;` +
    `try{shown=sessionStorage.getItem(${JSON.stringify(TAB_MARK_KEY)})==='1'}catch{}` +
    `const plan=(${planIndexVisit.toString()})(location,document.cookie,shown);` +
    `if(plan.store)document.cookie=(${uiChoiceCookie.toString()})(plan.store);` +
    `if(plan.redirect)location.replace(plan.redirect)` +
    `}catch(error){console.error('webui-m3e: UI choice',error)}})()`
  )
}
