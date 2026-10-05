/**
 * The DSH release this plugin is built against, in one place.
 *
 * The M3E page boots the Host's transport plugins with shared libraries it
 * bundles itself (web/src/dsh/boot.ts), so those libraries must be the exact
 * versions the Host's release ships. When DSH moves to a new release, update
 * this file and package.json together; tests/dsh-compat.test.ts keeps them in
 * step, and docs/dsh-compatibility.md lists every other boundary to re-check.
 */

/** Supported DSH release, including the migrated boot and Session reference contracts. */
export const SUPPORTED_DSH_VERSION = '0.2.0-rc.2'

/**
 * Shared libraries bundled into the M3E page and the exact versions the
 * supported release ships. A mismatch can load, then fail inside a plugin.
 */
export const PINNED_DSH_LIBRARIES = {
  '@deepseek-ai/cordis': '4.0.4',
  '@deepseek-ai/cordis-plugin-loader': '1.0.5',
  '@deepseek-ai/dsh-client-store': '0.2.0-rc.2',
} as const

/** How a failed boot is explained; see describeBootFailure. */
export type BootFailureKind = 'not-host' | 'incompatible' | 'unknown'

/**
 * Classify a boot error. Only failures at the boot contract itself (graph
 * shape, module loader, plugin activation) are called incompatible; anything
 * else stays unknown so a transient fault is not blamed on the DSH release.
 * @param message - the thrown error's message.
 */
export function classifyBootFailure(message: string): BootFailureKind {
  if (message.includes('no boot graph')) return 'not-host'
  // Contract-shape errors only; a bundle that fails to download stays unknown.
  if (/webui-m3e: (the Host boot graph has no |plugins did not activate|the DSH client lacks )|client-modules: (HTML did not preload|boot manifest|no registered factory|cannot resolve)/.test(message)) return 'incompatible'
  return 'unknown'
}
