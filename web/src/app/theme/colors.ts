import { argbFromHex, DynamicScheme, Hct, hexFromArgb, MaterialDynamicColors, themeFromSourceColor, Variant } from '@material/material-color-utilities'

/** Keep the document and the nested M3eTheme on the same inputs. */
export const themeOptions = { color: '#6750A4', variant: 'tonal-spot', contrast: 'standard' } as const
const source = argbFromHex(themeOptions.color)
const palettes = themeFromSourceColor(source).palettes
const colors = new MaterialDynamicColors()
const roles = [...colors.allColors, colors.surfaceVariant(), colors.shadow(), colors.scrim(), colors.surfaceTint()]

export function themeColors(dark: boolean): Readonly<Record<string, string>> {
  // M3e 2.8.2 injects these source palettes into DynamicScheme, rather than using
  // SchemeTonalSpot's default palettes. Preserve that distinction for every role.
  const scheme = new DynamicScheme({
    sourceColorHct: Hct.fromInt(source), variant: Variant.TONAL_SPOT,
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

export function applyDocumentTheme(target: ThemeTarget, dark: boolean): void {
  for (const [name, value] of Object.entries(themeColors(dark))) target.style.setProperty(name, value)
  target.style.colorScheme = dark ? 'dark' : 'light'
}
