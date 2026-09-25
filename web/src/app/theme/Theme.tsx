import { useEffect, type ReactNode } from 'react'
import { M3eTheme } from '@m3e/react/theme'
import { useAppearance } from './appearance.ts'
import { applyDocumentTheme, themeOptions } from './colors.ts'

export function Theme({ children }: { children: ReactNode }) {
  const appearance = useAppearance()
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches)
      applyDocumentTheme(document.documentElement, dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [appearance])
  return <M3eTheme {...themeOptions} scheme={appearance === 'system' ? 'auto' : appearance} motion="expressive" strongFocus>{children}</M3eTheme>
}
