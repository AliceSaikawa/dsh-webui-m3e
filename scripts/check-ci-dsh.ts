import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixture = '.github/ci/dsh'
const installed = 'tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai'
const manifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(fixture, 'package-lock.json'), 'utf8'))
assert.equal(manifest.dependencies['@deepseek-ai/dsh'], '0.2.0-rc.2')
assert.equal(lock.packages[''].dependencies['@deepseek-ai/dsh'], '0.2.0-rc.2')
const release = lock.packages['node_modules/@deepseek-ai/dsh']
assert.equal(release.version, '0.2.0-rc.2')
assert.equal(release.resolved, 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz')
assert.equal(release.integrity, 'sha512-EAJ3gPNcVt/uv8X19PMm9NkVhWgT7xXNMk0UKCVm+IQ5rpSQOcsMUa0HWlnYYVybKMsccjcRB21vVVsaXQ6IdA==')
for (const [path, entry] of Object.entries(lock.packages) as [string, { version?: string; resolved?: string; integrity?: string }][]) {
  if (!path) continue
  assert.ok(entry.version && entry.resolved?.startsWith('https://registry.npmjs.org/') && entry.integrity,
    `Dependency is not pinned to public npm with integrity: ${path}`)
}
for (const name of ['dsh', 'dsh-llm', 'dsh-agent-default-model', 'dsh-settings']) {
  assert.equal(JSON.parse(readFileSync(join(installed, name, 'package.json'), 'utf8')).version, '0.2.0-rc.2')
}
for (const file of ['dsh-llm/lib/types/assembler.js', 'dsh-agent-default-model/lib/index.js', 'dsh-settings/lib/index.js']) {
  assert.ok(existsSync(join(installed, file)), `Missing native contract code: ${file}`)
}
console.log('DSH 0.2.0-rc.2: public integrity-pinned distribution and native contract code present')
