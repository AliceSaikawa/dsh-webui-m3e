import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyBootFailure, PINNED_DSH_LIBRARIES, SUPPORTED_DSH_VERSION } from '../src/shared/dsh-compat.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: Record<string, string> }

test('bundled DSH libraries are pinned to the exact versions the supported release ships', () => {
  for (const [name, version] of Object.entries(PINNED_DSH_LIBRARIES)) {
    assert.equal(manifest.devDependencies[name], version, name)
  }
  // dsh-client-store is released in lockstep with DSH itself.
  assert.equal(PINNED_DSH_LIBRARIES['@deepseek-ai/dsh-client-store'], SUPPORTED_DSH_VERSION)
})

test('every @deepseek-ai package the build uses is covered by the compatibility pins', () => {
  const used = Object.keys(manifest.devDependencies).filter(name => name.startsWith('@deepseek-ai/')).sort()
  assert.deepEqual(used, Object.keys(PINNED_DSH_LIBRARIES).sort())
})

test('boot failures at the DSH boot contract are reported as a possible version mismatch', () => {
  // Observed verbatim when this plugin was opened on DSH 0.2.0-rc.2.
  assert.equal(classifyBootFailure('client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js'), 'incompatible')
  assert.equal(classifyBootFailure('webui-m3e: the Host boot graph has no @deepseek-ai/dsh-api-gateway'), 'incompatible')
  assert.equal(classifyBootFailure('webui-m3e: plugins did not activate: @deepseek-ai/dsh-client-connection'), 'incompatible')
  assert.equal(classifyBootFailure('client-modules: boot manifest entries must be an array'), 'incompatible')
  assert.equal(classifyBootFailure('client-modules: no registered factory for @deepseek-ai/dsh-api-remotes'), 'incompatible')
  assert.equal(classifyBootFailure('webui-m3e: the DSH client lacks sessions.open, sessions.clear'), 'incompatible')
})

test('boot failures that may be transient are not blamed on the DSH release', () => {
  assert.equal(classifyBootFailure('webui-m3e: this page was not rendered by the DSH Host (no boot graph)'), 'not-host')
  assert.equal(classifyBootFailure('client-modules: bundle script /plugins/??x.js failed to load'), 'unknown')
  assert.equal(classifyBootFailure('Failed to fetch dynamically imported module'), 'unknown')
  assert.equal(classifyBootFailure(''), 'unknown')
})
