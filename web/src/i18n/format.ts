import type { Locale } from './locale.ts'

/**
 * Date, number and sort formats for the page language. Each function takes the
 * language explicitly so the same code can be checked for every language.
 * Formatters are cached because lists format many rows.
 */

const INTL_LOCALES: Readonly<Record<Locale, string>> = { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN' }

/** The Intl locale used for a page language. */
export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale]
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>()
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>(kind: string, locale: Locale, options: object | undefined, create: () => T): T {
  const key = `${kind}\u0000${locale}\u0000${JSON.stringify(options ?? {})}`
  const existing = cache.get(key)
  if (existing) return existing as T
  const created = create()
  cache.set(key, created)
  return created
}

export function numberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('number', locale, options, () => new Intl.NumberFormat(intlLocale(locale), options))
}

/** A number with the page language's grouping and decimal marks. */
export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, options).format(value)
}

export function dateTimeFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('date', locale, options, () => new Intl.DateTimeFormat(intlLocale(locale), options))
}

/**
 * A date or time in the page language. The caller chooses the fields; an
 * invalid date returns undefined so the caller shows its own "unknown" text.
 */
export function formatDateTime(locale: Locale, value: Date | number, options: Intl.DateTimeFormatOptions): string | undefined {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return dateTimeFormat(locale, options).format(date)
}

export function textCollator(locale: Locale, options?: Intl.CollatorOptions): Intl.Collator {
  return cached('collator', locale, options, () => new Intl.Collator(intlLocale(locale), options))
}

/** Compare two strings for sorting in the page language. */
export function compareText(locale: Locale, left: string, right: string, options?: Intl.CollatorOptions): number {
  return textCollator(locale, options).compare(left, right)
}
