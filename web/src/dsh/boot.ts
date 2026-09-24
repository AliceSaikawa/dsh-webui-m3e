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

interface ModuleSystem {
  manifest: { plugins: { id: string }[] }
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
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-client-file-upload',
]

/**
 * Shared libraries the stock shell provides to plugin bundles as externals.
 * Only the ones the transport plugins require are listed; versions must match
 * the Host's DSH release.
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

  const inactive = [...loader.entries()]
    .filter((entry) => entry.fiber === undefined || entry.fiber.state !== ACTIVE)
    .map((entry) => entry.options.name)
  if (inactive.length > 0) throw new Error(`webui-m3e: plugins did not activate: ${inactive.join(', ')}`)
  return ctx
}

/** Fiber state value for an active plugin (cordis FiberState.ACTIVE). */
const ACTIVE = 2

interface LoaderFace {
  internal: unknown
  create(options: { name: string }): Promise<string>
  await(): Promise<void>
  entries(): Iterable<{ options: { name: string }; fiber?: { state: number } }>
}
