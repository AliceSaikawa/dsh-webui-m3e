import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eFormField } from '@m3e/react/form-field'
import { Icon } from '../../app/icons/Icon.tsx'
import { showSnackbar, useOverlays } from '../../app/overlay/index.ts'
import { customFieldWritable, customOperations, modelDraft, unusualURL, type ModelInputs } from './custom-provider.ts'
import type { CustomProviderStore } from './custom-provider-store.ts'
import type { ProviderStore } from './providers.ts'

const protocolNames: Record<string, string> = { 'openai-completions': 'OpenAI チャット補完', 'openai-responses': 'OpenAI 応答', 'anthropic-messages': 'Anthropic メッセージ' }
function Field({ label, value, onChange, disabled, error, type = 'text', inputMode, fieldKey }: {
  label: string; value: string; onChange(value: string): void; disabled: boolean; error?: string; type?: string; inputMode?: 'numeric' | 'url'; fieldKey?: string
}) {
  const id = useId()
  return <div className="custom-field"><M3eFormField variant="outlined" error={Boolean(error)}>
    <label slot="label" htmlFor={id}>{label}</label>
    <input id={id} value={value} type={type} disabled={disabled} inputMode={inputMode} data-custom-field={fieldKey}
      autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => onChange(event.currentTarget.value)} />
  </M3eFormField>{error && <p id={`${id}-error`} className="settings-error" role="alert">{error}</p>}</div>
}

