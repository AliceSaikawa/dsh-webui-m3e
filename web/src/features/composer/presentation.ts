/** Use stable API identifiers; display names can be customized by the host. */
export function commandIcon(name: string): string {
  switch (name) {
    case 'plan': return 'checklist'
    case 'permission': return 'shield'
    case 'model': return 'smart_toy'
    default: return 'terminal'
  }
}

export function modelIcon(provider: string): string {
  return provider.toLowerCase() === 'ollama' ? 'dns' : 'smart_toy'
}

export function permissionIcon(value: string): string {
  return value === 'danger-full-access' ? 'warning' : 'shield'
}
