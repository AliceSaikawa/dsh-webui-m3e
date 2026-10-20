import type { Locale } from './locale.ts'
import { createLocaleStore } from './store.ts'

export function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return [...(navigator.languages ?? []), navigator.language].filter((tag): tag is string => typeof tag === 'string' && tag !== '')
}

/** The page's single locale store. */
export const localeStore = createLocaleStore({ languages: browserLanguages() })

/** The page language outside React (start-up, plain functions). */
export function currentLocale(): Locale {
  return localeStore.getSnapshot().active
}
