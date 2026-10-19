import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// MCU 0.4.0 has extensionless internal imports; use the app's bundler resolution in memory.
const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL('../web/src/app/theme/apply.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
}).outputFiles[0]!.text
const { applyStoredTheme } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`) as typeof import('../web/src/app/theme/apply.ts')

interface Page {
  properties: Map<string, string>
  style: { colorScheme: string }
  meta: Map<string, string>
}

/** Install the browser globals applyStoredTheme reads, with a head that has the given theme-color tags. */
function installBrowser(options: { stored?: Record<string, string>; osDark?: boolean; tags?: readonly string[]; matchMediaThrows?: boolean }) {
  const names = ['document', 'localStorage', 'matchMedia'] as const
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const page: Page = { properties: new Map(), style: { colorScheme: '' }, meta: new Map() }
  const style = Object.assign(page.style, { setProperty(name: string, value: string) { page.properties.set(name, value) } })
  const tags = new Map((options.tags ?? ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']).map(media => [media, {
    setAttribute(name: string, value: string) { if (name === 'content') page.meta.set(media, value) },
  }]))
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { style },
      querySelector: (selector: string) => tags.get(/\[media="(.*)"\]$/.exec(selector)?.[1] ?? '') ?? null,
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: { getItem: (key: string) => options.stored?.[key] ?? null },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      if (options.matchMediaThrows) throw new Error('matchMedia を利用できません')
      return { matches: query === '(prefers-color-scheme: dark)' && options.osDark === true }
    },
  })
  return {
    page,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

const light = '(prefers-color-scheme: light)'
const dark = '(prefers-color-scheme: dark)'

test('保存済みのダークと青を、最初の描画の前に html の色と theme-color へ反映する', () => {
  const browser = installBrowser({ stored: { 'dsh-m3e-appearance': 'dark', 'dsh-m3e-theme-color': '#0B57D0' } })
  try {
    applyStoredTheme()
    assert.equal(browser.page.style.colorScheme, 'dark')
    assert.equal(browser.page.properties.get('--md-sys-color-primary'), '#b2c5ff')
    // 明示したダークは、端末の明暗によらず両方の theme-color が同じ色になる。
    assert.deepEqual([browser.page.meta.get(light), browser.page.meta.get(dark)], ['#131316', '#131316'])
  } finally { browser.restore() }
})

test('端末に合わせる設定では、明暗ごとの theme-color を別々の色にし、html は端末の明暗に従う', () => {
  const browser = installBrowser({ stored: { 'dsh-m3e-theme-color': '#0B57D0' }, osDark: true })
  try {
    applyStoredTheme()
    assert.equal(browser.page.style.colorScheme, 'dark')
    assert.equal(browser.page.properties.get('--md-sys-color-primary'), '#b2c5ff')
    assert.deepEqual([browser.page.meta.get(light), browser.page.meta.get(dark)], ['#fbf8fd', '#131316'])
  } finally { browser.restore() }
})

test('明示したライトは、端末がダークでも html と theme-color をライトにする', () => {
  const browser = installBrowser({ stored: { 'dsh-m3e-appearance': 'light', 'dsh-m3e-theme-color': '#0B57D0' }, osDark: true })
  try {
    applyStoredTheme()
    assert.equal(browser.page.style.colorScheme, 'light')
    assert.equal(browser.page.properties.get('--md-sys-color-primary'), '#0856cf')
    assert.deepEqual([browser.page.meta.get(light), browser.page.meta.get(dark)], ['#fbf8fd', '#fbf8fd'])
  } finally { browser.restore() }
})

test('保存された値がないときは、既定の紫のライトにする', () => {
  const browser = installBrowser({})
  try {
    applyStoredTheme()
    assert.equal(browser.page.style.colorScheme, 'light')
    assert.equal(browser.page.properties.get('--md-sys-color-primary'), '#6750a4')
    assert.deepEqual([browser.page.meta.get(light), browser.page.meta.get(dark)], ['#fdf8fd', '#141316'])
  } finally { browser.restore() }
})

test('theme-color のタグがなくても html の色は反映し、例外にしない', () => {
  const browser = installBrowser({ stored: { 'dsh-m3e-theme-color': '#0B57D0' }, tags: [] })
  try {
    applyStoredTheme()
    assert.equal(browser.page.properties.get('--md-sys-color-primary'), '#0856cf')
    assert.equal(browser.page.meta.size, 0)
  } finally { browser.restore() }
})

test('明暗の判定に失敗しても例外にせず、何も変えない', () => {
  const browser = installBrowser({ matchMediaThrows: true })
  try {
    assert.doesNotThrow(() => applyStoredTheme())
    assert.equal(browser.page.properties.size, 0)
    assert.equal(browser.page.meta.size, 0)
  } finally { browser.restore() }
})
