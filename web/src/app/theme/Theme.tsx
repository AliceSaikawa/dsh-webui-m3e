import { useEffect, type ReactNode } from 'react'
import { M3eTheme } from '@m3e/react/theme'
import { argbFromHex, themeFromSourceColor, applyTheme } from '@material/material-color-utilities'
import { useAppearance } from './appearance.ts'

const seed = '#6750A4'
const palette = themeFromSourceColor(argbFromHex(seed))
export function Theme({ children }: { children: ReactNode }) {
  const appearance = useAppearance()
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches)
      applyTheme(palette, { target: document.documentElement, dark })
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [appearance])
  return <M3eTheme color={seed} scheme={appearance === 'system' ? 'auto' : appearance} variant="tonal-spot" motion="expressive" strongFocus>{children}</M3eTheme>
}
