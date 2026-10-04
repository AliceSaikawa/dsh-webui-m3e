import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures.ts'
import { root, dshVersion } from './dsh-host.ts'
import { histories } from '../tests/helpers/s6b-histories.ts'
import { invalidFixtureCases } from '../tests/helpers/s6b-invalid-fixtures.ts'

test('全fixtureと不正値を実DSHのV4 admission・Session・commands・compactionで照合する', async ({ integration }) => {
  expect(integration.host.version).toBe(dshVersion)
  // This stage uses the release installed at the common-s6b.md fixed location.
  const install = join(root, 'tmp', 'dsh-integration', `dsh-${dshVersion}`)
  const load = (name: string, file = 'index.js') => import(pathToFileURL(join(install, 'node_modules', '@deepseek-ai', name, 'lib', file)).href)
  const [{ Session, KNOWN_SESSION_EVENT_TYPES }, format, commands, compaction] = await Promise.all([
    load('dsh-session'), load('dsh-session-format-v3-to-v4'), load('dsh-commands', 'invariant.js'), load('dsh-compaction', 'invariant.js'),
  ])
  const companions: ((events: readonly unknown[]) => void)[] = []
  for (const plugin of [commands, compaction]) await plugin.apply({ invariants: { register(_name: string, install: Function) {
    companions.push(events => install({ sessions: { messageProjections: [], list: () => [{
      // Use the ORIGINAL live log. Session.create appends end-seed, which would
      // incorrectly excuse an unmatched compaction as inherited stale state.
      snapshotEvents: () => events, eventAt: (seq: number) => events[seq],
    }] }, on() {} }, (message: string) => { throw new Error(message) }))
  } } })
  const validate = (id: string, events: readonly unknown[]) => {
    const header = { version: 4, id, createdAt: 0, delegationDepth: 0, isSeeded: false }
    for (const event of events) format.assertV4RowAdmission(event, KNOWN_SESSION_EVENT_TYPES)
    format.restoreReleasedV4Artifact({ header, events, inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES)
    Session.create(id, events, header)
    for (const check of companions) check(events)
  }
  const fixtures = histories()
  expect(fixtures).toHaveLength(194)
  for (const { id, records } of fixtures) expect(() => validate(id, records), id).not.toThrow()
  const invalid = invalidFixtureCases()
  expect(invalid).toHaveLength(30)
  for (const { id, records } of invalid) expect(() => validate(id, records), id).toThrow()
})
