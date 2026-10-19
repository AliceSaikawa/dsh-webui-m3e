import { getAppearance, getThemeColor, type Appearance } from './appearance.ts'
import { applyDocumentTheme, themeMetaColors } from './colors.ts'

// This module runs in the browser and in tests compiled without the DOM lib
// (tsconfig.host.json), so declare the document and media-query shape it uses.
declare const document: {
  documentElement: Parameters<typeof applyDocumentTheme>[0]
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null
}
declare function matchMedia(query: string): { matches: boolean }

function metaThemeColor(media: string) {
  return document.querySelector(`meta[name="theme-color"][media="${media}"]`)
}

/** Keep the browser chrome in step with the screen. A missing tag is left alone. */
export function applyMetaThemeColor(appearance: Appearance, color: string): void {
  const meta = themeMetaColors(color, appearance)
  metaThemeColor('(prefers-color-scheme: light)')?.setAttribute('content', meta.light)
  metaThemeColor('(prefers-color-scheme: dark)')?.setAttribute('content', meta.dark)
}

/** Apply the stored appearance and color before the first paint, so they never flash the default. */
export function applyStoredTheme(): void {
  try {
    const appearance = getAppearance()
    const color = getThemeColor()
    const dark = appearance === 'dark' || (appearance === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    applyDocumentTheme(document.documentElement, dark, color)
    applyMetaThemeColor(appearance, color)
  } catch { /* The React tree applies the same values once it starts. */ }
}
