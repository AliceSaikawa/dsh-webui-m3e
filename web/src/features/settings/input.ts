export interface SettingInputState<T> {
  value: T
  dirty: boolean
  saving: boolean
  saved: boolean
  notice?: string
}
export type InputSaveResult<T> = { ok: true; value: T } | { ok: false }

/** Keeps the editable draft separate from responses to earlier saves. */
export function createSettingInput<T>(initial: T, options: {
  save(value: T, reset: boolean): Promise<InputSaveResult<T>>
  canSave(): boolean
  canChange?(): boolean
  changed?(): void
}) {
  let state: SettingInputState<T> = { value: initial, dirty: false, saving: false, saved: false }
  let baseline = initial
  let version = 0
  let resetting = false
  let active = true
  let pending: Promise<void> | undefined
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<SettingInputState<T>>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function drain() {
    const lifetime = epoch
    try {
      while (lifetime === epoch && active && state.dirty && !state.notice && options.canSave()) {
        const sentVersion = version
        const value = state.value
        const reset = resetting
        publish({ saving: true, saved: false })
        let result: InputSaveResult<T>
        try { result = await options.save(value, reset) } catch { result = { ok: false } }
        if (lifetime !== epoch) return
        if (result.ok) baseline = result.value
        if (sentVersion === version) {
          if (!result.ok) break
          resetting = false
          publish({ value: result.value, dirty: false, saved: true })
        } else {
          // Even returning to the original value needs a save when an earlier
          // in-flight edit has already changed the server's value.
          publish({ dirty: resetting || !Object.is(state.value, baseline), saved: false })
        }
      }
    } finally { if (lifetime === epoch) publish({ saving: false }) }
  }
  function flush(): Promise<void> {
    clearTimeout(timer); timer = undefined
    if (pending) return pending
    if (!active || !state.dirty || state.notice || !options.canSave()) return Promise.resolve()
    const request = drain().finally(() => { if (pending === request) pending = undefined })
    pending = request
    return pending
  }
  function change(value: T) {
    if (options.canChange?.() === false) return false
    version++
    resetting = false
    options.changed?.()
    publish({ value, dirty: state.saving || !Object.is(value, baseline), saved: false,
      ...(state.notice ? { notice: undefined } : {}) })
    return true
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setActive(value: boolean) { active = value; if (!value) { clearTimeout(timer); timer = undefined } },
    change,
    changeDeferred(value: T) { if (!change(value)) return; clearTimeout(timer); timer = setTimeout(() => { void flush() }, 600) },
    receive(value: T) {
      baseline = value
      if (state.notice && !resetting && Object.is(state.value, value)) {
        publish({ dirty: false, saved: true, notice: undefined })
      }
      if (!state.dirty && !state.saving) publish({ value, saved: state.saved && Object.is(value, state.value) })
    },
    interrupt(notice: string) {
      epoch++; pending = undefined; clearTimeout(timer); timer = undefined
      if (state.dirty || state.saving) publish({ dirty: true, saving: false, saved: false, notice })
    },
    replace(value: T) {
      epoch++; version++; pending = undefined; clearTimeout(timer); timer = undefined
      baseline = value; resetting = false
      state = { value, dirty: false, saving: false, saved: false }
      listeners.forEach(listener => listener())
    },
    retry() {
      if (!active || !options.canSave()) return Promise.resolve()
      if (state.notice) publish({ notice: undefined })
      return flush()
    },
    reset() {
      if (options.canChange?.() === false) return Promise.resolve()
      version++
      resetting = true
      options.changed?.()
      publish({ dirty: true, saved: false, ...(state.notice ? { notice: undefined } : {}) })
      return flush()
    },
    flush,
  }
}
