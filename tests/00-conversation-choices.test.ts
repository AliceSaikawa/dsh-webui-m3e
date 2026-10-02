import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionSummary, WorkspaceView } from '../web/src/dsh/services.ts'
import { conversationChoices, conversationChoiceAvailable, CONVERSATION_CHOICE_LIMIT } from '../web/src/features/conversation/conversation-choices.ts'

const row = (id: string, patch: Partial<SessionSummary> = {}): SessionSummary => ({ id, displayTitle: id, running: false, blank: false, updatedAt: 0, ...patch })
const workspace = (id: string, ids: string[]): WorkspaceView => ({ workspaceId: id, title: id, path: `/mock/${id}`, sessionIds: ids, createdAt: '2026-10-02', updatedAt: '2026-10-02' })
function catalog(rows: SessionSummary[]) { return { ids: rows.map(item => item.id), byId: Object.fromEntries(rows.map(item => [item.id, item])) } }

test('picker prioritizes current then its workspace, inherits a child parent membership, and preserves source order', () => {
  const list = catalog([row('outside'), row('sibling'), row('parent'), row('child', { origin: 'subagent', parentId: 'parent' })])
  const spaces = { items: [workspace('first', ['parent', 'sibling']), workspace('other', ['outside'])], archivedSessionIds: [] }
  const before = JSON.stringify({ list, spaces })
  const result = conversationChoices(list, spaces, 'child', '')
  assert.deepEqual(result.items.map(item => [item.row.id, item.workspaceTitle]), [['child', 'first'], ['sibling', 'first'], ['parent', 'first'], ['outside', 'other']])
  assert.equal(JSON.stringify({ list, spaces }), before)
})

test('picker uses authoritative own rows, deduplicates, and omits archived, blank and invalid route IDs', () => {
  const list = catalog([row('current', { blank: true }), row('blank', { blank: true }), row('archived'), row('valid/日本語'), row(''), row('\ud800')])
  list.ids.push('valid/日本語', 'ghost', 'mismatch', 'inherited')
  list.byId.ghost = row('ghost')
  list.ids = list.ids.filter(id => id !== 'ghost')
  list.byId.mismatch = row('different')
  Object.setPrototypeOf(list.byId, { inherited: row('inherited') })
  assert.deepEqual(conversationChoices(list, { items: [], archivedSessionIds: ['archived'] }, 'current', '').items.map(item => item.row.id), ['current', 'valid/日本語'])
})

test('picker bounds rendered rows and searches the complete catalog beyond the cap', () => {
  const list = catalog(Array.from({ length: 1_000 }, (_, i) => row(`row-${i}`, { displayTitle: i === 999 ? '最後の Needle 日本語' : `会話 ${i}` })))
  const spaces = { items: [], archivedSessionIds: [] }
  const initial = conversationChoices(list, spaces, 'row-80', '')
  assert.equal(initial.total, 1_000)
  assert.equal(initial.items.length, CONVERSATION_CHOICE_LIMIT)
  assert.equal(initial.items[0]!.row.id, 'row-80')
  assert.deepEqual(conversationChoices(list, spaces, 'row-80', '  NEEDLE  ').items.map(item => item.row.id), ['row-999'])
  assert.equal(conversationChoices(list, spaces, 'row-80', '不存在').total, 0)
})

test('a delayed choice rejects removal, archival, identity/origin/parent changes and a newly blank row', () => {
  const original = row('child', { origin: 'subagent', parentId: 'parent' })
  const list = catalog([original])
  assert.equal(conversationChoiceAvailable(original, list, []), true)
  assert.equal(conversationChoiceAvailable(original, list, ['child']), false)
  assert.equal(conversationChoiceAvailable(original, { ...list, ids: [] }, []), false)
  for (const patch of [{ id: 'different' }, { origin: undefined }, { parentId: 'different' }, { blank: true }]) {
    assert.equal(conversationChoiceAvailable(original, catalog([{ ...original, ...patch }]), []), false)
  }
  for (const id of ['', '\ud800']) assert.equal(conversationChoiceAvailable(row(id), catalog([row(id)]), []), false)
})
