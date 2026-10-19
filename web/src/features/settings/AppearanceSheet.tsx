import { useEffect, useId, useRef, useState } from 'react'
import { M3eRadio, M3eRadioGroup } from '@m3e/react/radio-group'
import { M3eButton } from '@m3e/react/button'
import { openDialog, openSheet } from '../../app/overlay/index.ts'
import { Icon } from '../../app/icons/Icon.tsx'
import {
  THEME_COLOR_PRESETS, backToClassic, normalizeThemeColor, setAppearance, setThemeColor, useAppearance, useThemeColor,
  type Appearance,
} from '../../app/theme/index.ts'

export const appearanceLabels: Record<Appearance, string> = {
  system: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク',
}

export function themeColorLabel(color: string): string {
  const normalized = normalizeThemeColor(color)
  return THEME_COLOR_PRESETS.find(preset => preset.color.toLowerCase() === normalized)?.label ?? 'ほかの色'
}

/**
 * A color input reports every color the pointer passes over. Apply only the latest one per frame,
 * and the pending one when the sheet closes, so saving and recoloring the screen keep up with the drag.
 */
function useFrameThrottledColor(): (color: string) => void {
  const pending = useRef<{ frame: number; color: string }>(undefined)
  useEffect(() => () => {
    const last = pending.current
    if (!last) return
    pending.current = undefined
    cancelAnimationFrame(last.frame)
    setThemeColor(last.color)
  }, [])
  return color => {
    if (pending.current) { pending.current.color = color; return }
    const entry = { frame: 0, color }
    entry.frame = requestAnimationFrame(() => { pending.current = undefined; setThemeColor(entry.color) })
    pending.current = entry
  }
}

function AppearanceSheet() {
  const appearance = useAppearance()
  const color = useThemeColor()
  // The input shows the picked color right away, ahead of the throttled store.
  const [picked, setPicked] = useState(color)
  useEffect(() => setPicked(color), [color])
  const chooseCustomColor = useFrameThrottledColor()
  const custom = !THEME_COLOR_PRESETS.some(preset => preset.color.toLowerCase() === color)
  const titleId = useId()
  return <div className="settings-sheet">
    <h2 id={titleId}>外観</h2>
    <p className="muted">この端末だけに適用されます。</p>
    <M3eRadioGroup className="settings-appearance-options" aria-labelledby={titleId}>
      {(Object.keys(appearanceLabels) as Appearance[]).map(value => <label className="settings-appearance-option" key={value}>
        <M3eRadio value={value} checked={appearance === value} aria-label={appearanceLabels[value]}
          onChange={() => setAppearance(value)} />
        <span>{appearanceLabels[value]}</span>
      </label>)}
    </M3eRadioGroup>
    <h3>画面の色</h3>
    <p className="muted">選んだ色から配色を作ります。</p>
    <div className="settings-color-options" role="group" aria-label="画面の色">
      {THEME_COLOR_PRESETS.map(({ color: presetColor, label }) => {
        const selected = presetColor.toLowerCase() === color
        return <button key={presetColor} type="button" className="settings-color-swatch"
          aria-label={label} aria-pressed={selected} title={label}
          style={{ background: presetColor }} onClick={() => setThemeColor(presetColor)}>
          {selected && <Icon name="check" />}
        </button>
      })}
    </div>
    <label className="settings-color-custom">
      <span>ほかの色</span>
      {/* aria-pressed is not allowed on a color input, so the selected state goes in its name. */}
      <input type="color" value={picked} aria-label={custom ? 'ほかの色（選択中）' : 'ほかの色'}
        onChange={event => { setPicked(event.currentTarget.value); chooseCustomColor(event.currentTarget.value) }} />
      {custom && <Icon name="check" />}
    </label>
  </div>
}

export function openAppearance(): void {
  openSheet(<AppearanceSheet />, { label: '外観' })
}

export function confirmClassic(): void {
  openDialog(close => <>
    <h2>今の画面に戻す</h2>
    <p>この端末では DSH の標準の画面を使います。M3E の画面には、標準の画面の設定からいつでも戻れます</p>
    <div className="actions settings-actions">
      <M3eButton variant="text" onClick={close}>キャンセル</M3eButton>
      <M3eButton onClick={() => { close(); backToClassic() }}>今の画面に戻す</M3eButton>
    </div>
  </>, { label: '今の画面に戻す確認' })
}
