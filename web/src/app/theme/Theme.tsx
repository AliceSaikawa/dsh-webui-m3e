import { useEffect, type ReactNode } from 'react'
import { M3eTheme } from '@m3e/react/theme'
import { getAppearance, getThemeColor, useAppearance, useThemeColor, type Appearance } from './appearance.ts'
import { applyDocumentTheme, themeMetaColors, themeOptionsFor } from './colors.ts'

function metaThemeColor(media: string): Element | null {
  return document.querySelector(`meta[name="theme-color"][media="${media}"]`)
}

/** Keep the browser chrome in step with the screen. A missing tag is left alone. */
function applyMetaThemeColor(appearance: Appearance, color: string): void {
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

export function Theme({ children }: { children: ReactNode }) {
  const appearance = useAppearance()
  const color = useThemeColor()
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches)
      applyDocumentTheme(document.documentElement, dark, color)
      applyMetaThemeColor(appearance, color)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [appearance, color])
  return <M3eTheme {...themeOptionsFor(color)} scheme={appearance === 'system' ? 'auto' : appearance} motion="expressive" strongFocus>{children}</M3eTheme>
}