export function CustomProviderSheet({ controller, keys, close, overlayKey, released }: {
  controller: CustomProviderStore; keys: ProviderStore; close(): void; overlayKey: string; released(): void
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const key = useSyncExternalStore(controller.input.subscribe, controller.input.getSnapshot, controller.input.getSnapshot)
  const providers = useSyncExternalStore(keys.subscribe, keys.getSnapshot, keys.getSnapshot)
  const root = useRef<HTMLFormElement>(null)
  const entries = useOverlays()
  const present = entries.some(entry => entry.interactionKey === overlayKey)
  useEffect(() => {
    controller.activate(); void controller.load()
    root.current?.querySelector('h2')?.focus()
    return () => { controller.dispose() }
  }, [controller])
  useLayoutEffect(() => { if (!present) { controller.dispose(); released() } }, [present, controller])
  const saving = state.phase === 'savingSettings' || state.phase === 'savingKey'
  const disabled = state.phase !== 'editing'
  const draft = state.draft
  const fieldDisabled = (name: string) => disabled || Boolean(state.editing && state.namespace && !customFieldWritable(state.namespace, draft?.id ?? '', name))
  const leave = () => { controller.dispose(); close() }
  async function submit() {
    if (await controller.submit()) {
      const message = controller.getSnapshot().message ?? '提供元を保存しました'
      leave(); showSnackbar(message)
    } else requestAnimationFrame(() => {
      const field = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      field?.focus(); field?.scrollIntoView({ block: 'center' })
    })
  }
  const changed = !state.editing || Boolean(state.namespace && state.initial && draft && customOperations(state.namespace, state.initial, draft, true).length)
  const changeModel = (row: string, patch: Partial<ModelInputs>) => controller.change(current => ({ ...current, models: current.models.map(model => model.row === row ? { ...model, ...patch } : model) }))
  return <form ref={root} className="custom-provider-form" onSubmit={event => event.preventDefault()}
    onBlur={event => { const field = (event.target as HTMLElement).dataset.customField; if (field && state.phase === 'editing') controller.validate(field) }}>
    <header className="custom-provider-header"><h2 tabIndex={-1}>{state.editing ? 'カスタムプロバイダーを編集' : 'カスタムプロバイダーを追加'}</h2>
      <M3eIconButton aria-label="閉じる" onClick={leave}><Icon name="close" /></M3eIconButton></header>
    {state.phase === 'loading' && <p role="status">設定を読み込んでいます…</p>}
    {state.message && <div className="settings-notice"><p role="alert">{state.message}</p>
      {['blocked', 'stale', 'unknown'].includes(state.phase) && <>
        <p>入力中の変更は破棄されます。</p><M3eButton onClick={() => { void controller.load() }}>{state.phase === 'unknown' ? '保存結果を確認' : '再読み込み'}</M3eButton>
      </>}
    </div>}
    {draft && <>
      <p className="muted">保存するまで変更は反映されません。閉じると入力中の内容は失われます。</p>
      <Field label="プロバイダー ID" fieldKey="id" value={draft.id} disabled={disabled || state.editing} error={state.errors.id}
        onChange={id => controller.change(current => ({ ...current, id }))} />
      <Field label="表示名（任意）" value={draft.displayName} disabled={fieldDisabled('displayName')} error={state.errors.displayName}
        onChange={displayName => controller.change(current => ({ ...current, displayName }))} />
      <Field label="ベース URL" fieldKey="baseURL" value={draft.baseURL} disabled={fieldDisabled('baseURL')} error={state.errors.baseURL} inputMode="url"
        onChange={baseURL => controller.change(current => ({ ...current, baseURL }))} />
      <p className="settings-field-help">HTTP または HTTPS の URL を入力してください。URL に API キーを書かないでください。</p>
      {unusualURL(draft.baseURL) && <p role="status">通常の HTTP / HTTPS URL ではありません。保存はできますが、接続先を確認してください。</p>}
      <div className="custom-field"><label>API プロトコル<select aria-label="API プロトコル" value={draft.api} disabled={fieldDisabled('api')} aria-invalid={Boolean(state.errors.api)}
        onChange={event => controller.change(current => ({ ...current, api: event.target.value }))}>
        {!state.protocols.includes(draft.api) && <option value={draft.api}>現在の値は選択肢にありません</option>}
        {state.protocols.map(api => <option key={api} value={api}>{protocolNames[api] ?? api}</option>)}
      </select></label>{state.errors.api && <p role="alert" className="settings-error">{state.errors.api}</p>}</div>
      <section aria-label="モデル" className="custom-models"><h3>モデル</h3>
        {fieldDisabled('models') && state.phase === 'editing' && <p>このモデル一覧には保護された項目があるため変更できません。</p>}
        {draft.models.map((model, index) => <fieldset key={model.row} className="custom-model-row" disabled={fieldDisabled('models')}>
          <legend>モデル {index + 1}</legend>
          <Field label="モデル ID" fieldKey={`${model.row}.id`} value={model.id} disabled={fieldDisabled('models')} error={state.errors[`${model.row}.id`]} onChange={id => changeModel(model.row, { id })} />
          <Field label="モデル表示名（任意）" value={model.name} disabled={fieldDisabled('models')} onChange={name => changeModel(model.row, { name })} />
          <details open={Boolean(state.errors[`${model.row}.contextWindow`] || state.errors[`${model.row}.maxTokens`] || state.errors[`${model.row}.input`]) || undefined}><summary>詳細</summary>
            <Field label="コンテキスト長" fieldKey={`${model.row}.contextWindow`} value={model.contextWindow} disabled={fieldDisabled('models')} inputMode="numeric" error={state.errors[`${model.row}.contextWindow`]} onChange={contextWindow => changeModel(model.row, { contextWindow })} />
            <Field label="最大出力トークン数" fieldKey={`${model.row}.maxTokens`} value={model.maxTokens} disabled={fieldDisabled('models')} inputMode="numeric" error={state.errors[`${model.row}.maxTokens`]} onChange={maxTokens => changeModel(model.row, { maxTokens })} />
            <p className="settings-field-help">空欄なら提供元の既定値を使います。</p>
            <div className="custom-modalities"><p>入力種別</p><label><input type="checkbox" checked={model.inheritedInput} onChange={e => changeModel(model.row, { inheritedInput: e.target.checked })} />提供元の既定値を使う</label>
              {!model.inheritedInput && ['text', 'image'].map(value => <label key={value}><input type="checkbox" checked={model.input.includes(value)}
                onChange={e => changeModel(model.row, { input: e.target.checked ? [...model.input, value] : model.input.filter(v => v !== value) })} />{value === 'text' ? 'テキスト' : '画像'}</label>)}
              {state.errors[`${model.row}.input`] && <p role="alert" className="settings-error">{state.errors[`${model.row}.input`]}</p>}
            </div>
          </details>
          <M3eButton variant="text" disabled={fieldDisabled('models')} onClick={() => controller.change(current => ({ ...current, models: current.models.filter(item => item.row !== model.row) }))}>モデルを削除</M3eButton>
        </fieldset>)}
        {state.errors.models && <p role="alert" className="settings-error">{state.errors.models}</p>}
        <M3eButton variant="outlined" disabled={fieldDisabled('models')} onClick={() => controller.change(current => ({ ...current, models: [...current.models, modelDraft()] }))}>モデルを追加</M3eButton>
      </section>
      <Field label="API キー（任意）" fieldKey="key" value={key.draft} type={key.visible ? 'text' : 'password'} disabled={saving || !['editing', 'keyFailed'].includes(state.phase)} error={state.errors.key}
        onChange={controller.input.input} />
      <p>API キー：{({ registered: '登録済み', missing: '未登録', unknown: '確認できません', unnecessary: '確認できません' })[providers.rows.find(row => row.id === draft.id)?.status ?? 'unknown']}</p>
      <M3eButton variant="text" disabled={saving} aria-pressed={key.visible} onClick={controller.input.toggle}>{key.visible ? '入力したキーを隠す' : '入力したキーを表示する'}</M3eButton>
      <p className="settings-field-help">保存すると、あとから表示できません。空欄なら登録済みのキーを変更しません。</p>
      {saving && <p role="status">保存しています…</p>}
      <p className="settings-field-help">保存を始めた変更は、閉じても取り消せません。</p>
    </>}
    <div className="custom-provider-actions"><M3eButton variant="outlined" onClick={leave}>キャンセル</M3eButton>
      <M3eButton variant="filled" disabled={!['editing', 'keyFailed'].includes(state.phase) || (!changed && !key.draft.trim())} onClick={() => { void submit() }}>{state.phase === 'keyFailed' ? 'API キーを保存' : '保存'}</M3eButton>
    </div>
  </form>
}
