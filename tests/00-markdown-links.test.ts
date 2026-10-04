import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

// Render the actual component, including react-markdown's empty href handling.
const bundled = buildSync({
  stdin: { contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Markdown } from './web/src/app/Markdown.tsx'; export const render = (text) => renderToStaticMarkup(createElement(Markdown, null, text));`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0]!.text
const component = { exports: {} as { render(text: string): string } }
const page = 'https://host.example/m3e/?mock#/s/example'
new Function('module', 'exports', 'require', 'window', bundled)(component, component.exports, createRequire(import.meta.url), { location: { href: page } })

test('空のMarkdownリンクもbase要素ではなく表示中のページに解決される', () => {
  const html = component.exports.render('[再表示]()')
  assert.ok(html.includes(`href="${new URL('', page).href}"`), html)
  assert.ok(!html.includes('href=""'), html)
  assert.match(html, />再表示<\/a>/)
})
