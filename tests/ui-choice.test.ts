import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planIndexVisit, readUiChoice, uiChoiceScript } from '../src/shared/ui-choice.ts'

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

test('the inline script applies the plan: stores the cookie and replaces the location', () => {
  const run = (pathname: string, search: string, cookie: string) => {
    const doc = { cookie }
    const replaced: string[] = []
    const location = { pathname, search, hash: '', replace: (url: string) => replaced.push(url) }
    new Function('location', 'document', uiChoiceScript())(location, doc)
    return { cookie: doc.cookie, replaced }
  }
  const moved = run('/', '?ui=m3e', '')
  assert.match(moved.cookie, /^dsh-webui=m3e; Path=\/; Max-Age=\d+; SameSite=Strict$/)
  assert.deepEqual(moved.replaced, ['/m3e/'])
  assert.deepEqual(run('/', '', 'dsh-webui=classic').replaced, [])
})
