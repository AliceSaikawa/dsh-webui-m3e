export interface SettingInputState<T> {
  value: T
  dirty: boolean
  saving: boolean
  saved: boolean
}
export type InputSaveResult<T> = { ok: true; value: T } | { ok: false }

/** Keeps the editable draft separate from responses to earlier saves. */
export function createSettingInput<T>(initial: T, options: {
  save(value: T, reset: boolean): Promise<InputSaveResult<T>>
  canSave(): boolean
}) {
  let state: SettingInputState<T> = { value: initial, dirty: false, saving: false, saved: false }
  let baseline = initial
  let version = 0
  let resetting = false
  let active = true
  let pending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<SettingInputState<T>>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function drain() {
    try {
      while (active && state.dirty && options.canSave()) {
        const sentVersion = version
        const value = state.value
        const reset = resetting
        publish({ saving: true, saved: false })
        let result: InputSaveResult<T>
        try { result = await options.save(value, reset) } catch { result = { ok: false } }
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
    } finally { publish({ saving: false }) }
  }
  function flush(): Promise<void> {
    if (pending) return pending
    if (!active || !state.dirty || !options.canSave()) return Promise.resolve()
    pending = drain().finally(() => { pending = undefined })
    return pending
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setActive(value: boolean) { active = value },
    change(value: T) {
      version++
      resetting = false
      publish({ value, dirty: state.saving || !Object.is(value, baseline), saved: false })
    },
    receive(value: T) {
      baseline = value
      if (!state.dirty && !state.saving) publish({ value, saved: state.saved && Object.is(value, state.value) })
    },
    reset() {
      version++
      resetting = true
      publish({ dirty: true, saved: false })
      return flush()
    },
    flush,
  }
}
