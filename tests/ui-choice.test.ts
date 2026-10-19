import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markTabShowedM3e, planIndexVisit, readUiChoice, DESKTOP_QUERY, TAB_MARK_KEY, uiChoiceScript } from '../src/shared/ui-choice.ts'

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

test('the choice defaults to the stock UI and reads the m3e cookie', () => {
  assert.equal(readUiChoice(''), 'classic')
  assert.equal(readUiChoice('a=1; dsh-webui=m3e; b=2'), 'm3e')
  assert.equal(readUiChoice('dsh-webui=classic'), 'classic')
  assert.equal(readUiChoice('xdsh-webui=m3e'), 'classic')
})

test('the stock index moves to /m3e/ when this device chose m3e, keeping the hash', () => {
  assert.deepEqual(planIndexVisit(at('/', '', '#x'), 'dsh-webui=m3e'), { redirect: '/m3e/#x' })
  assert.deepEqual(planIndexVisit(at('/index.html'), 'dsh-webui=m3e'), { redirect: '/m3e/' })
})

test('the stock index stays put without the m3e choice', () => {
  assert.deepEqual(planIndexVisit(at('/'), ''), {})
  assert.deepEqual(planIndexVisit(at('/'), 'dsh-webui=classic'), {})
})

test('?ui= records the choice; m3e also moves, classic stays even over an m3e cookie', () => {
  assert.deepEqual(planIndexVisit(at('/', '?ui=m3e'), ''), { store: 'm3e', redirect: '/m3e/' })
  assert.deepEqual(planIndexVisit(at('/', '?ui=classic'), 'dsh-webui=m3e'), { store: 'classic' })
})

test('pages other than the stock index are never moved', () => {
  assert.deepEqual(planIndexVisit(at('/m3e/'), 'dsh-webui=m3e'), {})
  assert.deepEqual(planIndexVisit(at('/m3e'), 'dsh-webui=m3e'), {})
  assert.deepEqual(planIndexVisit(at('/other'), 'dsh-webui=m3e'), {})
})

test('a tab that showed m3e keeps the stock UI on /, but an explicit ?ui= still wins', () => {
  assert.deepEqual(planIndexVisit(at('/'), 'dsh-webui=m3e', true), {})
  assert.deepEqual(planIndexVisit(at('/index.html'), 'dsh-webui=m3e', true), {})
  assert.deepEqual(planIndexVisit(at('/', '', '#x'), 'dsh-webui=m3e', true), {})
  assert.deepEqual(planIndexVisit(at('/', '?ui=m3e'), '', true), { store: 'm3e', redirect: '/m3e/' })
  assert.deepEqual(planIndexVisit(at('/', '?ui=classic'), 'dsh-webui=m3e', true), { store: 'classic' })
})

test('a desktop never moves to m3e on its own, but an explicit ?ui=m3e still does', () => {
  assert.deepEqual(planIndexVisit(at('/'), 'dsh-webui=m3e', false, true), {})
  assert.deepEqual(planIndexVisit(at('/index.html'), 'dsh-webui=m3e', false, true), {})
  assert.deepEqual(planIndexVisit(at('/', '?ui=m3e'), '', false, true), { store: 'm3e', redirect: '/m3e/' })
  assert.deepEqual(planIndexVisit(at('/', '?ui=classic'), 'dsh-webui=m3e', false, true), { store: 'classic' })
})

test('markTabShowedM3e writes the tab mark and tolerates broken storage', () => {
  const writes: Array<[string, string]> = []
  markTabShowedM3e({ setItem: (key, value) => writes.push([key, value]) })
  assert.deepEqual(writes, [[TAB_MARK_KEY, '1']])
  assert.doesNotThrow(() => markTabShowedM3e({ setItem: () => { throw new Error('blocked') } }))
  assert.doesNotThrow(() => markTabShowedM3e(undefined))
})

const runScript = (
  pathname: string,
  search: string,
  cookie: string,
  sessionStorage: Pick<Storage, 'getItem'> | null = null,
  matchMedia: ((query: string) => { matches: boolean }) | undefined = undefined,
) => {
  const doc = { cookie }
  const replaced: string[] = []
  const location = { pathname, search, hash: '', replace: (url: string) => replaced.push(url) }
  new Function('location', 'document', 'sessionStorage', 'matchMedia', uiChoiceScript())(
    location,
    doc,
    sessionStorage,
    matchMedia,
  )
  return { cookie: doc.cookie, replaced }
}

test('the inline script applies the plan: stores the cookie and replaces the location', () => {
  const moved = runScript('/', '?ui=m3e', '')
  assert.match(moved.cookie, /^dsh-webui=m3e; Path=\/; Max-Age=\d+; SameSite=Strict$/)
  assert.deepEqual(moved.replaced, ['/m3e/'])
  assert.deepEqual(runScript('/', '', 'dsh-webui=classic').replaced, [])
})

test('the inline script honors the tab mark and tolerates broken storage', () => {
  const mark = { getItem: (key: string) => (key === TAB_MARK_KEY ? '1' : null) }
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', mark).replaced, [])
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', null).replaced, ['/m3e/'])
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', { getItem: () => { throw new Error('blocked') } }).replaced, ['/m3e/'])
})

test('the inline script keeps a desktop on the stock UI, and treats matchMedia errors as not desktop', () => {
  const desktop = (query: string) => ({ matches: query === DESKTOP_QUERY })
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', null, desktop).replaced, [])
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', null, () => ({ matches: false })).replaced, ['/m3e/'])
  assert.deepEqual(runScript('/', '', 'dsh-webui=m3e', null, () => { throw new Error('blocked') }).replaced, ['/m3e/'])
  const explicit = runScript('/', '?ui=m3e', '', null, desktop)
  assert.match(explicit.cookie, /^dsh-webui=m3e; Path=\/; Max-Age=\d+; SameSite=Strict$/)
  assert.deepEqual(explicit.replaced, ['/m3e/'])
})
