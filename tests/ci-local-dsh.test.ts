import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/ci-local-dsh.sh', import.meta.url))
const dsh = 'tmp/dsh-integration/dsh-0.2.0-rc.2'

// A fake npm records each call. In "fail" mode it leaves a partial node_modules
// behind and exits non-zero, like an install interrupted by the network.
const fakeNpm = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_NPM_LOG"
prefix=; while [ $# -gt 0 ]; do [ "$1" = --prefix ] && prefix=$2; shift; done
mkdir -p "$prefix/node_modules/partial"
[ "$FAKE_NPM_MODE" = fail ] && exit 1
mkdir -p "$prefix/node_modules/@deepseek-ai/dsh"
`

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'ci-local-dsh-'))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'npm'), fakeNpm)
  chmodSync(join(bin, 'npm'), 0o755)
  mkdirSync(join(root, '.github/ci/dsh'), { recursive: true })
  writeFileSync(join(root, '.github/ci/dsh/package.json'), '{"dependencies":{}}\n')
  const log = join(root, 'npm.log')
  const lock = (text: string) => writeFileSync(join(root, '.github/ci/dsh/package-lock.json'), text)
  const run = (mode = 'ok') => {
    const before = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
    const result = spawnSync('bash', [script], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_NPM_LOG: log, FAKE_NPM_MODE: mode },
    })
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
    return { status: result.status, installed: calls - before, stdout: result.stdout, stderr: result.stderr }
  }
  const marker = join(root, dsh, '.ci-local-lock-sha256')
  const markerValue = () => existsSync(marker) ? readFileSync(marker, 'utf8').trim() : undefined
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  return { root, run, lock, marker, markerValue, sha, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('ci-local DSH: installs once, then reuses only for the same lockfile', t => {
  const w = workspace()
  t.after(w.cleanup)
  w.lock('{"lockfileVersion":3,"v":1}\n')
  const first = w.run()
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.installed, 1)
  assert.equal(w.markerValue(), w.sha('{"lockfileVersion":3,"v":1}\n'))
  assert.equal(readFileSync(join(w.root, dsh, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3,"v":1}\n')
  const again = w.run()
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.installed, 0)
  assert.match(again.stdout, /再利用/)
})

test('ci-local DSH: an updated lockfile is installed again', t => {
  const w = workspace()
  t.after(w.cleanup)
  w.lock('{"v":1}\n')
  assert.equal(w.run().installed, 1)
  w.lock('{"v":2}\n')
  const updated = w.run()
  assert.equal(updated.status, 0, updated.stderr)
  assert.equal(updated.installed, 1)
  assert.equal(w.markerValue(), w.sha('{"v":2}\n'))
  assert.equal(readFileSync(join(w.root, dsh, 'package-lock.json'), 'utf8'), '{"v":2}\n')
})

test('ci-local DSH: a failed install leaves no completion marker and the next run installs again', t => {
  const w = workspace()
  t.after(w.cleanup)
  w.lock('{"v":1}\n')
  assert.equal(w.run().installed, 1)
  w.lock('{"v":2}\n')
  const failed = w.run('fail')
  assert.notEqual(failed.status, 0)
  assert.equal(failed.installed, 1)
  assert.ok(existsSync(join(w.root, dsh, 'node_modules')), 'the partial install stays on disk')
  assert.equal(w.markerValue(), undefined)
  const retried = w.run()
  assert.equal(retried.status, 0, retried.stderr)
  assert.equal(retried.installed, 1)
  assert.equal(w.markerValue(), w.sha('{"v":2}\n'))
})

test('ci-local DSH: an empty node_modules without a marker is installed', t => {
  const w = workspace()
  t.after(w.cleanup)
  w.lock('{"v":1}\n')
  mkdirSync(join(w.root, dsh, 'node_modules'), { recursive: true })
  const result = w.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.installed, 1)
})

test('ci-local DSH: a marker without node_modules is not trusted', t => {
  const w = workspace()
  t.after(w.cleanup)
  w.lock('{"v":1}\n')
  assert.equal(w.run().installed, 1)
  rmSync(join(w.root, dsh, 'node_modules'), { recursive: true })
  assert.ok(existsSync(w.marker))
  const result = w.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.installed, 1)
})
