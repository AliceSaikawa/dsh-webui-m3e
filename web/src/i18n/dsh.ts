import type { Connection, ConnectionState, DshRemote, RemoteResult } from '../dsh/services.ts'
import { onRemoteEvent } from '../dsh/remote-events.ts'
import { isLocaleTag } from './locale.ts'

/**
 * Reads DSH's `locale.preference` (Issue #78).
 *
 * DSH 0.2.0-rc.2 stores it in the Host settings namespace `locale`, field
 * `preference` (dsh-client-locale lib/index.js: LOCALE_SETTINGS_NAMESPACE,
 * LOCALE_PREFERENCE_FIELD; its Host plugin calls `settings.configure({ auto:
 * false })`). The settings controller's `describe()` lists every registered
 * namespace (dsh-api-settings-controller lib/index.js `describe`), and
 * dsh-settings emits `settings/document-updated` with the namespace when a
 * document changes. M3E already uses both for its settings tab.
 */
export const LOCALE_NAMESPACE = 'locale'

interface LocaleSettingsRemote { describe(): Promise<RemoteResult<unknown>> }

/**
 * The preference in a `settings.describe()` value. `{ preference: undefined }`
 * means unset (no namespace, no field, or a value DSH would not accept);
 * undefined means the description could not be read and the current choice
 * should stay.
 */
export function localePreferenceOf(description: unknown): { readonly preference: string | undefined } | undefined {
  if (typeof description !== 'object' || description === null) return undefined
  const namespaces = (description as { namespaces?: unknown }).namespaces
  if (!Array.isArray(namespaces)) return undefined
  const row: unknown = namespaces.find(item => typeof item === 'object' && item !== null && (item as { ns?: unknown }).ns === LOCALE_NAMESPACE)
  const value = typeof row === 'object' && row !== null ? (row as { value?: unknown }).value : undefined
  const preference = typeof value === 'object' && value !== null ? (value as { preference?: unknown }).preference : undefined
  return { preference: isLocaleTag(preference) ? preference : undefined }
}

/**
 * Keep the store's preference in step with DSH: read once now, again when the
 * `locale` document changes and after reconnecting. One read runs at a time;
 * requests during a read are folded into one more read. Failures keep the
 * current language and are not reported, since the page works either way.
 * @returns a disposer.
 */
export function connectLocalePreference(
  services: { readonly remote: DshRemote; readonly connection?: Connection },
  store: { setPreference(preference: string | undefined): void },
): () => void {
  const api = services.remote.settings as Partial<LocaleSettingsRemote> | undefined
  if (!api || typeof api.describe !== 'function') return () => {}
  const settings = api as LocaleSettingsRemote
  let active = true
  let reading = false
  let again = false
  const read = async () => {
    if (reading) { again = true; return }
    reading = true
    try {
      do {
        again = false
        let result: RemoteResult<unknown> | undefined
        try { result = await settings.describe() } catch { result = undefined }
        const found = result?.ok ? localePreferenceOf(result.value) : undefined
        if (active && found) store.setPreference(found.preference)
      } while (again && active)
    } finally {
      reading = false
    }
  }
  const offEvent = onRemoteEvent(services.remote, 'settings/document-updated', ns => {
    if (ns === LOCALE_NAMESPACE) void read()
  })
  let previous: ConnectionState = services.connection?.state.getSnapshot()
  const offConnection = services.connection?.state.subscribe(() => {
    const next = services.connection!.state.getSnapshot()
    if (next === 'connected' && previous !== 'connected') void read()
    previous = next
  })
  void read()
  return () => {
    active = false
    offEvent()
    if (typeof offConnection === 'function') offConnection()
  }
}
