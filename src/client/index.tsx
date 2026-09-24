/**
 * dsh-webui-m3e — browser half inside the stock UI. Adds one row to Settings →
 * General that switches this device to the M3E UI. The M3E UI never loads
 * this half: its boot keeps only the transport plugins.
 */
import type { Context } from '@deepseek-ai/cordis'
import { type ChangeEvent, useState } from 'react'
import { readUiChoice, uiChoiceCookie } from '../shared/ui-choice.ts'

export const inject = ['slots']

interface SlotsService {
  inject(name: string, register: () => () => void): void
  register(options: { name: string; id: string; order: number }, component: () => unknown): () => void
}

export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: SlotsService }).slots
  slots.inject('settings.general.item', () =>
    slots.register({ name: 'settings.general.item', id: 'webui-m3e', order: 90 }, UiChoiceRow),
  )
}

/** Tokens and spacing copied from the stock Appearance row. */
const styles = {
  row: {
    borderBottom: '.5px solid var(--dsw-alias-border-l2)',
    padding: '16px 0',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    cursor: 'pointer',
  },
  text: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  title: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: '22px' },
  note: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' },
  toggle: { width: 24, height: 24, margin: 0, cursor: 'pointer' },
} as const

function UiChoiceRow() {
  const [on, setOn] = useState(() => readUiChoice(document.cookie) === 'm3e')
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.checked ? 'm3e' : 'classic'
    document.cookie = uiChoiceCookie(next)
    setOn(next === 'm3e')
    if (next === 'm3e') location.assign('/m3e/')
  }
  return (
    <label style={styles.row}>
      <span style={styles.text}>
        <span style={styles.title}>この端末で M3E の画面を使う</span>
        <span style={styles.note}>オンにすると切り替わります。戻すときは M3E の画面のボタンか、/?ui=classic を開きます。</span>
      </span>
      {/* `switch` renders a native switch on Safari 17.4+ and a checkbox elsewhere. */}
      <input type="checkbox" role="switch" {...{ switch: '' }} checked={on} onChange={change} style={styles.toggle} />
    </label>
  )
}
