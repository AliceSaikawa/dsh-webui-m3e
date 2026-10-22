import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import type { FileAttachmentRef, ImageAttachmentRef, SessionFace } from '../../dsh/services.ts'
import { formatNumber, useLocale, useMessages } from '../../i18n/index.ts'
import { attachmentMessages } from './messages.ts'
import { useChatSheets } from './ChatSheets.tsx'

export function FileAttachment({ attachment }: { attachment: FileAttachmentRef }) {
  const text = useMessages(attachmentMessages)
  const locale = useLocale()
  const size = (value: number, maximumFractionDigits: number) =>
    formatNumber(locale, value, { minimumFractionDigits: 1, maximumFractionDigits, useGrouping: false })
  const bytes = Math.max(0, attachment.bytes)
  const formatted = bytes < 1024 ? text.bytes(formatNumber(locale, bytes, { useGrouping: false }))
    : bytes < 1024 * 1024 ? text.kilobytes(size(bytes / 1024, 1)) : text.megabytes(size(bytes / (1024 * 1024), 1))
  return <span className="chat-file"><Icon name="attach_file" /><span>{attachment.name}<small>{formatted}</small></span></span>
}

function ImageSheet({ name, close, trigger, children }: { name: string; close(): void; trigger: HTMLButtonElement; children: ReactNode }) {
  const text = useMessages(attachmentMessages)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewer = root.current
    const sheet = viewer?.closest('m3e-bottom-sheet')
    let frame = 0
    const focusHeading = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!sheet?.matches(':popover-open') || sheet.hidden || sheet.inert) return
        if (document.activeElement && root.current?.contains(document.activeElement)) return
        root.current?.querySelector('h2')?.focus({ preventScroll: true })
      })
    }
    // Opening, including return from an interrupting sheet, happens after mount.
    // Preserve M3E's capture of the trigger and do not steal focus within us.
    sheet?.addEventListener('opened', focusHeading)
    sheet?.addEventListener('toggle', focusHeading)
    focusHeading()
    return () => {
      cancelAnimationFrame(frame)
      sheet?.removeEventListener('opened', focusHeading)
      sheet?.removeEventListener('toggle', focusHeading)
      // The overlay retains this component until native teardown finishes.
      // Restore only a still-visible trigger, and never steal focus from a new
      // surface or a destination route when the image was closed by navigation.
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active !== document.body && active && !viewer?.contains(active)) return
        if (trigger.isConnected && trigger.getClientRects().length && !trigger.closest('[hidden], [inert]')) trigger.focus({ preventScroll: true })
      })
    }
  }, [trigger])
  return <div className="chat-image-full" ref={root}><header>
    <h2 tabIndex={-1} ref={heading => { heading?.setAttribute('autofocus', '') }}>{name}</h2>
    <M3eButton onClick={close}>{text.close}</M3eButton>
  </header>{children}</div>
}

export function PreviewImage({ url, name, beforeExpand }: { url: string; name?: string; beforeExpand?: () => void }) {
  const text = useMessages(attachmentMessages)
  const sheets = useChatSheets()
  const label = name ?? text.defaultName
  const expand = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget
    beforeExpand?.()
    sheets.openFull(close => <ImageSheet name={label} close={close} trigger={trigger}>
      <img src={url} alt={label} /></ImageSheet>, { label: text.previewLabel })
  }
  return <button type="button" className="chat-image-button" onClick={expand} aria-label={text.openFull(label)}>
    <img src={url} alt={label} /><span><Icon name="open_in_full" />{text.expand}</span>
  </button>
}

/** Each viewer owns its object URL, so closing a parent sheet cannot revoke it. */
export function AttachmentImage({ attachment, face, full = false, beforeExpand }: {
  attachment: ImageAttachmentRef; face?: SessionFace; full?: boolean; beforeExpand?: () => void
}) {
  const text = useMessages(attachmentMessages)
  const sheets = useChatSheets()
  const [source, setSource] = useState<{ id: string; url: string }>()
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let url: string | undefined
    setFailed(false)
    setSource(undefined)
    if (!face) { setFailed(true); return }
    void face.readAttachment(attachment.attachmentId).then(result => {
      if (!active) return
      if (!result.ok) { setFailed(true); return }
      url = URL.createObjectURL(new Blob([new Uint8Array(result.value.data)], { type: result.value.attachment.mediaType }))
      setSource({ id: attachment.attachmentId, url })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [face, attachment.attachmentId, retry])
  const name = attachment.name ?? text.defaultName
  if (failed) return <div className="chat-image-status"><span>{text.loadFailed}</span><M3eButton onClick={() => setRetry(value => value + 1)}>{text.retry}</M3eButton></div>
  if (!source || source.id !== attachment.attachmentId) return <div className="chat-image-status" role="status">{text.loading}</div>
  if (full) return <img src={source.url} alt={name} onError={() => setFailed(true)} />
  const expand = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget
    beforeExpand?.()
    sheets.openFull(close => <ImageSheet name={name} close={close} trigger={trigger}>
      <AttachmentImage attachment={attachment} face={face} full /></ImageSheet>, { label: text.previewLabel })
  }
  return <button type="button" className="chat-image-button" onClick={expand} aria-label={text.openFull(name)}>
    <img src={source.url} alt={name} width={attachment.width} height={attachment.height} onError={() => setFailed(true)} />
    <span><Icon name="open_in_full" />{text.expand}</span>
  </button>
}
