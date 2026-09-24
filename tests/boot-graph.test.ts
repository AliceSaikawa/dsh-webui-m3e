import assert from 'node:assert/strict'
import { test } from 'node:test'
import { narrowBootGraph } from '../web/src/dsh/boot-graph.ts'

const entry = (id: string, inject: string[] = []) => ({ id, url: `/plugins/??${id}/client.js&rev=r-${id}`, rev: `r-${id}`, inject })

const graph = {
  rev: 'g1',
  entries: [
    entry('modules'),
    entry('connection'),
    entry('gateway', ['connection', 'registry']),
    entry('registry'),
    entry('ui-chat', ['gateway', 'ui-renderer']),
    entry('ui-renderer'),
  ],
  batches: [
    { phase: 'bootstrap' as const, url: '/plugins/??modules/client.js&rev=b', rev: 'b', entries: ['modules'] },
    {
      phase: 'application' as const,
      url: '/plugins/??all&rev=a',
      rev: 'a',
      entries: ['connection', 'gateway', 'registry', 'ui-chat', 'ui-renderer'],
    },
  ],
}

test('keeps the wanted plugins and their inject closure, dropping the rest', () => {
  const narrowed = narrowBootGraph(graph, ['modules', 'gateway'])
  assert.deepEqual(
    narrowed.entries.map((e) => e.id),
    ['modules', 'connection', 'gateway', 'registry'],
  )
})

test('gives each kept application entry its own one-resource batch and keeps the bootstrap batch', () => {
  const narrowed = narrowBootGraph(graph, ['modules', 'gateway'])
  assert.deepEqual(narrowed.batches[0], graph.batches[0])
  assert.deepEqual(
    narrowed.batches.slice(1).map((b) => [b.url, b.entries]),
    ['connection', 'gateway', 'registry'].map((id) => [`/plugins/??${id}/client.js&rev=r-${id}`, [id]]),
  )
})

test('fails loudly when the Host graph lacks a wanted plugin', () => {
  assert.throws(() => narrowBootGraph(graph, ['missing']), /no missing/)
})
