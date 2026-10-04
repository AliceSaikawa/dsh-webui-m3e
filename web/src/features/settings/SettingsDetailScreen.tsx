import { M3eButton } from '@m3e/react/button'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { navigate } from '../../app/router.ts'
import { ProvidersPanel } from './ProvidersPanel.tsx'
import { ModelsPanel } from './ModelsPanel.tsx'
import { SettingsStatus } from './SettingsScreen.tsx'
import { SchemaFields } from './SchemaFields.tsx'
import { groupNamespaces, namespaceTitle, schemaFields, settingsPages } from './schema.ts'
import { useSettings } from './use-settings.ts'

export function SettingsDetailScreen({ page }: { page: string }) {
  const { state, store } = useSettings()
  const definition = settingsPages.find(item => item.id === page)
  if (!definition) return <PageScaffold title="設定"><div className="settings-content">
    <p>この設定ページは見つかりません。</p><M3eButton onClick={() => navigate('/settings', { replace: true })}>設定に戻る</M3eButton>
  </div></PageScaffold>
  const namespaces = groupNamespaces(state.namespaces)[definition.id]
  return <PageScaffold title={definition.title}><div className="settings-content">
    <SettingsStatus state={state} reload={store.reload} />
    {definition.id === 'providers' && <ProvidersPanel />}
    {state.phase === 'ready' && namespaces.length === 0 && <p className="muted">この DSH に該当する設定項目はありません。</p>}
    {definition.id === 'models' && <ModelsPanel namespaces={namespaces} state={state} store={store} />}
    {definition.id !== 'models' && namespaces.map(namespace => <section className="settings-namespace" key={namespace.ns}>
      <h2>{namespaceTitle(namespace.ns)}</h2>
      <div className="settings-fields" key={`${namespace.ns}:${state.generation[namespace.ns] ?? 0}`}>
        <SchemaFields fields={schemaFields(namespace, state.permissionCatalog)} namespace={namespace} state={state} store={store} />
      </div>
    </section>)}
  </div></PageScaffold>
}
