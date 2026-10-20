import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog } from '../../app/overlay/index.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useConnection } from '../../app/shell/index.ts'
import { useMessages } from '../../i18n/index.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { RemoteCallError, remoteErrorMessage, remoteFailureOf } from '../../dsh/remote-result.ts'
import { useDsh } from '../../dsh/services.ts'
import { AGENT_PRESET_SETTINGS_NS, agentPresetsApi, type AgentPresetDocument, type AgentPresetRoster, type AgentPresetRow, type PresetSettingsFacts } from './api.ts'
import { canMakeDefault, hostNotice, presetDisplayText, presetSections } from './model.ts'
import { modeMessages, type ModeTexts } from './messages.ts'
import './modes.css'

type LoadState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'error'; readonly error: unknown }
  | { readonly phase: 'ready'; readonly roster: AgentPresetRoster; readonly settings?: PresetSettingsFacts }

function ConfigurationDialog({ document, title, text, close }: {
  document: AgentPresetDocument
  title: string
  text: ModeTexts
  close(): void
}) {
  return <>
    <h2>{title}</h2>
    <p className="modes-dialog-id">{document.agentPreset}</p>
    <pre className="modes-yaml" aria-label={text.yamlLabel} tabIndex={0}>{document.content}</pre>
    <div className="modes-dialog-actions"><M3eButton onClick={close}>{text.close}</M3eButton></div>
  </>
}

