/** Own only chat sheets; an approval or a different conversation has another owner. */
export function createChatSheetLifetime() {
  let active = true
  const sheets = new Set<() => void>()
  return {
    isActive: () => active,
    activate: () => { active = true },
    track: (close: () => void): (() => void) => {
      if (!active) { close(); return () => {} }
      const ownedClose = () => {
        if (!sheets.delete(ownedClose)) return
        close()
      }
      sheets.add(ownedClose)
      return ownedClose
    },
    dispose: () => {
      active = false
      for (const close of [...sheets]) close()
    },
  }
}
