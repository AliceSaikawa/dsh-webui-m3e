import { useId, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'

export interface TextPromptDialogProps {
  title: string
  initialValue?: string
  label?: string
  multiline?: boolean
  rows?: number
  confirmLabel?: string
  onConfirm(value: string): void | Promise<void>
  onCancel(): void
}
export function TextPromptDialog({ title, initialValue = '', label = '名前', multiline = false, rows = 4, confirmLabel = 'OK', onConfirm, onCancel }: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  async function submit() {
    if (busy || !value.trim()) return
    setBusy(true)
    setError('')
    try { await onConfirm(multiline ? value : value.trim()) }
    catch (cause) { setError(remoteErrorMessage(cause, '保存できませんでした。もう一度お試しください。')) }
    finally { setBusy(false) }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit() }}>
    <h2>{title}</h2><label htmlFor={id}>{label}</label>
    {multiline
      ? <textarea id={id} autoFocus rows={rows} value={value} onChange={event => setValue(event.target.value)} disabled={busy} />
      : <input id={id} autoFocus value={value} onChange={event => setValue(event.target.value)} disabled={busy} />}
    {error && <p role="alert">{error}</p>}
    <div className="actions"><M3eButton onClick={onCancel} disabled={busy}>キャンセル</M3eButton>
      <M3eButton variant="filled" disabled={busy || !value.trim()} onClick={() => { void submit() }}>{confirmLabel}</M3eButton></div>
  </form>
}
