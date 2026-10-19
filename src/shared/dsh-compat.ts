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

/**
 * Name of the `<meta>` the Host half adds to the index. Its content is the
 * page entry script (`/m3e/assets/index-<hash>.js`) of the dist that Host half
 * was built with.
 */
export const HOST_BUILD_META = 'dsh-webui-m3e-host'

/**
 * Whether the index was rendered by a Host half built with a different page.
 *
 * DSH serves the new `dist/` as soon as the plugin is replaced on disk, but
 * keeps running the Host half it imported until it restarts. A 0.0.7 Host
 * half in front of a 0.0.8 page leaves the stock bootstrap ahead of `<base>`,
 * so the module loader fails before any version check; this tells that apart.
 * @param hostEntry - content of the {@link HOST_BUILD_META} meta; missing on Host halves older than this check.
 * @param pageEntryUrl - `import.meta.url` of the running page entry.
 */
export function isStaleHostHalf(hostEntry: string | null | undefined, pageEntryUrl: string): boolean {
  if (!hostEntry) return true
  try {
    return new URL(pageEntryUrl).pathname !== hostEntry
  } catch {
    return true
  }
}

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
