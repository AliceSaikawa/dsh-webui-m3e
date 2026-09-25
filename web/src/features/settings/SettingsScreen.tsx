import { M3eButton } from '@m3e/react/button'
import { TabScaffold } from '../../app/shell/TabScaffold.tsx'
import { backToClassic } from '../../app/theme/index.ts'
export function SettingsScreen() { return <TabScaffold title="設定"><div className="page-padding"><p>設定画面の準備中です</p><M3eButton onClick={backToClassic}>今の画面に戻す</M3eButton></div></TabScaffold> }
