import { useEffect, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { Icon } from '../../app/icons/Icon.tsx'
import { openFullSheet } from '../../app/overlay/index.ts'
import type { FileAttachmentRef, ImageAttachmentRef, SessionFace } from '../../dsh/services.ts'

export function FileAttachment({ attachment }: { attachment: FileAttachmentRef }) {
  const bytes = Math.max(0, attachment.bytes)
  const size = bytes < 1024 ? `${bytes} バイト` : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return <span className="chat-file"><Icon name="attach_file" /><span>{attachment.name}<small>{size}</small></span></span>
}

export function PreviewImage({ url, name = '添付画像', beforeExpand }: { url: string; name?: string; beforeExpand?: () => void }) {
  const expand = () => {
    beforeExpand?.()
    openFullSheet(close => <div className="chat-image-full"><header><h2>{name}</h2><M3eButton onClick={close}>閉じる</M3eButton></header>
      <img src={url} alt={name} /></div>, { label: '画像の表示' })
  }
  return <button type="button" className="chat-image-button" onClick={expand} aria-label={`${name}を全画面で表示`}>
    <img src={url} alt={name} /><span><Icon name="open_in_full" />画像を拡大</span>
  </button>
}

/** Each viewer owns its object URL, so closing a parent sheet cannot revoke it. */
export function AttachmentImage({ attachment, face, full = false, beforeExpand }: {
  attachment: ImageAttachmentRef; face?: SessionFace; full?: boolean; beforeExpand?: () => void
}) {
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
  const name = attachment.name ?? '添付画像'
  if (failed) return <div className="chat-image-status"><span>画像を読み込めませんでした。</span><M3eButton onClick={() => setRetry(value => value + 1)}>再読み込み</M3eButton></div>
  if (!source || source.id !== attachment.attachmentId) return <div className="chat-image-status" role="status">画像を読み込んでいます…</div>
  if (full) return <img src={source.url} alt={name} onError={() => setFailed(true)} />
  const expand = () => {
    beforeExpand?.()
    openFullSheet(close => <div className="chat-image-full"><header><h2>{name}</h2><M3eButton onClick={close}>閉じる</M3eButton></header>
      <AttachmentImage attachment={attachment} face={face} full /></div>, { label: '画像の表示' })
  }
  return <button type="button" className="chat-image-button" onClick={expand} aria-label={`${name}を全画面で表示`}>
    <img src={source.url} alt={name} width={attachment.width} height={attachment.height} onError={() => setFailed(true)} />
    <span><Icon name="open_in_full" />画像を拡大</span>
  </button>
}
