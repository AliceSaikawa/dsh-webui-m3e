/**
 * Which language the M3E page uses (Issue #78, docs/design/11-i18n.md).
 *
 * Japanese is the source language. English and Simplified Chinese follow it.
 * The language comes from DSH's `locale.preference` and, when that is unset,
 * from the browser. Anything else, Traditional Chinese included, is English.
 */

/** Languages that have (or will have) a dictionary. */
export const LOCALES = ['ja', 'en', 'zh'] as const
export type Locale = typeof LOCALES[number]

/** The language every dictionary is written in first. */
export const SOURCE_LOCALE = 'ja' satisfies Locale
/** Used for languages M3E does not support. */
export const FALLBACK_LOCALE = 'en' satisfies Locale

/**
 * Languages whose translations are complete enough to switch the whole page.
 * Until the translation PRs land, an English or Chinese reader would get a page
 * that is still written in Japanese, so the page language, `lang` and formats
 * stay Japanese for them as well. Add a language here only when every
 * dictionary has it (tests/i18n.test.ts enforces this).
 */
export const DISPLAY_LOCALES: readonly Locale[] = ['ja']

/** Same shape DSH accepts for `locale.preference` (dsh-client-locale LOCALE_ID_PATTERN). */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
/** Traditional Chinese regions: unsupported, so they become English. */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo'])

export function isLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && LOCALE_TAG.test(value)
}

/**
 * The supported language a BCP 47 tag asks for, or undefined.
 * zh, zh-CN, zh-Hans and zh-SG are Simplified Chinese; zh-Hant, zh-TW, zh-HK
 * and zh-MO are Traditional Chinese, which M3E does not support.
 */
export function matchLocale(tag: string): Locale | undefined {
  const parts = tag.trim().replaceAll('_', '-').toLowerCase().split('-')
  const primary = parts[0]
  if (primary === 'ja' || primary === 'en') return primary
  if (primary !== 'zh') return undefined
  const rest = parts.slice(1)
  const script = rest.find(part => part.length === 4 && /^[a-z]{4}$/u.test(part))
  if (script === 'hant') return undefined
  if (script === 'hans') return 'zh'
  if (script !== undefined) return undefined
  const region = rest.find(part => /^(?:[a-z]{2}|\d{3})$/u.test(part))
  return region !== undefined && TRADITIONAL_REGIONS.has(region) ? undefined : 'zh'
}

export interface LocaleInputs {
  /** DSH `locale.preference`; undefined when unset or unknown. */
  readonly preference?: string
  /** Browser languages in preference order (navigator.languages, then navigator.language). */
  readonly languages: readonly string[]
}

/**
 * The language the reader asked for. An explicit DSH preference wins, even
 * when M3E does not support it (then English). Without one, the first browser
 * language M3E supports is used; without any, English.
 */
export function requestedLocale({ preference, languages }: LocaleInputs): Locale {
  if (isLocaleTag(preference)) return matchLocale(preference) ?? FALLBACK_LOCALE
  for (const tag of languages) {
    const locale = typeof tag === 'string' ? matchLocale(tag) : undefined
    if (locale !== undefined) return locale
  }
  return FALLBACK_LOCALE
}

/** The language the page is actually shown in; untranslated languages show the source language. */
export function displayLocale(requested: Locale, available: readonly Locale[] = DISPLAY_LOCALES): Locale {
  return available.includes(requested) ? requested : SOURCE_LOCALE
}

/** Value for `<html lang>`. Chinese is written like DSH's standard page does. */
export function documentLanguage(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : locale
}
