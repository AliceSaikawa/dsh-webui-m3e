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

const PERMISSION_ICONS: Readonly<Record<string, string>> = {
  'read-only': 'visibility',
  'workspace-write': 'edit_document',
  // Full access and the experimental Auto preset both run without a sandbox.
  'danger-full-access': 'warning',
  auto: 'gpp_maybe',
}

/**
 * Glyph for a permission preset, by its stable value. The four built-in presets
 * have their own; a custom value, a preset the Host added, and a preset that is
 * not loaded yet (undefined) keep the plain shield.
 */
export function permissionIcon(value?: string): string {
  return value !== undefined && Object.hasOwn(PERMISSION_ICONS, value) ? PERMISSION_ICONS[value]! : 'shield'
}
