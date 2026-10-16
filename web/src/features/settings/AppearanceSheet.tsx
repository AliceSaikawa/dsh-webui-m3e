import { useId } from 'react'
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

function AppearanceSheet() {
  const appearance = useAppearance()
  const color = useThemeColor()
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
      <input type="color" value={color} onChange={event => setThemeColor(event.currentTarget.value)} />
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
