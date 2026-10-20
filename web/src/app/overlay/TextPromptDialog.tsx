import { useId, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { remoteErrorMessage } from '../../dsh/remote-result.ts'
import { useMessages } from '../../i18n/index.ts'
import { overlayMessages } from '../messages.ts'

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
export function TextPromptDialog({ title, initialValue = '', label, multiline = false, rows = 4, confirmLabel, onConfirm, onCancel }: TextPromptDialogProps) {
  const text = useMessages(overlayMessages)
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  async function submit() {
    if (busy || !value.trim()) return
    setBusy(true)
    setError('')
    try { await onConfirm(multiline ? value : value.trim()) }
    catch (cause) { setError(remoteErrorMessage(cause, text.saveFailed)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit() }}>
    <h2>{title}</h2><label htmlFor={id}>{label ?? text.promptLabel}</label>
    {multiline
      ? <textarea id={id} autoFocus rows={rows} value={value} onChange={event => setValue(event.target.value)} disabled={busy} />
      : <input id={id} autoFocus value={value} onChange={event => setValue(event.target.value)} disabled={busy} />}
    {error && <p role="alert">{error}</p>}
    <div className="actions"><M3eButton onClick={onCancel} disabled={busy}>{text.cancel}</M3eButton>
      <M3eButton variant="filled" disabled={busy || !value.trim()} onClick={() => { void submit() }}>{confirmLabel ?? text.promptConfirm}</M3eButton></div>
  </form>
}
