import { M3eSnackbar } from '@m3e/react/snackbar'
import { currentLocale, messagesOf } from '../../i18n/index.ts'
import { overlayMessages } from '../messages.ts'
export { openSheet, openFullSheet, openDialog, useOverlays, type CloseOverlay, type OverlayRender, type SheetOptions, type OverlayOwner } from './store.ts'
export { OverlayHost } from './OverlayHost.tsx'
export { OverlayRouteScope } from './OverlayRouteScope.tsx'
export { TextPromptDialog, type TextPromptDialogProps } from './TextPromptDialog.tsx'
export function showSnackbar(message: string): void { M3eSnackbar.open(message, true, { closeLabel: messagesOf(overlayMessages, currentLocale()).close, duration: 5000 }) }
