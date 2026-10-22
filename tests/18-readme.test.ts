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
    for (const token of ['v0.0.8', 'v0.0.9', '0.2.0-rc.2', '0.2.1-rc.2', 'dsh plugin --profile web add', 'dsh plugin --profile web remove dsh-webui-m3e']) {
      assert.ok(text.includes(token), `${path} mentions ${token}`)
    }
  }
})

test('readme: the screenshots exist for every language that links them', () => {
  const images = (path: string, suffix: string) => localTargets(path).filter((target) => target.startsWith('docs/images/')).sort()
    .map((target) => target.replace(suffix, ''))
  assert.deepEqual(localTargets('README.md').filter((target) => target.startsWith('docs/images/')).sort(),
    ['docs/images/approval.en.png', 'docs/images/chat.en.png', 'docs/images/home.en.png', 'docs/images/inbox.en.png'])
  assert.deepEqual(localTargets('README.ja.md').filter((target) => target.startsWith('docs/images/')).sort(),
    ['docs/images/approval.png', 'docs/images/chat.png', 'docs/images/home.png', 'docs/images/inbox.png'])
  assert.deepEqual(localTargets('README.zh-CN.md').filter((target) => target.startsWith('docs/images/')).sort(),
    ['docs/images/approval.zh-CN.png', 'docs/images/chat.zh-CN.png', 'docs/images/home.zh-CN.png', 'docs/images/inbox.zh-CN.png'])
  assert.deepEqual(images('README.md', '.en'), images('README.ja.md', ''))
})

/**
 * The shape that the three languages must share: for every section, the number of
 * paragraphs, bullets and numbered steps, the ASCII inline code, the versions and
 * dates; plus the alerts, fenced code and external links of the whole file.
 */
function shape(path: string) {
  type Section = { heading: string; blocks: number; bullets: number; steps: number; tokens: string[] }
  const sections: Section[] = []
  const code: string[] = []
  const alerts: string[] = []
  let h3 = 0
  let fenced: string[] | undefined
  let inBlock = false
  for (const line of lines(path)) {
    if (/^\s*```/.test(line)) {
      if (fenced) { code.push(fenced.join('\n')); fenced = undefined } else fenced = []
      inBlock = false
      continue
    }
    if (fenced) { fenced.push(line.trim()); continue }
    const current = sections.at(-1)
    if (/^## /.test(line)) { sections.push({ heading: line, blocks: 0, bullets: 0, steps: 0, tokens: [] }); inBlock = false; continue }
    if (/^### /.test(line)) { h3 += 1; inBlock = false; continue }
    if (/^> \[!(?:NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]/.test(line)) alerts.push(line)
    if (!current) continue
    if (/^\s*[-*] /.test(line)) current.bullets += 1
    if (/^\d+\. /.test(line)) current.steps += 1
    if (line.trim() === '') inBlock = false
    else if (/^\s*(?:[-*]|\d+\.) /.test(line)) inBlock = false
    else if (!inBlock) { current.blocks += 1; inBlock = true }
    for (const match of line.matchAll(/`([^`]+)`/g)) if (/^[\x20-\x7e]+$/.test(match[1]!)) current.tokens.push(match[1]!)
    current.tokens.push(...(line.match(/\d+(?:\.\d+)+(?:-rc\.\d+)?|\d{4}-\d\d-\d\d/g) ?? []))
  }
  const external = [...read(path).matchAll(/\]\((https?:[^)\s]+)\)/g)].map((match) => match[1])
  return {
    h2: sections.length, h3, alerts, code, external,
    sections: sections.map(({ blocks, bullets, steps, tokens }) => ({ blocks, bullets, steps, tokens: tokens.sort() })),
  }
}

test('readme: the three READMEs share the same sections, paragraphs, steps, versions, code and links', () => {
  const english = shape('README.md')
  assert.ok(english.sections.length >= 7)
  for (const path of ['README.ja.md', 'README.zh-CN.md']) {
    assert.deepEqual(shape(path), english, path)
  }
})

test('readme: links to the Japanese-only docs are marked in the English and Chinese READMEs', () => {
  const marks: Record<string, string> = { 'README.md': 'Japanese', 'README.zh-CN.md': '日文' }
  for (const [path, mark] of Object.entries(marks)) {
    const docLinks = [...read(path).matchAll(/\]\((docs\/[^)\s#]+\.md)(?:#[^)\s]*)?\)(.{0,12})/g)]
    assert.ok(docLinks.length >= 5, `${path} links to docs`)
    for (const [, target, after] of docLinks) assert.ok(after!.includes(mark), `${path}: ${target} is followed by ${mark}`)
  }
})

test('readme: the Notes say that other devices and browsers are not verified, in every language', () => {
  const phrase: Record<string, RegExp> = {
    'README.md': /Safari on an iPhone 17 Pro Max[^]*other devices and browsers, are not tested/,
    'README.ja.md': /iPhone 17 Pro Max の Safari[^]*ほかの端末・ブラウザは確認していません/,
    'README.zh-CN.md': /iPhone 17 Pro Max 的 Safari[^]*以及其他设备和浏览器，尚未验证/,
  }
  for (const [path, pattern] of Object.entries(phrase)) {
    const text = read(path)
    const notes = text.slice(text.search(/^## (?:Notes|注意|注意事项)$/m))
    assert.match(notes, pattern, path)
  }
})

test('readme: the Home Screen app is called unverified in the features, usage and notes of every language', () => {
  const unverified: Record<string, RegExp> = {
    'README.md': /Home Screen[^.]*not (?:verified|tested)/,
    'README.ja.md': /ホーム画面[^。]*(?:未確認|確認していません)/,
    'README.zh-CN.md': /主屏幕[^。]*尚未验证/,
  }
  for (const [path, pattern] of Object.entries(unverified)) {
    const text = read(path)
    for (const heading of [/^## (?:Features|できること|功能)$/m, /^## (?:Usage|使い方|使用方法)$/m, /^## (?:Notes|注意|注意事项)$/m]) {
      const start = heading.exec(text)
      assert.ok(start, `${path}: ${heading}`)
      const rest = text.slice(start.index + start[0].length)
      const section = rest.slice(0, rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m))
      assert.ok(pattern.test(section), `${path}: ${heading} says the Home Screen app is unverified`)
    }
  }
})
