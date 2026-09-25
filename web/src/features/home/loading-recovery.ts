// Pending alone is not a failure. Offer recovery only after a sustained wait.
export function scheduleLoadingRecovery(loading: boolean, onChange: (delayed: boolean) => void) {
  onChange(false)
  if (!loading) return
  const timer = setTimeout(() => onChange(true), 8_000)
  return () => clearTimeout(timer)
}
