import { useEffect, useId, useState } from 'react'
import { M3eRadio, M3eRadioGroup } from '@m3e/react/radio-group'
import { M3eButton } from '@m3e/react/button'
import { openDialog, openSheet } from '../../app/overlay/index.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import {
  THEME_COLOR_PRESETS, backToClassic, normalizeThemeColor, setAppearance, setThemeColor, useAppearance, useThemeColor,
  type Appearance,
} from '../../app/theme/index.ts'
import { currentLocale, messagesOf, useMessages } from '../../i18n/index.ts'
import { appearanceMessages, type AppearanceTexts } from './messages.ts'
import { createFrameThrottledWriter, type FrameThrottledWriter } from './frame-throttle.ts'

const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark']

const COLOR_KEYS: Readonly<Record<string, keyof AppearanceTexts>> = {
  '#6750a4': 'colorPurple',
  '#0b57d0': 'colorBlue',
  '#006a6a': 'colorTeal',
  '#386a20': 'colorGreen',
  '#8c4a00': 'colorOrange',
  '#b3261e': 'colorRed',
}

export function appearanceLabel(value: Appearance, text: AppearanceTexts): string {
  return value === 'light' ? text.light : value === 'dark' ? text.dark : text.system
}

export function themeColorLabel(color: string, text: AppearanceTexts): string {
  const normalized = normalizeThemeColor(color)
  const key = normalized === undefined ? undefined : COLOR_KEYS[normalized]
  return key === undefined ? text.otherColor : text[key] as string
}

/**
 * A color input reports every color the pointer passes over. Apply only the latest one per frame,
 * so saving and recoloring the screen keep up with the drag. A preset applies at once and drops the
 * waiting custom color; the sheet applies a waiting custom color when it closes.
 */
function useThemeColorWriter(): FrameThrottledWriter<string> {
  const [writer] = useState(() => createFrameThrottledWriter(setThemeColor, {
    request: callback => requestAnimationFrame(callback),
    cancel: handle => cancelAnimationFrame(handle),
  }))
  useEffect(() => () => writer.flush(), [writer])
  return writer
}

function AppearanceSheet() {
  const text = useMessages(appearanceMessages)
  const appearance = useAppearance()
  const color = useThemeColor()
  // The input shows the picked color right away, ahead of the throttled store.
  const [picked, setPicked] = useState(color)
  useEffect(() => setPicked(color), [color])
  const writeColor = useThemeColorWriter()
  const custom = !THEME_COLOR_PRESETS.some(preset => preset.color.toLowerCase() === color)
  const titleId = useId()
  return <div className="settings-sheet">
    <h2 id={titleId}>{text.appearance}</h2>
    <p className="muted">{text.appliedToDevice}</p>
    <M3eRadioGroup className="settings-appearance-options" aria-labelledby={titleId}>
      {APPEARANCES.map(value => <label className="settings-appearance-option" key={value}>
        <M3eRadio value={value} checked={appearance === value} aria-label={appearanceLabel(value, text)}
          onChange={() => setAppearance(value)} />
        <span>{appearanceLabel(value, text)}</span>
      </label>)}
    </M3eRadioGroup>
    <h3>{text.screenColor}</h3>
    <p className="muted">{text.screenColorDescription}</p>
    <div className="settings-color-options" role="group" aria-label={text.screenColor}>
      {THEME_COLOR_PRESETS.map(({ color: presetColor }) => {
        const label = themeColorLabel(presetColor, text)
        const selected = presetColor.toLowerCase() === color
        return <button key={presetColor} type="button" className="settings-color-swatch"
          aria-label={label} aria-pressed={selected} title={label}
          style={{ background: presetColor }} onClick={() => {
            // The store may already hold this color while a custom one waits, so reset the input too.
            setPicked(presetColor.toLowerCase())
            writeColor.immediate(presetColor)
          }}>
          {selected && <Icon name="check" />}
        </button>
      })}
    </div>
    <label className="settings-color-custom">
      <span>{text.otherColor}</span>
      {/* aria-pressed is not allowed on a color input, so the selected state goes in its name. */}
      <input type="color" value={picked} aria-label={custom ? text.otherColorSelected : text.otherColor}
        onChange={event => { setPicked(event.currentTarget.value); writeColor.throttled(event.currentTarget.value) }} />
      {custom && <Icon name="check" />}
    </label>
  </div>
}

export function openAppearance(): void {
  openSheet(<AppearanceSheet />, { label: messagesOf(appearanceMessages, currentLocale()).appearance })
}

export function confirmClassic(): void {
  const text = messagesOf(appearanceMessages, currentLocale())
  openDialog(close => <>
    <h2>{text.backToClassic}</h2>
    <p>{text.backToClassicDescription}</p>
    <div className="actions settings-actions">
      <M3eButton variant="text" onClick={close}>{text.cancel}</M3eButton>
      <M3eButton onClick={() => { close(); backToClassic() }}>{text.backToClassic}</M3eButton>
    </div>
  </>, { label: text.backToClassicConfirmLabel })
}
