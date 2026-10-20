import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The English README is the canonical one; the others follow it. */
const readmes = ['README.md', 'README.ja.md', 'README.zh-CN.md'] as const

const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const lines = (path: string) => read(path).split('\n')

/** GitHub's heading anchor: lower-case, drop punctuation, spaces to hyphens. */
function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
}

function anchors(markdownPath: string): Set<string> {
  const result = new Set<string>()
  let fenced = false
  for (const line of lines(markdownPath)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue }
    const match = !fenced && /^#{1,6}\s+(.*)$/.exec(line)
    if (match) result.add(slug(match[1]!))
  }
  return result
}

/** Relative link targets in Markdown links and HTML `src` attributes, outside code fences. */
function localTargets(path: string): string[] {
  const targets: string[] = []
  let fenced = false
  for (const line of lines(path)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    for (const match of line.matchAll(/\]\(([^)\s]+)\)|\bsrc="([^"]+)"/g)) {
      const target = match[1] ?? match[2]!
      if (!/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) targets.push(target)
    }
  }
  return targets
}

test('readme: the three READMEs exist, with the English one as README.md', () => {
  for (const path of readmes) assert.equal(existsSync(resolve(root, path)), true, path)
  assert.equal(existsSync(resolve(root, 'README.en.md')), false)
  assert.match(lines('README.md')[2]!, /\| English \|/)
  assert.match(lines('README.ja.md')[2]!, /^日本語 \|/)
  assert.match(lines('README.zh-CN.md')[2]!, /\| 简体中文$/)
})

test('readme: each README links to the other two in the language switcher', () => {
  const links = (path: string) => [...lines(path)[2]!.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])
  assert.deepEqual(links('README.md'), ['README.ja.md', 'README.zh-CN.md'])
  assert.deepEqual(links('README.ja.md'), ['README.md', 'README.zh-CN.md'])
  assert.deepEqual(links('README.zh-CN.md'), ['README.ja.md', 'README.md'])
})

test('readme: every relative link and image resolves to a file, and every anchor to a heading', () => {
  for (const path of readmes) {
    const targets = localTargets(path)
    assert.ok(targets.length > 0, `${path} has relative links`)
    for (const target of targets) {
      const [file, anchor] = target.split('#') as [string, string | undefined]
      const resolved = resolve(root, dirname(path), decodeURIComponent(file))
      assert.equal(existsSync(resolved), true, `${path}: ${target}`)
      if (anchor !== undefined) {
        assert.ok(anchors(resolved.slice(root.length + 1)).has(decodeURIComponent(anchor)), `${path}: anchor of ${target}`)
      }
    }
  }
})

test('readme: the three READMEs state the same real-device scope and the same set of releases', () => {
  for (const path of readmes) {
    const text = read(path)
    assert.match(text, /iPhone 17 Pro Max/, `${path} names the verified device`)
    assert.match(text, /Safari/, `${path} names the verified browser`)
    for (const token of ['v0.0.8', 'v0.0.9-rc.2', '0.2.0-rc.2', '0.2.1-rc.2', 'dsh plugin --profile web add', 'dsh plugin --profile web remove dsh-webui-m3e']) {
      assert.ok(text.includes(token), `${path} mentions ${token}`)
    }
  }
})

test('readme: the screenshots exist for every language that links them', () => {
  assert.deepEqual(localTargets('README.md').filter((target) => target.startsWith('docs/images/')).sort(),
    ['docs/images/approval.en.png', 'docs/images/chat.en.png', 'docs/images/home.en.png', 'docs/images/inbox.en.png'])
  assert.deepEqual(localTargets('README.ja.md').filter((target) => target.startsWith('docs/images/')).sort(),
    ['docs/images/approval.png', 'docs/images/chat.png', 'docs/images/home.png', 'docs/images/inbox.png'])
})