export function ModesScreen() {
  const { remote } = useDsh()
  const { connected } = useConnection()
  const text = useMessages(modeMessages)
  const api = useMemo(() => agentPresetsApi(remote), [remote])
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [generation, setGeneration] = useState(0)
  const [saving, setSaving] = useState(false)
  const [readingId, setReadingId] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const generationRef = useRef(0)
  const savingRef = useRef(false)
  const viewRequest = useRef(0)
  const closeView = useRef<(() => void) | undefined>(undefined)
  const reload = useCallback(() => setGeneration(value => value + 1), [])

  useEffect(() => {
    const id = ++generationRef.current
    let active = true
    setState(previous => previous.phase === 'ready' ? previous : { phase: 'loading' })
    void (async () => {
      try {
        const roster = await api.list()
        if (!active || generationRef.current !== id) return
        if (roster === undefined) { setState({ phase: 'unavailable' }); return }
        let settings: PresetSettingsFacts | undefined
        try { settings = await api.describeSettings() } catch { settings = undefined }
        if (!active || generationRef.current !== id) return
        setState({ phase: 'ready', roster, ...(settings ? { settings } : {}) })
      } catch (error) {
        if (!active || generationRef.current !== id) return
        if (error instanceof RemoteCallError && error.rpcError.code === 'gateway/invocation-unavailable') {
          setState({ phase: 'ready', roster: { presets: [] } })
          return
        }
        setState({ phase: 'error', error })
      }
    })()
    return () => { active = false }
  }, [api, generation])

  useEffect(() => onRemoteEvent(remote, 'settings/document-updated', ns => {
    if (ns === AGENT_PRESET_SETTINGS_NS || ns === 'ui-settings') reload()
  }), [remote, reload])

  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) reload()
    wasConnected.current = connected
  }, [connected, reload])

  useEffect(() => () => {
    viewRequest.current += 1
    closeView.current?.()
  }, [])

  const makeDefault = async (row: AgentPresetRow) => {
    if (state.phase !== 'ready' || savingRef.current) return
    const revision = state.settings?.revision
    if (!canMakeDefault(row, { writable: state.settings?.writable === true, revision, saving: false })) return
    if (revision === undefined) return
    savingRef.current = true
    setSaving(true)
    setNotice(undefined)
    try {
      await api.setDefault(row.id, revision)
      reload()
    } catch (error) {
      const failure = remoteFailureOf(error)
      setNotice(failure?.code === 'settings/conflict'
        ? text.conflict
        : hostNotice(failure?.message, remoteErrorMessage(error, text.saveFailed)))
      if (failure?.code === 'settings/conflict') reload()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const view = async (row: AgentPresetRow) => {
    const request = ++viewRequest.current
    closeView.current?.()
    closeView.current = undefined
    setNotice(undefined)
    setReadingId(row.id)
    try {
      const document = await api.read(row.id)
      if (viewRequest.current !== request) return
      const title = presetDisplayText(row, text).name
      closeView.current = openDialog(dismiss => <ConfigurationDialog document={document} title={title} text={text} close={dismiss} />, { label: text.view })
    } catch (error) {
      if (viewRequest.current === request) setNotice(remoteErrorMessage(error, text.viewFailed))
    } finally {
      if (viewRequest.current === request) setReadingId(undefined)
    }
  }

  return <PageScaffold title={text.title} actions={<M3eIconButton aria-label={text.refresh} onClick={() => { setNotice(undefined); reload() }}><Icon name="refresh" /></M3eIconButton>}>
    <div className="modes-content">
      <p className="modes-intro">{text.intro}</p>
      {state.phase === 'loading' && <p role="status" className="modes-hint">{text.loading}</p>}
      {state.phase === 'unavailable' && <p role="status" className="modes-hint">{text.unavailable}</p>}
      {state.phase === 'error' && <div role="alert" className="modes-notice modes-error">
        <p>{remoteErrorMessage(state.error, text.loadFailed)}</p>
        <M3eButton variant="outlined" onClick={reload}>{text.retry}</M3eButton>
      </div>}
      {state.phase === 'ready' && <ModeBody
        roster={state.roster}
        settings={state.settings}
        notice={notice}
        saving={saving}
        readingId={readingId}
        text={text}
        onDefault={row => { void makeDefault(row) }}
        onView={row => { void view(row) }}
      />}
    </div>
  </PageScaffold>
}

function ModeBody({ roster, settings, notice, saving, readingId, text, onDefault, onView }: {
  roster: AgentPresetRoster
  settings?: PresetSettingsFacts
  notice?: string
  saving: boolean
  readingId: string | undefined
  text: ModeTexts
  onDefault(row: AgentPresetRow): void
  onView(row: AgentPresetRow): void
}) {
  const gate = { writable: settings?.writable === true, revision: settings?.revision, saving }
  const sections = presetSections(roster.presets, settings?.codingToolsEnabled !== false)
  return <>
    {settings === undefined && <p role="status" className="modes-notice">{text.settingsUnread}</p>}
    {settings !== undefined && !settings.writable && <p role="status" className="modes-notice">{text.readonly}</p>}
    {notice !== undefined && <p role="alert" className="modes-notice modes-error">{notice}</p>}
    <p className="modes-saving" role="status">{saving ? text.saving : readingId !== undefined ? text.reading : ''}</p>
    {sections.length === 0 && <p className="modes-hint">{text.empty}</p>}
    {sections.length > 0 && <div aria-label={text.listLabel}>
      {sections.map(section => <section className="modes-group" key={section.kind}>
        <h2>{section.kind === 'built-in' ? text.builtInGroup : text.customGroup}</h2>
        <ul className="modes-cards">
          {section.rows.map(row => <ModeCard
            key={row.id}
            row={row}
            text={text}
            canSelect={canMakeDefault(row, gate)}
            reading={readingId === row.id}
            onDefault={() => onDefault(row)}
            onView={() => onView(row)}
          />)}
        </ul>
      </section>)}
    </div>}
  </>
}

function ModeCard({ row, text, canSelect, reading, onDefault, onView }: {
  row: AgentPresetRow
  text: ModeTexts
  canSelect: boolean
  reading: boolean
  onDefault(): void
  onView(): void
}) {
  const display = presetDisplayText(row, text)
  const titleId = `mode-${row.id}`
  return <li className={row.isDefault ? 'modes-card modes-card-current' : 'modes-card'}>
    <article aria-labelledby={titleId}>
      <div className="modes-card-head">
        <h3 id={titleId}>{display.name}</h3>
        <p className="modes-id">{row.id}</p>
      </div>
      <div className="modes-badges">
        {row.isDefault && <span className="modes-badge modes-badge-default">{text.currentDefault}</span>}
        {row.broken !== undefined && <span className="modes-badge modes-badge-broken">{text.brokenBadge}</span>}
      </div>
      <p className="modes-description">{display.description ?? text.noDescription}</p>
      {row.broken !== undefined && <p className="modes-broken">{row.broken}</p>}
      <div className="modes-actions">
        <M3eButton variant={row.isDefault ? 'filled' : 'outlined'} aria-pressed={row.isDefault} disabled={!canSelect} onClick={onDefault}>
          {row.isDefault ? text.currentDefault : text.setDefault}
        </M3eButton>
        <M3eButton variant="text" disabled={reading} onClick={onView}>{text.view}</M3eButton>
      </div>
    </article>
  </li>
}
