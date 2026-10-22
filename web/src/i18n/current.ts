import { SOURCE_LOCALE, type Locale } from './locale.ts'
import { createLocaleStore } from './store.ts'

export function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return [...(navigator.languages ?? []), navigator.language].filter((tag): tag is string => typeof tag === 'string' && tag !== '')
}

/**
 * The page's single locale store. Outside a page (the unit tests run in Node,
 * whose `navigator` reports the machine's language) there is no reader, so the
 * source language is used and results do not depend on the machine.
 */
export const localeStore = createLocaleStore({ languages: 'document' in globalThis ? browserLanguages() : [SOURCE_LOCALE] })

/** The page language outside React (start-up, plain functions). */
export function currentLocale(): Locale {
  return localeStore.getSnapshot().active
}
