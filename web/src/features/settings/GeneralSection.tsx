import { useMessages } from '../../i18n/index.ts'
import { FieldEditor } from './SchemaFields.tsx'
import { generalEntries } from './general.ts'
import { generalMessages } from './messages.ts'
import type { SettingsState, SettingsStore } from './store.ts'

/**
 * The preferences the stock screen keeps under Settings → General. They are
 * saved where the stock screen saves them, so a change made on either screen
 * shows on the other. Nothing is drawn until the Host has described them.
 */
export function GeneralSection({ state, store }: { state: SettingsState; store: SettingsStore }) {
  const text = useMessages(generalMessages)
  const entries = state.phase === 'ready' ? generalEntries(state.namespaces, text) : []
  if (entries.length === 0) return null
  return <section className="settings-section" aria-labelledby="settings-general">
    <h2 id="settings-general">{text.title}</h2>
    <div className="settings-fields">
      {entries.map(entry => <FieldEditor key={entry.id} field={entry.field} display={entry.display} namespace={entry.namespace} state={state} store={store} />)}
    </div>
  </section>
}
