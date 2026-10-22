import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Every Japanese text the page shows lives in a `messages.ts` dictionary
 * (docs/design/11-i18n.md). A Japanese string literal anywhere else in
 * web/src would stay Japanese for English and Chinese readers, so this test
 * reads every source file and fails on one. Mock data is not translated and
 * is skipped; comments are not string literals and are never read.
 */

const root = fileURLToPath(new URL('../web/src/', import.meta.url))
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

/** Files that are not shown as UI text: dictionaries and mock data. */
function skipped(path: string): boolean {
  return /(^|\/)messages\.ts$/u.test(path)
    || /(^|\/)(?:[^/]*-)?mock[^/]*\.tsx?$/u.test(path)
    || /-fixtures\.ts$/u.test(path)
    || path.startsWith('dsh/mock/')
}

/**
 * Literals that are not UI text in the page language. Each entry is
 * `path: literal` and says why it stays.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // Language names are written in the language itself, as the stock screen does.
  'features/settings/general.ts: 中文': 'language name',
  'features/settings/general.ts: 日本語': 'language name',
  // Rejection reasons returned to the DSH requester, never shown on the page.
  // docs/design/11-i18n.md keeps them in fixed Japanese.
  'dsh/interactions-store.ts: 回答の前に質問が取り消されました。': 'reason for the requester',
  'dsh/interactions-store.ts: 承認の要求が取り消されました。': 'reason for the requester',
  'dsh/interactions-store.ts: この要求への回答はすでに終了しています。': 'reason for the requester',
  'dsh/interactions-store.ts: この接続には対応待ちの受け取りがすでに登録されています。': 'reason for the requester',
}

interface Finding { readonly path: string; readonly line: number; readonly text: string }

function literals(path: string, source: string): Finding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Finding[] = []
  const visit = (node: ts.Node) => {
    let text: string | undefined
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text
    else if (ts.isJsxText(node)) text = node.text.trim()
    if (text !== undefined && JAPANESE.test(text)) {
      // A `console.*` message is a developer log, not UI text.
      const call = ts.findAncestor(node, ts.isCallExpression)
      const isLog = call !== undefined && /^console\.\w+$/u.test(call.expression.getText(file))
      if (!isLog && !Object.hasOwn(ALLOWED, `${path}: ${text}`)) {
        found.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

test('web/src の画面の文言は messages.ts の辞書だけにある（偽データとログを除く）', async () => {
  const paths = (await readdir(root, { recursive: true }))
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => /\.tsx?$/u.test(path) && !path.endsWith('.d.ts') && !skipped(path))
    .sort()
  assert.ok(paths.length > 100, 'the scan reads the source tree')
  const findings = (await Promise.all(paths.map(async path => literals(path, await readFile(`${root}${path}`, 'utf8'))))).flat()
  assert.deepEqual(findings.map(({ path, line, text }) => `${path}:${line} ${text}`), [])
})

test('辞書の検査そのもの：文字列・テンプレート・JSX の日本語を見つけ、コメントとログは見ない', () => {
  const source = [
    '// コメントは見ない',
    "const a = '日本語'",
    'const b = `件数 ${n} 件`',
    'const c = <p>説明</p>',
    "console.warn('ログは見ない')",
    "const d = 'English only'",
  ].join('\n')
  assert.deepEqual(literals('features/example.tsx', source).map(({ line, text }) => `${line} ${text}`), ['2 日本語', '3 件数 ', '3  件', '4 説明'])
  assert.deepEqual(literals('features/settings/general.ts', "const zh = '中文'"), [])
  assert.equal(skipped('features/home/messages.ts'), true)
  assert.equal(skipped('features/home/mock.ts'), true)
  assert.equal(skipped('features/home/directory-mock.ts'), true)
  assert.equal(skipped('features/session-tools/mock-goals.ts'), true)
  assert.equal(skipped('features/settings/mock-fixtures.ts'), true)
  assert.equal(skipped('features/trace/trace-fixtures.ts'), true)
  assert.equal(skipped('dsh/mock/context.ts'), true)
  assert.equal(skipped('features/home/HomeScreen.tsx'), false)
})
