import { argbFromHex, DynamicScheme, Hct, hexFromArgb, MaterialDynamicColors, themeFromSourceColor, Variant } from '@material/material-color-utilities'

/** Keep the document and the nested M3eTheme on the same inputs. */
export const themeOptions = { color: '#6750A4', variant: 'tonal-spot', contrast: 'standard' } as const

export function themeOptionsFor(color: string) {
  return { ...themeOptions, color }
}

const colors = new MaterialDynamicColors()
const roles = [...colors.allColors, colors.surfaceVariant(), colors.shadow(), colors.scrim(), colors.surfaceTint()]
const palettesByColor = new Map<string, ReturnType<typeof themeFromSourceColor>['palettes']>()
function palettesFor(color: string) {
  const key = color.toLowerCase()
  const cached = palettesByColor.get(key)
  if (cached) return cached
  const palettes = themeFromSourceColor(argbFromHex(color)).palettes
  palettesByColor.set(key, palettes)
  return palettes
}

export function themeColors(dark: boolean, color: string = themeOptions.color): Readonly<Record<string, string>> {
  // M3e 2.8.2 injects these source palettes into DynamicScheme, rather than using
  // SchemeTonalSpot's default palettes. Preserve that distinction for every role.
  const palettes = palettesFor(color)
  const scheme = new DynamicScheme({
    sourceColorHct: Hct.fromInt(argbFromHex(color)), variant: Variant.TONAL_SPOT,
    contrastLevel: 0, isDark: dark, specVersion: '2021', platform: 'phone',
    primaryPalette: palettes.primary, secondaryPalette: palettes.secondary,
    tertiaryPalette: palettes.tertiary, neutralPalette: palettes.neutral,
    neutralVariantPalette: palettes.neutralVariant, errorPalette: palettes.error,
  })
  return Object.fromEntries(roles.map((role) => [
    `--md-sys-color-${role.name.replace(/_/g, '-').toLowerCase()}`,
    hexFromArgb(role.getArgb(scheme)),
  ]))
}

interface ThemeTarget {
  readonly style: { colorScheme: string; setProperty(name: string, value: string): void }
}

export function applyDocumentTheme(target: ThemeTarget, dark: boolean, color: string = themeOptions.color): void {
  for (const [name, value] of Object.entries(themeColors(dark, color))) target.style.setProperty(name, value)
  target.style.colorScheme = dark ? 'dark' : 'light'
}

/** The `theme-color` for each media query: an explicit appearance follows the app, not the OS. */
export function themeMetaColors(color: string, appearance: 'system' | 'light' | 'dark'): { light: string; dark: string } {
  const light = themeColors(false, color)['--md-sys-color-surface']!
  const dark = themeColors(true, color)['--md-sys-color-surface']!
  const scheme = appearance === 'light' ? light : appearance === 'dark' ? dark : undefined
  return scheme === undefined ? { light, dark } : { light: scheme, dark: scheme }
}
