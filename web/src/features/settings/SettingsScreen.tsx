import { M3eButton } from '@m3e/react/button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { navigate } from '../../app/router.ts'
import { useAppearance } from '../../app/theme/index.ts'
import { appearanceLabels, confirmClassic, openAppearance } from './AppearanceSheet.tsx'
import { groupNamespaces, pageSummary, settingsPages } from './schema.ts'
import { useSettings } from './use-settings.ts'
import { useProviderSummary } from './use-provider-summary.ts'
import type { SettingsState } from './store.ts'
import manifest from '../../../../package.json'
import './settings.css'

export function SettingsStatus({ state, reload }: { state: SettingsState; reload(): unknown }) {
  if (state.phase === 'loading') return <p role="status" className="muted">設定を読み込んでいます…</p>
  if (state.error) return <div className="settings-notice"><p role="alert">{state.error}</p><M3eButton onClick={() => { void reload() }}>再読み込み</M3eButton></div>
  if (!state.writable) return <p className="settings-notice" role="status">この DSH では設定を変更できません</p>
  return null
}

export function SettingsScreen() {
  const appearance = useAppearance()
  const { state, store } = useSettings()
  const providers = useProviderSummary()
  const groups = groupNamespaces(state.namespaces)
  return <TabScaffold title="設定" tab="settings"><div className="settings-content">
    <section className="settings-section" aria-labelledby="settings-device">
      <h2 id="settings-device">この端末</h2>
      <M3eActionList className="settings-card">
        <M3eListAction onClick={confirmClassic}>
          <span slot="leading"><Icon name="swap_horiz" /></span>今の画面に戻す
          <span slot="supporting-text">DSH の標準の画面を使う</span>
          <span slot="trailing"><Icon name="chevron_right" /></span>
        </M3eListAction>
        <M3eListAction onClick={openAppearance}>
          <span slot="leading"><Icon name="dark_mode" /></span>外観
          <span slot="supporting-text">{appearanceLabels[appearance]}</span>
          <span slot="trailing"><Icon name="chevron_right" /></span>
        </M3eListAction>
      </M3eActionList>
    </section>
    <section className="settings-section" aria-labelledby="settings-dsh">
      <h2 id="settings-dsh">DSH の設定</h2>
      <SettingsStatus state={state} reload={store.reload} />
      <M3eActionList className="settings-card">
        {settingsPages.filter(page => page.id !== 'other' || groups.other.length > 0).map(page =>
          <M3eListAction key={page.id} onClick={() => navigate(`/settings/${page.id}`)}>
            <span slot="leading"><Icon name={page.icon} /></span>{page.title}
            <span slot="supporting-text">{page.id === 'providers' ? providers : state.phase === 'loading' ? '読み込み中…' : state.error ? '設定を確認できません' : pageSummary(page.id, groups[page.id])}</span>
            <span slot="trailing"><Icon name="chevron_right" /></span>
          </M3eListAction>)}
      </M3eActionList>
    </section>
    <p className="settings-version">この画面の版：{manifest.version}</p>
  </div></TabScaffold>
}
