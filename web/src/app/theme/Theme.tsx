import { useEffect, type ReactNode } from 'react'
import { M3eTheme } from '@m3e/react/theme'
import { useAppearance, useThemeColor } from './appearance.ts'
import { applyMetaThemeColor } from './apply.ts'
import { applyDocumentTheme, themeOptionsFor } from './colors.ts'

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
