export interface FrameScheduler {
  request(callback: () => void): number
  cancel(handle: number): void
}

/** Writes values through one sink, where throttled writes coalesce to the latest one per frame. */
export interface FrameThrottledWriter<T> {
  /** Write at the next frame, replacing any value already waiting for it. */
  throttled(value: T): void
  /** Write now and drop the waiting value, so an older intent cannot override this one later. */
  immediate(value: T): void
  /** Write the waiting value now, if any; it is the latest intent because immediate writes drop it. */
  flush(): void
}

export function createFrameThrottledWriter<T>(write: (value: T) => void, scheduler: FrameScheduler): FrameThrottledWriter<T> {
  let pending: { frame: number; value: T } | undefined
  const take = () => {
    const last = pending
    pending = undefined
    if (last) scheduler.cancel(last.frame)
    return last
  }
  return {
    throttled(value) {
      if (pending) { pending.value = value; return }
      const entry = { frame: 0, value }
      entry.frame = scheduler.request(() => { pending = undefined; write(entry.value) })
      pending = entry
    },
    immediate(value) {
      take()
      write(value)
    },
    flush() {
      const last = take()
      if (last) write(last.value)
    },
  }
}
