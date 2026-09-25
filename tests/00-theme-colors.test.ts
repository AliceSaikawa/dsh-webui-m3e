import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'

// MCU 0.4.0 has extensionless internal imports; use the app's bundler resolution in memory.
const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL('../web/src/app/theme/colors.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
}).outputFiles[0]!.text
const { applyDocumentTheme, themeColors, themeOptions } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`) as typeof import('../web/src/app/theme/colors.ts')

/** Execute the installed component's pure color code, without importing or rendering its DOM class. */
function componentColors(dark: boolean): Record<string, string> {
  const source = readFileSync(new URL('../node_modules/@m3e/web/dist/theme.js', import.meta.url), 'utf8')
  const start = source.indexOf('function isColorScheme(')
  const end = source.indexOf('var _M3eThemeElement_instances,')
  const apply = source.match(/_M3eThemeElement_apply = function _M3eThemeElement_apply\(forceReflow\) \{([\s\S]*?)\n  if \(this.motion === "expressive"\)/)?.[1]
  const variant = source.match(/_M3eThemeElement_getVariant = function[\s\S]*?\n};/)?.[0]
  const contrast = source.match(/_M3eThemeElement_getContrastLevel = function[\s\S]*?\n};/)?.[0]
  assert.ok(start >= 0 && end > start && apply && variant && contrast, '同梱 m3e の色生成実装を特定できません。')
  const css = runInNewContext(`
    ${source.slice(start, end)}
    const _M3eThemeElement_instances = undefined;
    let _M3eThemeElement_getVariant, _M3eThemeElement_getContrastLevel;
    const __classPrivateFieldGet = (_owner, _state, _kind, method) => method;
    ${variant}
    ${contrast}
    (function () { ${apply}\n return css; }).call(theme);
  `, { theme: { ...themeOptions, isDark: dark } }, { timeout: 1000 }) as string
  return Object.fromEntries(css.split(';').filter(Boolean).map((declaration) => {
    const [name, value] = declaration.split(':')
    return [name!.trim(), value!.trim()]
  }))
}

for (const dark of [false, true]) {
  test(`${dark ? 'ダーク' : 'ライト'}の html の全色ロールが同梱 M3eTheme の生成値と一致する`, (t) => {
    const expected = componentColors(dark)
    const actual = themeColors(dark)
    assert.deepEqual(actual, expected)
    assert.ok(Object.keys(actual).length > 40)
    for (const role of ['surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest', 'surface-variant', 'shadow', 'scrim', 'surface-tint', 'primary-fixed', 'on-primary-fixed']) {
      assert.match(actual[`--md-sys-color-${role}`]!, /^#[0-9a-f]{6}$/)
    }
    t.diagnostic(`surface=${actual['--md-sys-color-surface']}, background=${actual['--md-sys-color-background']}, roles=${Object.keys(actual).length}`)
  })
}

test('明暗を切り替えると全色と color-scheme を置き換え、ほかのスタイルを維持する', () => {
  const values: Record<string, string> = { '--app-keyboard-height': '0px' }
  const style = { colorScheme: '', setProperty(name: string, value: string) { values[name] = value } }
  const target = { style }
  for (const dark of [false, true, false]) {
    applyDocumentTheme(target, dark)
    assert.equal(style.colorScheme, dark ? 'dark' : 'light')
    assert.deepEqual(values, { '--app-keyboard-height': '0px', ...componentColors(dark) })
  }
})
