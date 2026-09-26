interface TraceSheetOwner { current: (() => void) | undefined }

/** Release only the close handle returned for this trace's own record sheet. */
export function closeTraceSheet(owner: TraceSheetOwner): void {
  const close = owner.current
  owner.current = undefined
  close?.()
}
