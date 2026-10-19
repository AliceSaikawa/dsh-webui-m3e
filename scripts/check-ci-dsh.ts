import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPPORTED_DSH_VERSION } from '../src/shared/dsh-compat.ts'

// The release under test is read from the one place it is defined so the
// fixture, the install path and these checks cannot drift apart again.
const version = SUPPORTED_DSH_VERSION
const fixture = '.github/ci/dsh'
const installed = `tmp/dsh-integration/dsh-${version}/node_modules/@deepseek-ai`
// The dsh tarball's integrity is pinned by value: it is the tamper check CI
// runs after a cache hit, so it cannot be derived from the version. Keep it in
// step with `npm view @deepseek-ai/dsh@<version> dist.integrity` when the
// release moves.
const DSH_INTEGRITY = 'sha512-tvY+yhfKRifthbqPe/OK0AYxM5ZkvqfYq/jMYgJcEUxiRRL1Vwra3Ti5TB6AXgSWQdiPHYh/Vp6SJa9yHwMNuw=='
const manifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(fixture, 'package-lock.json'), 'utf8'))
assert.equal(manifest.dependencies['@deepseek-ai/dsh'], version)
assert.equal(lock.packages[''].dependencies['@deepseek-ai/dsh'], version)
const release = lock.packages['node_modules/@deepseek-ai/dsh']
assert.equal(release.version, version)
assert.equal(release.resolved, `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`)
assert.equal(release.integrity, DSH_INTEGRITY, `dsh ${version} integrity changed; refresh DSH_INTEGRITY from npm view`)
for (const [path, entry] of Object.entries(lock.packages) as [string, { version?: string; resolved?: string; integrity?: string }][]) {
  if (!path) continue
  assert.ok(entry.version && entry.resolved?.startsWith('https://registry.npmjs.org/') && entry.integrity,
    `Dependency is not pinned to public npm with integrity: ${path}`)
}
for (const name of ['dsh', 'dsh-llm', 'dsh-agent-default-model', 'dsh-settings']) {
  assert.equal(JSON.parse(readFileSync(join(installed, name, 'package.json'), 'utf8')).version, version)
}
for (const file of ['dsh-llm/lib/types/assembler.js', 'dsh-agent-default-model/lib/index.js', 'dsh-settings/lib/index.js']) {
  assert.ok(existsSync(join(installed, file)), `Missing native contract code: ${file}`)
}
console.log(`DSH ${version}: public integrity-pinned distribution and native contract code present`)
