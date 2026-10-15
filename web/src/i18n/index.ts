import { useSyncExternalStore } from 'react'
import type { Connection, DshRemote } from '../dsh/services.ts'
import { messagesOf, type Catalog, type Messages, type Translation } from './catalog.ts'
import { connectLocalePreference } from './dsh.ts'
import type { Locale } from './locale.ts'
import { createLocaleStore, type LocaleSnapshot } from './store.ts'

export { defineMessages, messagesOf, type Catalog, type Messages, type Translation } from './catalog.ts'
export { compareText, formatDateTime, formatNumber, intlLocale } from './format.ts'
export type { Locale } from './locale.ts'
export type { LocaleSnapshot } from './store.ts'

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return [...(navigator.languages ?? []), navigator.language].filter((tag): tag is string => typeof tag === 'string' && tag !== '')
}

/** The page's single locale store. */
export const localeStore = createLocaleStore({ languages: browserLanguages() })

let started = false
/**
 * Follow the browser language and keep `<html lang>` on the page language.
 * Runs before DSH connects so that start-up errors already use it.
 */
export function startLocale(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const apply = () => {
    const { lang } = localeStore.getSnapshot()
    if (document.documentElement.lang !== lang) document.documentElement.lang = lang
  }
  localeStore.subscribe(apply)
  apply()
  window.addEventListener('languagechange', () => localeStore.setLanguages(browserLanguages()))
}

/** Start following DSH's `locale.preference` once the client context exists. */
export function connectDshLocale(ctx: unknown): () => void {
  const root = ctx as { readonly remote?: DshRemote; readonly connection?: Connection } | null
  if (!root?.remote) return () => {}
  return connectLocalePreference({ remote: root.remote, connection: root.connection }, localeStore)
}

/** The page language outside React (start-up, plain functions). */
export function currentLocale(): Locale {
  return localeStore.getSnapshot().active
}

export function useLocaleSnapshot(): LocaleSnapshot {
  return useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot)
}

/** The page language; components re-render when it changes. */
export function useLocale(): Locale {
  return useLocaleSnapshot().active
}

/** A catalog's messages in the page language. */
export function useMessages<J extends Messages>(catalog: Catalog<J>): Translation<J> {
  return messagesOf(catalog, useLocale())
}
