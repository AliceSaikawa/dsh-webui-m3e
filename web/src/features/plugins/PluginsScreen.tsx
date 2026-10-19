import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useConnection } from '../../app/shell/index.ts'
import { useLocale, useMessages } from '../../i18n/index.ts'
import type { Locale } from '../../i18n/locale.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { useDsh } from '../../dsh/services.ts'
import type { BundleInfo, PluginEntry, PluginInventorySnapshot } from './api.ts'
import { pluginsApi } from './api.ts'
import { bundleErrorLabel, groupPlugins, localizedText, phaseLabel, pluginTitle, type BundleGroup } from './model.ts'
import { pluginMessages, type PluginTexts } from './messages.ts'
import './plugins.css'

type State =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'error'; readonly error: unknown }
  | { readonly phase: 'ready'; readonly snapshot: PluginInventorySnapshot; readonly bundles?: readonly BundleInfo[] }

export function PluginsScreen() {
  const { remote } = useDsh()
  const { connected } = useConnection()
  const text = useMessages(pluginMessages)
  const locale = useLocale()
  const api = useMemo(() => pluginsApi(remote), [remote])
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [generation, setGeneration] = useState(0)
  const generationRef = useRef(0)
  const reload = useCallback(() => setGeneration(value => value + 1), [])

  useEffect(() => {
    // A newer load makes earlier in-flight responses stale.
    const id = ++generationRef.current
    let active = true
    // Keep the current list on screen while a refresh is in flight.
    setState(previous => previous.phase === 'ready' ? previous : { phase: 'loading' })
    void (async () => {
      try {
        const snapshot = await api.inventory()
        if (!active || generationRef.current !== id) return
        if (snapshot === undefined) { setState({ phase: 'unavailable' }); return }
        let bundles: readonly BundleInfo[] | undefined
        if (snapshot.managementAvailable === true) {
          bundles = await api.bundles()
          if (!active || generationRef.current !== id) return
        }
        setState({ phase: 'ready', snapshot, ...(bundles ? { bundles } : {}) })
      } catch (error) {
        if (active && generationRef.current === id) setState({ phase: 'error', error })
      }
    })()
    return () => { active = false }
  }, [api, generation])

  // CLI and manual edits that HMR picks up do not emit this; the refresh button
  // and reconnects cover those.
  useEffect(() => onRemoteEvent(remote, 'plugin-manager/changed', reload), [remote, reload])
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) reload()
    wasConnected.current = connected
  }, [connected, reload])

  return <PageScaffold title={text.title} actions={<M3eIconButton aria-label={text.refresh} onClick={reload}><Icon name="refresh" /></M3eIconButton>}>
    <div className="plugins-content">
      {state.phase === 'loading' && <p role="status" className="plugins-hint">{text.loading}</p>}
      {state.phase === 'unavailable' && <p role="status" className="plugins-hint">{text.unavailable}</p>}
      {state.phase === 'error' && <div role="alert" className="plugins-notice">
        <p>{remoteErrorMessage(state.error, text.loadFailed)}</p>
        <M3eButton variant="outlined" onClick={reload}>{text.retry}</M3eButton>
      </div>}
      {state.phase === 'ready' && <PluginBody snapshot={state.snapshot} bundles={state.bundles} text={text} locale={locale} />}
    </div>
  </PageScaffold>
}

function PluginBody({ snapshot, bundles, text, locale }: { snapshot: PluginInventorySnapshot; bundles?: readonly BundleInfo[]; text: PluginTexts; locale: Locale }) {
  const groups = groupPlugins(snapshot, bundles, locale)
  const sections = [
    { title: text.failedSection, entries: groups.failed, hint: text.failedReasonNote },
    { title: text.activeSection, entries: groups.active },
    { title: text.disabledSection, entries: groups.disabled },
    { title: text.otherSection, entries: groups.other },
  ].filter(section => section.entries.length > 0)
  return <>
    <p className="plugins-note">{text.reloadNote}</p>
    {sections.length > 0 && <ul className="plugins-list" aria-label={text.listLabel}>
      {sections.map(section => <li className="plugins-group" key={section.title}>
        <h2>{section.title}</h2>
        {section.hint !== undefined && <p className="plugins-hint">{section.hint}</p>}
        <ul className="plugins-rows">
          {section.entries.map(entry => <PluginRow key={entry.entryId} entry={entry} text={text} locale={locale} />)}
        </ul>
      </li>)}
    </ul>}
    {bundles !== undefined && <BundleSection bundles={groups.bundles} text={text} locale={locale} />}
  </>
}

function PluginRow({ entry, text, locale }: { entry: PluginEntry; text: PluginTexts; locale: Locale }) {
  const icon = entry.meta?.icon
  const description = localizedText(entry.meta?.description, locale)
  return <li className="plugins-row">
    {icon !== undefined && icon.startsWith('data:image/') && <img className="plugins-icon" src={icon} alt="" width={24} height={24} />}
    <div className="plugins-row-main">
      <p className="plugins-row-title">{pluginTitle(entry, locale)}</p>
      <p className="plugins-row-module">{entry.moduleName}</p>
      <p className={`plugins-phase${entry.fiberPhase === 'failed' ? ' plugins-phase-failed' : ''}`}>{phaseLabel(entry.fiberPhase, entry.enabled, text)}</p>
      {description !== undefined && description !== '' && <p className="plugins-description">{description}</p>}
      {entry.meta?.error !== undefined && <p className="plugins-meta-error" title={entry.meta.error}>{text.metaErrorNote}</p>}
    </div>
  </li>
}

function BundleSection({ bundles, text, locale }: { bundles: readonly BundleGroup[]; text: PluginTexts; locale: Locale }) {
  return <section className="plugins-section">
    <h2>{text.bundlesSection}</h2>
    <ul className="plugins-bundles" aria-label={text.bundlesSection}>
      {bundles.map(({ bundle }) => <li className="plugins-bundle" key={bundle.name}>
        <p className="plugins-row-title">{localizedText(bundle.meta?.title, locale) ?? bundle.name}</p>
        <p className="plugins-bundle-meta">
          {bundle.version !== undefined && <span>{text.versionLabel} {bundle.version}</span>}
          <span>{bundle.installed ? text.installedLabel : text.bundledLabel}</span>
          <span>{bundle.enabled ? text.enabledLabel : text.disabledLabel}</span>
        </p>
        {bundle.error !== undefined && <p className="plugins-bundle-error">{bundleErrorLabel(bundle.error.code, text)}</p>}
        {bundle.error?.code === 'incompatible-version' && bundle.error.incompatible?.map(item => <p className="plugins-incompatible" key={item.name}>
          {text.incompatiblePackages(item.name, item.version, Object.entries(item.peers).map(([name, range]) => `${name}@${range}`).join(', '))}
        </p>)}
        {bundle.description !== undefined && bundle.description !== '' && <p className="plugins-description">{bundle.description}</p>}
      </li>)}
    </ul>
  </section>
}
