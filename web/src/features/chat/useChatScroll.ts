import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { SessionFace } from '../../dsh/services.ts'
import { isNearBottom, preservePrependScroll } from './model.ts'

interface ScrollAnchor { key?: string; offset: number; scrollTop: number; scrollHeight: number; clientHeight: number }

function captureAnchor(node: HTMLDivElement): ScrollAnchor {
  const top = node.getBoundingClientRect().top
  const visible = [...node.querySelectorAll<HTMLElement>('[data-chat-key]')].find(row => row.getBoundingClientRect().bottom > top)
  return { key: visible?.dataset.chatKey, offset: (visible?.getBoundingClientRect().top ?? top) - top,
    scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }
}

function restoreAnchor(node: HTMLDivElement, saved: ScrollAnchor, prepend = false) {
  const row = [...node.querySelectorAll<HTMLElement>('[data-chat-key]')].find(item => item.dataset.chatKey === saved.key)
  if (row) node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset
  else if (prepend) node.scrollTop = preservePrependScroll(saved, node.scrollHeight)
}

export function useChatScroll({ face, revision, loadingOlder, hasMore, onLoadError }: {
  face?: SessionFace; revision: unknown; loadingOlder: boolean; hasMore: boolean; onLoadError: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const initialized = useRef(false)
  const loading = useRef(false)
  const anchor = useRef<ScrollAnchor | null>(null)
  const readingAnchor = useRef<ScrollAnchor | null>(null)
  const mounted = useRef(true)
  const [latestVisible, setLatestVisible] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const toLatest = useCallback(() => {
    const node = viewport.current
    following.current = true
    anchor.current = null
    setLatestVisible(false)
    if (node && node.clientHeight > 0) { node.scrollTop = node.scrollHeight; initialized.current = true }
  }, [])
  const stopFollowing = () => {
    following.current = false
    if (viewport.current) readingAnchor.current = captureAnchor(viewport.current)
    setLatestVisible(true)
  }
  const loadOlder = async () => {
    const node = viewport.current
    if (!node || !face || loading.current || loadingOlder || !hasMore) return
    loading.current = true
    following.current = false
    setRequesting(true)
    anchor.current = captureAnchor(node)
    try { await face.loadOlder() } catch { if (mounted.current) onLoadError() }
    finally { if (mounted.current) { loading.current = false; setRequesting(false) } }
  }
  const onScroll = () => {
    const node = viewport.current
    if (!node || !initialized.current || node.clientHeight === 0 || anchor.current) return
    // Once the reader moves away, resume only when they return to the actual end.
    following.current = isNearBottom(node, following.current ? 64 : 4)
    readingAnchor.current = captureAnchor(node)
    setLatestVisible(!following.current)
    if (node.scrollTop <= 24 && !following.current) void loadOlder()
  }
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node || node.clientHeight === 0) return
    if (anchor.current) {
      if (requesting || loadingOlder) return
      restoreAnchor(node, anchor.current, true)
      anchor.current = null
      readingAnchor.current = captureAnchor(node)
      setLatestVisible(!isNearBottom(node))
    } else if (!initialized.current || following.current) toLatest()
  }, [revision, requesting, loadingOlder, toLatest])
  useLayoutEffect(() => {
    mounted.current = true
    const node = viewport.current
    const body = content.current
    if (!node || !body) return
    // Observe both: image loads grow the body, keyboard/tab changes resize the viewport.
    const observer = new ResizeObserver(() => {
      if (node.clientHeight === 0 || anchor.current) return
      if (!initialized.current || following.current) toLatest()
      else {
        // Older images may finish loading after the prepend itself has committed.
        if (readingAnchor.current) restoreAnchor(node, readingAnchor.current)
        readingAnchor.current = captureAnchor(node)
        setLatestVisible(!isNearBottom(node, 4))
      }
    })
    observer.observe(node)
    observer.observe(body)
    return () => { mounted.current = false; observer.disconnect() }
  }, [toLatest])
  return { viewport, content, latestVisible, requesting, onScroll, toLatest, loadOlder, stopFollowing }
}
