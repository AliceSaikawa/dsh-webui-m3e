import { useId, useState } from 'react'
import { M3eButton } from '@m3e/react/button'

export interface TextPromptDialogProps {
  title: string
  initialValue?: string
  label?: string
  onConfirm(value: string): void | Promise<void>
  onCancel(): void
}
export function TextPromptDialog({ title, initialValue = '', label = '名前', onConfirm, onCancel }: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  async function submit() {
    if (busy || !value.trim()) return
    setBusy(true)
    try { await onConfirm(value.trim()) }
    catch { setError('保存できませんでした。もう一度お試しください。') }
    finally { setBusy(false) }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit() }}>
    <h2>{title}</h2><label htmlFor={id}>{label}</label>
    <input id={id} autoFocus value={value} onChange={event => setValue(event.target.value)} disabled={busy} />
    {error && <p role="alert">{error}</p>}
    <div className="actions"><M3eButton onClick={onCancel} disabled={busy}>キャンセル</M3eButton>
      <M3eButton variant="filled" disabled={busy || !value.trim()} onClick={() => { void submit() }}>OK</M3eButton></div>
  </form>
}
