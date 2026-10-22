import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { navigate } from '../../app/router.ts'
import { useAppearance, useThemeColor } from '../../app/theme/index.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { appearanceLabel, confirmClassic, openAppearance, themeColorLabel } from './AppearanceSheet.tsx'
import { useAgentPresetRoster } from './AgentPresetsPage.tsx'
import { presetDisplayText } from './agent-presets.ts'
import { GeneralSection } from './GeneralSection.tsx'
import { agentPresetMessages, appearanceMessages, settingsSchemaMessages, settingsScreenMessages } from './messages.ts'
import { groupNamespaces, pageSummary, settingsPageTitle, settingsPages } from './schema.ts'
import { useSettings } from './use-settings.ts'
import { useProviderSummary } from './use-provider-summary.ts'
import type { SettingsState } from './store.ts'
import manifest from '../../../../package.json'
import './settings.css'

export function SettingsStatus({ state, reload }: { state: SettingsState; reload(): unknown }) {
  const text = useMessages(settingsScreenMessages)
  if (state.phase === 'loading') return <p role="status" className="muted">{text.loadingSettings}</p>
  if (state.error) return <div className="settings-notice"><p role="alert">{state.error}</p><M3eButton onClick={() => { void reload() }}>{text.reload}</M3eButton></div>
  if (!state.writable) return <p className="settings-notice" role="status">{text.notWritable}</p>
  return null
}

export function SettingsScreen() {
  const appearance = useAppearance()
  const color = useThemeColor()
  const { state, store } = useSettings()
  const providers = useProviderSummary()
  const groups = groupNamespaces(state.namespaces)
  const { remote } = useDsh()
  const text = useMessages(settingsScreenMessages)
  const schemaText = useMessages(settingsSchemaMessages)
  const appearanceText = useMessages(appearanceMessages)
  const locale = useLocale()
  const presetText = useMessages(agentPresetMessages)
  const presets = useAgentPresetRoster(remote)
  const modeSummary = presets.state.phase === 'loading' ? presetText.summaryLoading
    : presets.state.phase === 'unavailable' ? presetText.summaryUnavailable
    : presets.state.phase === 'error' ? presetText.summaryError
    : (() => {
        const selected = presets.state.rows.find(row => row.isDefault)
        if (selected) return presetDisplayText(selected, presetText).name
        return presets.state.rows.length === 0 ? presetText.empty : presetText.missingDefault
      })()
  return <TabScaffold title={text.title} tab="settings"><div className="settings-content">
    <section className="settings-section" aria-labelledby="settings-device">
      <h2 id="settings-device">{text.deviceSection}</h2>
      <M3eActionList className="settings-card">
        <M3eListAction onClick={confirmClassic}>
          <span slot="leading"><Icon name="swap_horiz" /></span>{text.classicRow}
          <span slot="supporting-text">{text.classicSupport}</span>
          <span slot="trailing"><Icon name="chevron_right" /></span>
        </M3eListAction>
        <M3eListAction onClick={openAppearance}>
          <span slot="leading"><Icon name="dark_mode" /></span>{appearanceText.appearance}
          <span slot="supporting-text">{text.appearanceSummary(appearanceLabel(appearance, appearanceText), themeColorLabel(color, appearanceText))}</span>
          <span slot="trailing"><Icon name="chevron_right" /></span>
        </M3eListAction>
      </M3eActionList>
    </section>
    <SettingsStatus state={state} reload={store.reload} />
    <GeneralSection state={state} store={store} />
    <section className="settings-section" aria-labelledby="settings-dsh">
      <h2 id="settings-dsh">{text.dshSection}</h2>
      <M3eActionList className="settings-card">
        {settingsPages.filter(page => page.id !== 'other' || groups.other.length > 0).flatMap(page => {
          const row = <M3eListAction key={page.id} onClick={() => navigate(`/settings/${page.id}`)}>
            <span slot="leading"><Icon name={page.icon} /></span>{settingsPageTitle(page.id, schemaText)}
            <span slot="supporting-text">{page.id === 'providers' ? providers : state.phase === 'loading' ? text.loadingShort : state.error ? text.checkFailed : pageSummary(page.id, groups[page.id], state.permissionCatalog, schemaText, locale)}</span>
            <span slot="trailing"><Icon name="chevron_right" /></span>
          </M3eListAction>
          return page.id === 'agent' ? [row, <M3eListAction key="modes" onClick={() => navigate('/settings/modes')}>
            <span slot="leading"><Icon name="tune" /></span>{presetText.title}
            <span slot="supporting-text">{modeSummary}</span>
            <span slot="trailing"><Icon name="chevron_right" /></span>
          </M3eListAction>] : [row]
        })}
        <M3eListAction onClick={() => navigate('/settings/plugins')}>
          <span slot="leading"><Icon name="extension" /></span>{text.pluginRow}
          <span slot="supporting-text">{text.pluginSupport}</span>
          <span slot="trailing"><Icon name="chevron_right" /></span>
        </M3eListAction>
      </M3eActionList>
    </section>
    <p className="settings-version">{text.version(manifest.version)}</p>
  </div></TabScaffold>
}
