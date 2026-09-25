import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openDialog, openSheet } from '../../app/overlay/index.ts'
import { backToClassic, setAppearance, useAppearance, type Appearance } from '../../app/theme/index.ts'

export const appearanceLabels: Record<Appearance, string> = {
  system: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク',
}

function AppearanceSheet({ close }: { close(): void }) {
  const appearance = useAppearance()
  return <div className="settings-sheet">
    <h2>外観</h2>
    <p className="muted">この端末だけに適用されます。</p>
    <M3eActionList aria-label="外観">
      {(Object.keys(appearanceLabels) as Appearance[]).map(value => <M3eListAction key={value}
        aria-label={`${appearanceLabels[value]}${appearance === value ? '、選択中' : ''}`}
        onClick={() => setAppearance(value)}>
        <span slot="leading"><Icon name={value === 'system' ? 'brightness_auto' : value === 'light' ? 'light_mode' : 'dark_mode'} /></span>
        {appearanceLabels[value]}
        {appearance === value && <span slot="trailing"><Icon name="check" /></span>}
      </M3eListAction>)}
    </M3eActionList>
    <div className="actions"><M3eButton onClick={close}>閉じる</M3eButton></div>
  </div>
}

export function openAppearance(): void {
  openSheet(close => <AppearanceSheet close={close} />, { label: '外観' })
}

export function confirmClassic(): void {
  openDialog(close => <>
    <h2>今の画面に戻す</h2>
    <p>この端末では DSH の標準の画面を使います。M3E の画面には、標準の画面の設定からいつでも戻れます</p>
    <div className="actions">
      <M3eButton variant="text" onClick={close}>キャンセル</M3eButton>
      <M3eButton onClick={() => { close(); backToClassic() }}>今の画面に戻す</M3eButton>
    </div>
  </>, { label: '今の画面に戻す確認' })
}
