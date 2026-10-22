/**
 * dsh-webui-m3e — browser half inside the stock UI. Adds one row to Settings →
 * General that switches this device to the M3E UI. The M3E UI never loads
 * this half: its boot keeps only the transport plugins.
 */
import type { Context } from '@deepseek-ai/cordis'
import { type ChangeEvent, useState, useSyncExternalStore } from 'react'
import { FALLBACK_LOCALE, matchLocale, type Locale } from '../../web/src/i18n/locale.ts'
import { readUiChoice, uiChoiceCookie } from '../shared/ui-choice.ts'

export const inject = ['slots', 'locale']

interface SlotsService {
  inject(name: string, register: () => () => void): void
  register(options: { name: string; id: string; order: number }, component: () => unknown): () => void
}

/** The part of dsh-client-locale's `LocaleRuntime` the row reads. */
interface LocaleService {
  getSnapshot(): { readonly active: string }
  subscribe(listener: () => void): () => void
}

/**
 * The row follows the stock UI's language, so it reads like the rows around
 * it. A language M3E has no text for (a language pack's) is shown in English,
 * the stock UI's own fallback.
 */
const ROW_TEXT = {
  ja: {
    title: 'この端末で M3E の画面を使う',
    note: 'M3E を選んだ端末では、新しく / を開くと M3E に切り替わります。パソコンでは / は今の画面のままで、M3E は /m3e/ を直接開くと使えます。M3E を表示していたタブで URL から /m3e/ を消すと、そのタブでは今の画面のままです。戻すときは M3E の画面のボタンか、/?ui=classic を開きます。',
  },
  en: {
    title: 'Use the M3E interface on this device',
    note: 'On a device that chose M3E, opening / switches to M3E. On a computer, / keeps the standard interface, and M3E opens when you go to /m3e/ directly. In a tab that showed M3E, removing /m3e/ from the URL keeps the standard interface in that tab. To switch back, use the button in the M3E interface or open /?ui=classic.',
  },
  zh: {
    title: '在此设备上使用 M3E 界面',
    note: '在选择了 M3E 的设备上，新打开 / 时会切换到 M3E。在电脑上，/ 仍是标准界面，直接打开 /m3e/ 即可使用 M3E。在显示过 M3E 的标签页中，从 URL 中删除 /m3e/ 后，该标签页仍是标准界面。要切换回来，请使用 M3E 界面中的按钮，或打开 /?ui=classic。',
  },
} as const satisfies Record<Locale, { title: string; note: string }>

export function rowLocale(active: string): Locale {
  return matchLocale(active) ?? FALLBACK_LOCALE
}

export function apply(ctx: Context): void {
  const { slots, locale } = ctx as unknown as { slots: SlotsService; locale: LocaleService }
  // LocaleRuntime's methods read `this`; bind them once so React keeps the same subscription.
  const language = {
    subscribe: (listener: () => void) => locale.subscribe(listener),
    active: () => rowLocale(locale.getSnapshot().active),
  }
  const Row = () => <UiChoiceRow language={language} />
  slots.inject('settings.general.item', () =>
    slots.register({ name: 'settings.general.item', id: 'webui-m3e', order: 90 }, Row),
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

function UiChoiceRow({ language }: { language: { subscribe(listener: () => void): () => void; active(): Locale } }) {
  const text = ROW_TEXT[useSyncExternalStore(language.subscribe, language.active)]
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
        <span style={styles.title}>{text.title}</span>
        <span style={styles.note}>{text.note}</span>
      </span>
      {/* `switch` renders a native switch on Safari 17.4+ and a checkbox elsewhere. */}
      <input type="checkbox" role="switch" {...{ switch: '' }} checked={on} onChange={change} style={styles.toggle} />
    </label>
  )
}
