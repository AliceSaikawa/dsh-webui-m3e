import { useId } from 'react'
import { M3eRadio, M3eRadioGroup } from '@m3e/react/radio-group'
import { M3eButton } from '@m3e/react/button'
import { openDialog, openSheet } from '../../app/overlay/index.ts'
import { backToClassic, setAppearance, useAppearance, type Appearance } from '../../app/theme/index.ts'

export const appearanceLabels: Record<Appearance, string> = {
  system: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク',
}

function AppearanceSheet() {
  const appearance = useAppearance()
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
