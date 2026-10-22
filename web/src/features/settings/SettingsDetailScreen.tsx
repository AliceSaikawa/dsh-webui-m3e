import { M3eButton } from '@m3e/react/button'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { navigate } from '../../app/router.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { ProvidersPanel } from './ProvidersPanel.tsx'
import { ModelsPanel } from './ModelsPanel.tsx'
import { SettingsStatus } from './SettingsScreen.tsx'
import { SchemaFields } from './SchemaFields.tsx'
import { settingsSchemaMessages, settingsScreenMessages } from './messages.ts'
import { groupNamespaces, namespaceTitle, schemaFields, settingsPageTitle, settingsPages } from './schema.ts'
import { useSettings } from './use-settings.ts'

export function SettingsDetailScreen({ page }: { page: string }) {
  const { state, store } = useSettings()
  const text = useMessages(settingsScreenMessages)
  const schemaText = useMessages(settingsSchemaMessages)
  const locale = useLocale()
  const definition = settingsPages.find(item => item.id === page)
  if (!definition) return <PageScaffold title={text.title}><div className="settings-content">
    <p>{text.notFound}</p><M3eButton onClick={() => navigate('/settings', { replace: true })}>{text.backToSettings}</M3eButton>
  </div></PageScaffold>
  const namespaces = groupNamespaces(state.namespaces)[definition.id]
  return <PageScaffold title={settingsPageTitle(definition.id, schemaText)}><div className="settings-content">
    <SettingsStatus state={state} reload={store.reload} />
    {definition.id === 'providers' && <ProvidersPanel />}
    {state.phase === 'ready' && namespaces.length === 0 && <p className="muted">{text.noSettings}</p>}
    {definition.id === 'models' && <ModelsPanel namespaces={namespaces} state={state} store={store} />}
    {definition.id !== 'models' && namespaces.map(namespace => <section className="settings-namespace" key={namespace.ns}>
      <h2>{namespaceTitle(namespace.ns, schemaText)}</h2>
      <div className="settings-fields">
        <SchemaFields fields={schemaFields(namespace, state.permissionCatalog, schemaText, locale)} namespace={namespace} state={state} store={store} />
      </div>
    </section>)}
  </div></PageScaffold>
}
