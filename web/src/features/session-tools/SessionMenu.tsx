import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openSheet } from '../../app/overlay/index.ts'

export function SessionMenuButton({ sessionId }: { sessionId: string }) {
  return <M3eIconButton aria-label="会話のメニュー" onClick={() => openSheet(close => <div data-session={sessionId}><h2>会話の操作</h2><p>準備中です</p><M3eButton onClick={close}>閉じる</M3eButton></div>, { label: '会話のメニュー' })}><Icon name="more_vert" /></M3eIconButton>
}
