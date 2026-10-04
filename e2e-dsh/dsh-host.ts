/**
 * Boot a real DSH web profile with this plugin installed, isolated from the
 * user's own DSH: a fresh DSH_HOME and HOME under tmp/, a loopback-only bind,
 * and the scripted fake model from ./fake-llm.ts as its only LLM endpoint.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_DSH_VERSION } from '../src/shared/dsh-compat.ts'

export const root = fileURLToPath(new URL('../', import.meta.url))
const work = join(root, 'tmp', 'dsh-integration')

/** The DSH release under test: M3E_DSH_VERSION, or the release this plugin pins. */
export const dshVersion = process.env.M3E_DSH_VERSION ?? SUPPORTED_DSH_VERSION

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] })
}

/** M3E_DSH_DIR points at an existing install; otherwise the exact release is installed under tmp/. */
function dshInstall(): string {
  const given = process.env.M3E_DSH_DIR
  if (given) return given
  const dir = join(work, `dsh-${dshVersion}`)
  if (!existsSync(join(dir, 'node_modules', '.bin', 'dsh'))) {
    mkdirSync(dir, { recursive: true })
    run('npm', ['install', '--no-audit', '--no-fund', '--prefix', dir, `@deepseek-ai/dsh@${dshVersion}`], dir)
  }
  return dir
}

/** The plugin is installed from the same tarball a user would build. */
function packPlugin(): string {
  if (process.env.M3E_SKIP_BUILD !== '1') run('pnpm', ['build'], root)
  const out = join(work, 'pack')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  run('pnpm', ['pack', '--pack-destination', out], root)
  const tarball = readdirSync(out).find(name => name.endsWith('.tgz'))
  if (!tarball) throw new Error('dsh-integration: pnpm pack produced no tarball')
  return join(out, tarball)
}

export interface DshHost {
  readonly version: string
  /** Host origin, such as http://127.0.0.1:41234. */
  readonly origin: string
  /** One-time login URL printed by `dsh web`. */
  readonly loginUrl: string
  /** The folder the directory picker opens first; tests add it as their Workspace. */
  readonly workspace: string
  stop(): Promise<void>
  /** Stop and boot again on the same port and DSH_HOME, for reconnect tests. */
  restart(): Promise<void>
}

export async function startDsh(llmUrl: string, options: { timedQuestionSeconds?: number } = {}): Promise<DshHost> {
  const install = dshInstall()
  const actual = JSON.parse(readFileSync(join(install, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version as string
  // Keep only this run's DSH_HOME; earlier runs are evidence in the report, not state.
  if (existsSync(work)) for (const name of readdirSync(work)) if (name.startsWith('run-')) rmSync(join(work, name), { recursive: true, force: true })
  const runDir = join(work, `run-${Date.now()}`)
  const home = join(runDir, 'home')
  const dshHome = join(runDir, 'dsh-home')
  mkdirSync(home, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    DSH_HOME: dshHome,
    // Keep npm's cache where it already is; only HOME is isolated.
    npm_config_cache: process.env.npm_config_cache ?? join(process.env.HOME ?? root, '.npm'),
    DEEPSEEK_API_KEY: 'fake-key-for-m3e-integration',
    DEEPSEEK_BASE_URL: llmUrl,
    // Match a remote Host used from a smartphone: select browse even on macOS,
    // while keeping the integration Host bound only to 127.0.0.1.
    SSH_CONNECTION: 'm3e-integration',
  }
  const bin = join(install, 'node_modules', '.bin', 'dsh')
  run(bin, ['plugin', '--profile', 'web', 'add', `file:${packPlugin()}`], install, env)
  if (options.timedQuestionSeconds !== undefined) {
    // A separate preset in this run's isolated home. The stock tool Config's
    // mode/timeout fields are not volatile settings, so configure at boot.
    writeFileSync(join(dshHome, 'cordis.patch.yml'), JSON.stringify([
      { insert: [{ id: 'preset-timed-test', name: '@deepseek-ai/dsh-agent-preset', config: {
        id: 'timed-test', plugins: [{ id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'timed', timeout: options.timedQuestionSeconds } }],
      } }] },
      { id: 'agent-preset-registry', config: { default: 'timed-test' } },
    ]))
  }

  let child: ChildProcess | undefined
  let port = 0
  let loginUrl = ''
  const boot = () => new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, ['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], { cwd: install, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    let output = ''
    const timer = setTimeout(() => reject(new Error(`dsh-integration: DSH did not print its URL\n${output}`)), 60_000)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const match = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/\?token=\S+)/.exec(output)
      if (match) { clearTimeout(timer); loginUrl = match[1]!; port = Number(match[2]); resolve() }
    }
    proc.stdout!.on('data', onData)
    proc.stderr!.on('data', onData)
    proc.on('exit', code => { clearTimeout(timer); if (!loginUrl) reject(new Error(`dsh-integration: DSH exited (${code})\n${output}`)) })
  })
  const stop = () => new Promise<void>(resolve => {
    const proc = child
    child = undefined
    if (!proc || proc.exitCode !== null) { resolve(); return }
    proc.once('exit', () => resolve())
    proc.kill('SIGTERM')
    setTimeout(() => proc.kill('SIGKILL'), 10_000).unref()
  })
  await boot()
  return {
    version: actual,
    get origin() { return `http://127.0.0.1:${port}` },
    get loginUrl() { return loginUrl },
    workspace: home,
    stop,
    async restart() { await stop(); loginUrl = ''; await boot() },
  }
}
