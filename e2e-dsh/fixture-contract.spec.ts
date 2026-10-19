import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures.ts'
import { root, dshVersion } from './dsh-host.ts'
import { histories } from '../tests/helpers/s6b-histories.ts'
import { invalidFixtureCases } from '../tests/helpers/s6b-invalid-fixtures.ts'

test('全fixtureと不正値を実DSHのV4 admission・restore・Session・compaction payloadで照合する', async ({ integration }) => {
  expect(integration.host.version).toBe(dshVersion)
  // This stage uses the release installed at the common-s6b.md fixed location.
  const install = join(root, 'tmp', 'dsh-integration', `dsh-${dshVersion}`)
  const load = (name: string) => import(pathToFileURL(join(install, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href)
  const [{ Session, KNOWN_SESSION_EVENT_TYPES }, format, released] = await Promise.all([
    load('dsh-session'), load('dsh-session-format-v3-to-v4'), load('dsh-session-format-v0-to-v1'),
  ])
  // 0.2.1-rc.2 dropped the package-owned invariant companions that 0.2.0-rc.2 shipped as
  // `@deepseek-ai/dsh-commands/invariant` and `@deepseek-ai/dsh-compaction/invariant` (with
  // the `./invariant` subpaths and the dsh-invariants registry). Their command and compaction
  // lifecycle rules (command pairing, open-compaction brackets, turn ownership, summary/end
  // matching, current-surface spans) moved into restoreReleasedV4Artifact ->
  // assertReleasedV4Relationships -> Relationships.accept, which validate() runs below.
  // What the V4 restorer does not repeat is the compaction payload shape itself: the
  // shadowedTokenCount non-negative safe integer check (0.2.0-rc.2
  // dsh-compaction/lib/invariant.js:137) and the non-empty compactionId/sourceCommandId
  // checks. The released payload-semantics validator still owns that compaction payload, so
  // run it over the compaction events.
  const compactionPayload = new Set(['compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune'])
  const validate = (id: string, events: readonly unknown[]) => {
    const header = { version: 4, id, createdAt: 0, delegationDepth: 0, isSeeded: false }
    for (const event of events) {
      format.assertV4RowAdmission(event, KNOWN_SESSION_EVENT_TYPES)
      if (compactionPayload.has((event as { type: string }).type)) released.assertReleasedPayloadSemantics(event, 4)
    }
    format.restoreReleasedV4Artifact({ header, events, inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES)
    Session.create(id, events, header)
  }
  const fixtures = histories()
  expect(fixtures).toHaveLength(194)
  for (const { id, records } of fixtures) expect(() => validate(id, records), id).not.toThrow()
  const invalid = invalidFixtureCases()
  expect(invalid).toHaveLength(33)
  for (const { id, records } of invalid) expect(() => validate(id, records), id).toThrow()
})
