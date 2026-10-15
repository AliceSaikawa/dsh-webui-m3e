import { LOCALES, SOURCE_LOCALE, type Locale } from './locale.ts'

/**
 * Typed dictionaries (Issue #78). Each feature keeps one or more catalogs in
 * its own `messages.ts`. Japanese is the source; English and Chinese must have
 * exactly the same keys, and a message that takes values is a function with
 * the same parameters in every language. Missing or extra keys fail the type
 * check, and tests/i18n.test.ts checks every `messages.ts` again at run time.
 */

export type Message = string | ((...args: never[]) => string)
export type Messages = { readonly [key: string]: Message }

/** The shape a translation of `J` must have: same keys, strings stay strings, functions keep their parameters. */
export type Translation<J extends Messages> = {
  readonly [K in keyof J]: J[K] extends (...args: infer A) => string ? (...args: A) => string : string
}

/** `T` with no keys other than those of `Shape`; extra keys become `never`. */
type Exact<Shape, T> = T & { readonly [K in Exclude<keyof T, keyof Shape>]: never }

/**
 * `null` marks a language that is not translated yet: the source language is
 * shown instead. It is only allowed while that language is not in
 * DISPLAY_LOCALES (see locale.ts).
 */
export interface Catalog<J extends Messages> {
  readonly ja: J
  readonly en: Translation<J> | null
  readonly zh: Translation<J> | null
}

const catalogs = new WeakSet<object>()

/**
 * Declare a dictionary. Write `en` and `zh` in the same call (or with
 * `satisfies Translation<typeof ja>`) so the type checker compares their keys
 * with Japanese.
 */
export function defineMessages<J extends Messages, E extends Translation<J> | null, Z extends Translation<J> | null>(catalog: {
  readonly ja: J
  readonly en: E extends null ? null : Exact<Translation<J>, E>
  readonly zh: Z extends null ? null : Exact<Translation<J>, Z>
}): Catalog<J> {
  const frozen: Catalog<J> = Object.freeze({ ja: catalog.ja, en: catalog.en as Translation<J> | null, zh: catalog.zh as Translation<J> | null })
  catalogs.add(frozen)
  return frozen
}

export function isCatalog(value: unknown): value is Catalog<Messages> {
  return typeof value === 'object' && value !== null && catalogs.has(value)
}

/** The messages for a language; an untranslated language gets the source language. */
export function messagesOf<J extends Messages>(catalog: Catalog<J>, locale: Locale): Translation<J> {
  // J is itself a Translation<J>; TypeScript cannot see that through the generic mapping.
  return (catalog[locale] ?? catalog[SOURCE_LOCALE]) as Translation<J>
}

export interface CatalogProblem {
  readonly locale: Locale
  /** Keys that Japanese has and the translation lacks. */
  readonly missing: readonly string[]
  /** Keys that the translation has and Japanese lacks. */
  readonly extra: readonly string[]
  /** Keys that are a string in one language and a function in the other. */
  readonly kind: readonly string[]
}

/**
 * Run-time check of one catalog: key sets and string/function kinds per
 * translated language. Untranslated (`null`) languages are reported by
 * `untranslatedLocales`, not here.
 */
export function catalogProblems(catalog: Catalog<Messages>): CatalogProblem[] {
  const source = catalog[SOURCE_LOCALE]
  const sourceKeys = Object.keys(source)
  return LOCALES.filter(locale => locale !== SOURCE_LOCALE).flatMap(locale => {
    const translation = catalog[locale]
    if (translation === null) return []
    const keys = Object.keys(translation)
    const missing = sourceKeys.filter(key => !Object.hasOwn(translation, key))
    const extra = keys.filter(key => !Object.hasOwn(source, key))
    const kind = sourceKeys.filter(key => Object.hasOwn(translation, key)
      && typeof translation[key] !== typeof source[key])
    return missing.length || extra.length || kind.length ? [{ locale, missing, extra, kind }] : []
  })
}

export function untranslatedLocales(catalog: Catalog<Messages>): Locale[] {
  return LOCALES.filter(locale => catalog[locale] === null)
}
