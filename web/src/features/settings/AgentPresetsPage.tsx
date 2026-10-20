import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openFullSheet } from '../../app/overlay/index.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useConnection } from '../../app/shell/index.ts'
import { useMessages } from '../../i18n/index.ts'
import { onRemoteEvent } from '../../dsh/remote-events.ts'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { useDsh, type DshRemote } from '../../dsh/services.ts'
import { AGENT_PRESET_NS, agentPresetsApi, codingToolsDisabled, codingToolsReset, groupPresets, presetDisplayText, visiblePresets, type AgentPresetRow, type AgentPresetsApi } from './agent-presets.ts'
import { agentPresetMessages, type AgentPresetTexts } from './messages.ts'
import { fieldKey } from './store.ts'
import { useSettings } from './use-settings.ts'
import './settings.css'

export type AgentPresetRosterState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'error'; readonly error: unknown }
  | { readonly phase: 'ready'; readonly rows: readonly AgentPresetRow[] }

/**
 * Read the optional roster and keep it current across reconnects and settings
 * changes. With Coding Tools off it also puts a hidden default (PTC or Minimal)
 * back to `standard` each time the roster or the preference changes, as the
 * stock screen does; `resetError` says why that could not be done.
 */
export function useAgentPresetRoster(remote: DshRemote) {
  const text = useMessages(agentPresetMessages)
  const api = useMemo(() => agentPresetsApi(remote), [remote])
  const [state, setState] = useState<AgentPresetRosterState>({ phase: 'loading' })
  const [generation, setGeneration] = useState(0)
  const generationRef = useRef(0)
  const reload = useCallback(() => setGeneration(value => value + 1), [])
  useEffect(() => {
    // A newer read makes earlier in-flight responses stale.
    const id = ++generationRef.current
    let active = true
    setState(previous => previous.phase === 'ready' ? previous : { phase: 'loading' })
    void (async () => {
      try {
        const rows = await api.list()
        if (!active || generationRef.current !== id) return
        setState(rows === undefined ? { phase: 'unavailable' } : { phase: 'ready', rows })
      } catch (error) {
        if (active && generationRef.current === id) setState({ phase: 'error', error })
      }
    })()
    return () => { active = false }
  }, [api, generation])
  useEffect(() => onRemoteEvent(remote, 'settings/document-updated', ns => {
    if (ns === AGENT_PRESET_NS) reload()
  }), [remote, reload])
  const { connected } = useConnection()
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) reload()
    wasConnected.current = connected
  }, [connected, reload])

  const { state: settings, store } = useSettings()
  const codingToolsOff = settings.phase === 'ready' && codingToolsDisabled(settings.namespaces)
  const writable = settings.phase === 'ready' && settings.writable && settings.namespaces.some(row => row.ns === AGENT_PRESET_NS)
  const [resetError, setResetError] = useState<string>()
  // One attempt per roster read: a refused save is not retried until the roster is read again.
  const attempted = useRef<AgentPresetRosterState | undefined>(undefined)
  useEffect(() => {
    const decision = state.phase === 'ready' ? codingToolsReset(state.rows, codingToolsOff) : 'none'
    if (decision === 'none' || !writable) { setResetError(undefined); return }
    if (decision === 'standard-unavailable') { setResetError(text.standardUnavailable); return }
    if (attempted.current === state) return
    attempted.current = state
    let active = true
    void store.edit(AGENT_PRESET_NS, ['selectedDefault'], 'standard').then(saved => {
      if (saved) reload()
      else if (active) setResetError(store.getSnapshot().fieldErrors[fieldKey(AGENT_PRESET_NS, ['selectedDefault'])] ?? text.saveFailed)
    })
    return () => { active = false }
  }, [state, codingToolsOff, writable, store, reload, text])
  return { state, reload, api, codingToolsOff, resetError }
}

