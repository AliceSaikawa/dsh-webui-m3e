/**
 * Boot the DSH client transport without the stock UI.
 *
 * The Host injects `window.__ModuleLoader__` and the `__DSH_BOOT__` graph into
 * every index it renders. The stock shell hands the whole graph (about 50
 * plugins, most of them React UI) to the module system. This boot keeps only
 * the transport plugins and their inject closure (see ./boot-graph.ts).
 */
import * as cordis from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import { type BootGraph, narrowBootGraph } from './boot-graph.ts'
import { missingContractMembers } from './contract.ts'
import { classifyBootFailure } from '../../../src/shared/dsh-compat.ts'

interface ModuleSystem {
  manifest: { plugins: { id: string }[] }
  importError(id: string): Error | undefined
}

interface BootGlobals {
  __DSH_BOOT__?: BootGraph
  __ModuleLoader__?: {
    create(options: { boot: BootGraph; staticModules: Record<string, unknown> }): ModuleSystem
  }
}

/** Transport plugins this UI talks through; everything else in the graph is stock UI. */
export const TRANSPORT_PLUGINS = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-job-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-client-file-upload',
]

/**
 * Shared libraries the stock shell provides to plugin bundles as externals.
 * Only the ones the transport plugins require are listed; versions must match
 * the Host's DSH release (pinned in src/shared/dsh-compat.ts).
 */
const STATIC_MODULES: Record<string, unknown> = {
  '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-client-store': clientStore,
}

/**
 * Create the client Cordis context and activate the transport plugins.
 * @returns the root context once every kept plugin is active.
 */
export async function bootDsh(): Promise<cordis.Context> {
  const globals = globalThis as BootGlobals
  const graph = globals.__DSH_BOOT__
  const facade = globals.__ModuleLoader__
  if (graph === undefined || facade === undefined) {
    throw new Error('webui-m3e: this page was not rendered by the DSH Host (no boot graph)')
  }

  const modules = facade.create({ boot: narrowBootGraph(graph, TRANSPORT_PLUGINS), staticModules: STATIC_MODULES })
  const ctx = new cordis.Context()
  await ctx.plugin(Loader)
  const loader = (ctx as unknown as { loader: LoaderFace }).loader
  loader.internal = modules
  await Promise.all(modules.manifest.plugins.map((plugin) => loader.create({ name: plugin.id })))
  await loader.await()

  await assertPluginsActive(modules, loader.entries())
  const missing = missingContractMembers(ctx)
  if (missing.length > 0) throw new Error(`webui-m3e: the DSH client lacks ${missing.join(', ')}`)
  return ctx
}

/** Fiber state value for an active plugin (cordis FiberState.ACTIVE). */
const ACTIVE = 2

interface BootPluginEntry {
  options: { name: string }
  fiber?: { state: number; await(): Promise<unknown> }
}

/**
 * Loader 1.0.5 waits with allSettled and no longer throws import failures.
 * Recover the actual cause before diagnosing an inactive graph as incompatible:
 * a failed download or plugin runtime error must retain its retry guidance.
 */
export async function assertPluginsActive(modules: Pick<ModuleSystem, 'importError'>, entries: Iterable<BootPluginEntry>): Promise<void> {
  const inactive = [...entries].filter(entry => entry.fiber?.state !== ACTIVE)
  const failures: Error[] = []
  for (const entry of inactive) {
    const error = modules.importError(entry.options.name)
    if (error !== undefined) {
      failures.push(error)
    } else if (entry.fiber !== undefined) {
      try { await entry.fiber.await() }
      catch (error) { failures.push(error instanceof Error ? error : new Error(String(error))) }
    }
  }
  // A simultaneous shape error is not evidence that a transport failure is a
  // version mismatch. Prefer an unclassified cause if there is one.
  if (failures.length > 0) throw failures.find(error => classifyBootFailure(error.message) === 'unknown') ?? failures[0]!
  if (inactive.length > 0) throw new Error(`webui-m3e: plugins did not activate: ${inactive.map(entry => entry.options.name).join(', ')}`)
}

interface LoaderFace {
  internal: unknown
  create(options: { name: string }): Promise<string>
  await(): Promise<void>
  entries(): Iterable<BootPluginEntry>
}
