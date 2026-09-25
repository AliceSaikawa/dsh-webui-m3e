import { M3eSnackbar } from '@m3e/react/snackbar'
export { openSheet, openFullSheet, openDialog, useOverlays, type CloseOverlay, type OverlayRender, type SheetOptions } from './store.ts'
export { OverlayHost } from './OverlayHost.tsx'
export { TextPromptDialog, type TextPromptDialogProps } from './TextPromptDialog.tsx'
export function showSnackbar(message: string): void { M3eSnackbar.open(message, true, { closeLabel: '閉じる', duration: 5000 }) }