export function AgentPresetsPage() {
  const text = useMessages(agentPresetMessages)
  const { remote } = useDsh()
  const roster = useAgentPresetRoster(remote)
  const { state: settings, store } = useSettings()
  const [saving, setSaving] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const canWrite = settings.phase === 'ready' && settings.writable
    && settings.namespaces.some(row => row.ns === AGENT_PRESET_NS)
  // The Coding Tools preference decides which modes show, so wait for it to avoid a flash of hidden modes.
  const pending = roster.state.phase === 'loading' || (roster.state.phase === 'ready' && settings.phase === 'loading')
  const rows = roster.state.phase === 'ready' ? visiblePresets(roster.state.rows, roster.codingToolsOff) : []
  const groups = groupPresets(rows)

  async function makeDefault(row: AgentPresetRow): Promise<void> {
    if (!canWrite || saving !== undefined || row.broken !== undefined || row.isDefault) return
    setSaving(row.id)
    setNotice(undefined)
    try {
      const saved = await store.edit(AGENT_PRESET_NS, ['selectedDefault'], row.id)
      if (saved) roster.reload()
      else setNotice(store.getSnapshot().fieldErrors[fieldKey(AGENT_PRESET_NS, ['selectedDefault'])] ?? text.saveFailed)
    } finally {
      setSaving(undefined)
    }
  }

  function view(row: AgentPresetRow, name: string): void {
    openFullSheet(close => <PresetConfigSheet id={row.id} name={name} api={roster.api} text={text} close={close} />,
      { label: text.configTitle(name) })
  }

  return <PageScaffold title={text.title} actions={<M3eIconButton aria-label={text.refresh} onClick={roster.reload}><Icon name="refresh" /></M3eIconButton>}>
    <div className="settings-content">
      <p className="settings-preset-intro">{text.intro}</p>
      {pending && <p role="status" className="muted">{text.loading}</p>}
      {roster.state.phase === 'unavailable' && <p role="status" className="settings-notice">{text.unavailable}</p>}
      {roster.state.phase === 'error' && <div role="alert" className="settings-notice">
        <p>{remoteErrorMessage(roster.state.error, text.loadFailed)}</p>
        <M3eButton variant="outlined" onClick={roster.reload}>{text.retry}</M3eButton>
      </div>}
      {roster.state.phase === 'ready' && !pending && <>
        {settings.phase === 'error' && <p role="alert" className="settings-notice">{settings.error}</p>}
        {settings.phase === 'ready' && !canWrite && <p className="settings-notice">{text.readonly}</p>}
        {roster.resetError !== undefined && <p role="alert" className="settings-notice">{roster.resetError}</p>}
        {notice !== undefined && <p role="alert" className="settings-notice">{notice}</p>}
        {saving !== undefined && <p role="status" className="settings-saving">{text.saving}</p>}
        <PresetGroup title={text.builtInGroup} rows={groups.builtIn} text={text} canWrite={canWrite} saving={saving !== undefined} makeDefault={makeDefault} view={view} />
        <PresetGroup title={text.customGroup} rows={groups.custom} text={text} canWrite={canWrite} saving={saving !== undefined} makeDefault={makeDefault} view={view} />
        {rows.length === 0 && <p className="muted">{text.empty}</p>}
      </>}
    </div>
  </PageScaffold>
}

function PresetGroup({ title, rows, text, canWrite, saving, makeDefault, view }: {
  title: string; rows: readonly AgentPresetRow[]; text: AgentPresetTexts; canWrite: boolean; saving: boolean
  makeDefault(row: AgentPresetRow): void; view(row: AgentPresetRow, name: string): void
}) {
  if (rows.length === 0) return null
  return <section className="settings-preset-group">
    <h2>{title}</h2>
    <ul className="settings-preset-list" aria-label={title}>
      {rows.map(row => {
        const display = presetDisplayText(row, text)
        const broken = row.broken !== undefined
        const descriptionId = `preset-${row.id}-description`
        const brokenId = `preset-${row.id}-broken`
        const label = broken ? `${text.brokenBadge}: ${display.name}`
          : row.isDefault ? `${text.inUse}: ${display.name}` : `${text.setDefault}: ${display.name}`
        return <li className="settings-preset-card" data-default={row.isDefault ? 'true' : undefined} key={row.id}>
          <button type="button" className="settings-preset-select" aria-label={label} aria-pressed={row.isDefault}
            aria-describedby={broken ? `${descriptionId} ${brokenId}` : descriptionId}
            disabled={broken || row.isDefault || !canWrite || saving} onClick={() => makeDefault(row)}>
            <span className="settings-preset-name">{display.name}
              {row.isDefault && <span className="settings-preset-badge">{text.inUse}</span>}
              {broken && <span className="settings-preset-badge settings-preset-badge-broken">{text.brokenBadge}</span>}
            </span>
            <span className="settings-preset-description" id={descriptionId}>{display.description ?? text.noDescription}</span>
            {broken && <span className="settings-preset-broken" id={brokenId}>{row.broken}</span>}
          </button>
          <div className="settings-preset-actions">
            <M3eButton variant="text" aria-label={`${text.view}: ${display.name}`} onClick={() => view(row, display.name)}>{text.view}</M3eButton>
          </div>
        </li>
      })}
    </ul>
  </section>
}

function PresetConfigSheet({ id, name, api, text, close }: {
  id: string; name: string; api: AgentPresetsApi; text: AgentPresetTexts; close(): void
}) {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'ready'; content: string } | { phase: 'error'; error: unknown }>({ phase: 'loading' })
  useEffect(() => {
    let active = true
    void api.read(id).then(document => { if (active) setState({ phase: 'ready', content: document.content }) },
      error => { if (active) setState({ phase: 'error', error }) })
    return () => { active = false }
  }, [api, id])
  return <div className="settings-sheet settings-preset-viewer">
    <h2>{text.configTitle(name)}</h2>
    {state.phase === 'loading' && <p role="status" className="muted">{text.configLoading}</p>}
    {state.phase === 'error' && <p role="alert" className="settings-error">{remoteErrorMessage(state.error, text.configFailed)}</p>}
    {state.phase === 'ready' && <pre className="settings-preset-code">{state.content}</pre>}
    <div className="actions settings-actions">
      <M3eButton variant="text" className="settings-preset-close" onClick={close}>{text.close}</M3eButton>
    </div>
  </div>
}
