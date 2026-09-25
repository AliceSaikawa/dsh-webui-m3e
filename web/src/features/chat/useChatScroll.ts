import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { SessionFace } from '../../dsh/services.ts'
import { isNearBottom, preservePrependScroll } from './model.ts'
import { canObserveChatScroll, decideChatScroll, enterChatVisibility, finishChatRestore, initialChatScrollState, shouldDiscardChatAnchor } from './scroll-policy.ts'

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

export function useChatScroll({ face, revision, active, ready, loadingOlder, hasMore, onLoadError }: {
  face?: SessionFace; revision: unknown; active: boolean; ready: boolean; loadingOlder: boolean; hasMore: boolean; onLoadError: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const state = useRef(initialChatScrollState)
  const loading = useRef(false)
  const anchor = useRef<ScrollAnchor | null>(null)
  const readingAnchor = useRef<ScrollAnchor | null>(null)
  const dimensions = useRef('')
  const mounted = useRef(true)
  const pendingError = useRef(false)
  const [latestVisible, setLatestVisible] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const toLatest = useCallback(() => {
    if (!active || !ready || !canObserveChatScroll(state.current)) return
    const node = viewport.current
    if (!node || node.clientHeight === 0) return
    state.current = { ...state.current, following: true }
    anchor.current = null
    setLatestVisible(false)
    node.scrollTop = node.scrollHeight
    readingAnchor.current = captureAnchor(node)
  }, [active, ready])
  const stopFollowing = () => {
    if (!active || !ready || !canObserveChatScroll(state.current)) return
    state.current = { ...state.current, following: false }
    if (viewport.current) readingAnchor.current = captureAnchor(viewport.current)
    setLatestVisible(true)
  }
  const loadOlder = async () => {
    if (!active || !ready || !canObserveChatScroll(state.current)) return
    const node = viewport.current
    if (!node || !face || loading.current || loadingOlder || !hasMore) return
    loading.current = true
    state.current = { ...state.current, following: false }
    setRequesting(true)
    anchor.current = captureAnchor(node)
    // The installed controller swallows remote pagination failures. This catch
    // can only report implementations that reject; no success/error is inferred.
    try { await face.loadOlder() } catch {
      if (mounted.current) {
        if (canObserveChatScroll(state.current)) onLoadError()
        else pendingError.current = true
      }
    }
    finally { if (mounted.current) { loading.current = false; setRequesting(false) } }
  }
  const onScroll = () => {
    if (!active || !ready || !canObserveChatScroll(state.current)) return
    const node = viewport.current
    if (!node || node.clientHeight === 0 || anchor.current) return
    // RetainedScrollPanel and our own writes also dispatch scroll events.
    if (readingAnchor.current?.scrollTop === node.scrollTop) return
    // Once the reader moves away, resume only when they return to the actual end.
    state.current = { ...state.current, following: isNearBottom(node, state.current.following ? 64 : 4) }
    readingAnchor.current = captureAnchor(node)
    setLatestVisible(!state.current.following)
    if (node.scrollTop <= 24 && !state.current.following) void loadOlder()
  }
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => {
    // No measurements while hidden. Initial positioning waits for open history.
    const node = viewport.current
    const transition = enterChatVisibility(state.current, active, ready && active && !!node && node.clientHeight > 0)
    state.current = transition.state
    if (shouldDiscardChatAnchor(active, state.current.restoring)) {
      anchor.current = null
      readingAnchor.current = null
    }
    if (!node || transition.action === 'suspend' || transition.action === 'wait') return
    if (transition.action === 'initialize') toLatest()
    if (transition.action !== 'resume') return
    // Child layout effects run before the parent's componentDidUpdate restore.
    // The first visible frame only adopts that restored position; it never writes.
    const frame = requestAnimationFrame(() => {
      if (!mounted.current || !state.current.active || !state.current.restoring) return
      if (node.clientHeight === 0) {
        state.current = { ...state.current, active: false, restoring: false }
        return
      }
      state.current = finishChatRestore(state.current, node)
      readingAnchor.current = captureAnchor(node)
      dimensions.current = `${node.scrollHeight}:${node.clientHeight}:${node.clientWidth}`
      setLatestVisible(!state.current.following)
      if (pendingError.current) { pendingError.current = false; onLoadError() }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, ready, toLatest])
  useLayoutEffect(() => {
    if (!active || !ready) return
    const decision = decideChatScroll(state.current, anchor.current !== null, requesting || loadingOlder)
    if (decision === 'none') return
    const node = viewport.current
    if (!node || node.clientHeight === 0) return
    if (decision === 'anchor' && anchor.current) {
      restoreAnchor(node, anchor.current, true)
      anchor.current = null
      readingAnchor.current = captureAnchor(node)
      setLatestVisible(!isNearBottom(node, 4))
    } else if (decision === 'bottom') toLatest()
  }, [revision, requesting, loadingOlder, active, ready, toLatest])
  useLayoutEffect(() => {
    if (!active || !ready) return
    const node = viewport.current
    const body = content.current
    if (!node || !body) return
    if (canObserveChatScroll(state.current)) dimensions.current = `${node.scrollHeight}:${node.clientHeight}:${node.clientWidth}`
    let observing = true
    // Observe both: image loads grow the body, keyboard/tab changes resize the viewport.
    const observer = new ResizeObserver(() => {
      if (!observing || node.clientHeight === 0) return
      // A visible panel may receive its first nonzero size after its layout effect.
      if (!state.current.active || !state.current.initialized) {
        const transition = enterChatVisibility(state.current, true, true)
        state.current = transition.state
        if (transition.action === 'initialize') toLatest()
        else if (transition.action === 'resume') {
          // ResizeObserver runs after the parent's commit and restoration.
          anchor.current = null
          state.current = finishChatRestore(state.current, node)
          readingAnchor.current = captureAnchor(node)
          setLatestVisible(!state.current.following)
          if (pendingError.current) { pendingError.current = false; onLoadError() }
        }
        dimensions.current = `${node.scrollHeight}:${node.clientHeight}:${node.clientWidth}`
        return
      }
      if (!canObserveChatScroll(state.current) || anchor.current) return
      const nextDimensions = `${node.scrollHeight}:${node.clientHeight}:${node.clientWidth}`
      // Ignore the observer's initial notification, especially after a tab restore.
      if (nextDimensions === dimensions.current) return
      dimensions.current = nextDimensions
      if (decideChatScroll(state.current, false, false) === 'bottom') toLatest()
      else {
        // Older images may finish loading after the prepend itself has committed.
        if (readingAnchor.current) restoreAnchor(node, readingAnchor.current)
        readingAnchor.current = captureAnchor(node)
        setLatestVisible(!isNearBottom(node, 4))
      }
    })
    observer.observe(node)
    observer.observe(body)
    return () => { observing = false; observer.disconnect() }
  }, [active, ready, toLatest])
  return { viewport, content, latestVisible, requesting, onScroll, toLatest, loadOlder, stopFollowing }
}
