import { DISPLAY_LOCALES, displayLocale, documentLanguage, isLocaleTag, requestedLocale, type Locale } from './locale.ts'

export interface LocaleSnapshot {
  /** The language the reader asked for (DSH preference, then browser). */
  readonly requested: Locale
  /** The language the page is shown in. Formats and `lang` follow this one. */
  readonly active: Locale
  /** Value for `<html lang>`. */
  readonly lang: string
}

export interface LocaleStoreOptions {
  readonly languages: readonly string[]
  readonly preference?: string
  readonly available?: readonly Locale[]
}

export interface LocaleStore {
  getSnapshot(): LocaleSnapshot
  subscribe(listener: () => void): () => void
  /** DSH `locale.preference`; undefined when it is unset. */
  setPreference(preference: string | undefined): void
  setLanguages(languages: readonly string[]): void
}

/** Holds the inputs and publishes a new snapshot only when the result changes. */
export function createLocaleStore(options: LocaleStoreOptions): LocaleStore {
  const available = options.available ?? DISPLAY_LOCALES
  let preference = isLocaleTag(options.preference) ? options.preference : undefined
  let languages = [...options.languages]
  const listeners = new Set<() => void>()
  const compute = (): LocaleSnapshot => {
    const requested = requestedLocale({ preference, languages })
    const active = displayLocale(requested, available)
    return Object.freeze({ requested, active, lang: documentLanguage(active) })
  }
  let snapshot = compute()
  const update = () => {
    const next = compute()
    if (next.requested === snapshot.requested && next.active === snapshot.active) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setPreference(value) {
      preference = isLocaleTag(value) ? value : undefined
      update()
    },
    setLanguages(value) {
      languages = [...value]
      update()
    },
  }
}
