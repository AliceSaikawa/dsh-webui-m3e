import assert from 'node:assert/strict'
import type { SessionWireEvent } from '../../web/src/dsh/services.ts'

type Data = Record<string, any>
const roles: Record<string, string> = { 'user/message': 'user', 'system/message': 'system', 'developer/message': 'developer', 'assistant/message': 'assistant', 'tool/result': 'tool' }
// This is a fixture validator, not a general persistence reader. Adding another
// event kind requires adding its native contract here (see s6b-v4-rules.md).
export const fixtureTypes = new Set([...Object.keys(roles), 'turn/start', 'turn/end', 'step/start', 'step/end',
  'assistant/attempt', 'tool/call', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'request/header', 'request/context',
  'llm/retry', 'llm/retry-started', 'command/run', 'command/done', 'model/selection', 'compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune'])
const object = (v: any): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: any) => assert.ok(typeof v === 'string' && v.length > 0, 'nonempty string')
const count = (v: any) => assert.ok(Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0), 'nonnegative safe integer')
const positive = (v: any) => { count(v); assert.ok(v > 0, 'positive coordinate') }
const earlier = (v: any, seq: number) => { count(v); assert.ok(v < seq, 'earlier event') }
const pair = (v: any) => { assert.ok(object(v)); nonempty(v.provider); nonempty(v.model) }

function json(value: any): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { assert.ok(Number.isFinite(value) && !Object.is(value, -0), 'JSON number'); return }
  assert.ok(object(value) || Array.isArray(value), 'JSON value')
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'plain JSON object')
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) { assert.ok(Object.hasOwn(value, i), 'dense JSON array'); json(value[i]) }
  else for (const item of Object.values(value)) json(item)
}

function content(blocks: any, developer = false): void {
  assert.ok(Array.isArray(blocks), 'content array')
  for (const block of blocks) {
    assert.notEqual(block?.type, 'tool-result', 'retired tool-result')
    if (block?.type !== 'tool-addition' && block?.type !== 'tool-removal') continue
    assert.ok(developer, 'tool-change requires developer role')
    nonempty(block.toolName)
    if (block.type === 'tool-addition') assert.ok(!Object.hasOwn(block, 'tool'), 'omit inline tool definition')
  }
}

function systemContent(blocks: any[]): void {
  for (const block of blocks) {
    assert.ok(object(block)); nonempty(block.type)
    if (block.type === 'text' || block.type === 'reasoning') assert.equal(typeof block.text, 'string')
    if (block.type === 'tool-call') { nonempty(block.id); nonempty(block.name); assert.equal(typeof block.arguments, 'string') }
    if (block.type !== 'image') continue
    const a = block.attachment
    assert.ok(object(a)); nonempty(a.attachmentId)
    assert.ok(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mediaType))
    count(a.bytes); positive(a.width); positive(a.height)
    if (a.name !== undefined) assert.equal(typeof a.name, 'string')
    if (a.originalDimensions !== undefined) { assert.ok(object(a.originalDimensions)); positive(a.originalDimensions.width); positive(a.originalDimensions.height) }
  }
}

function requestHeader(d: Data): void {
  assert.ok(object(d.header), 'header object')
  const h = d.header
  assert.ok(!Object.hasOwn(h, 'system'), 'omit header.system')
  if (Array.isArray(h.tools)) {
    assert.ok(h.tools.length > 0, 'omit empty tools')
    for (const tool of h.tools) if (object(tool) && Object.hasOwn(tool, 'deferLoading')) assert.equal(tool.deferLoading, true)
  }
  pair(h.config)
  if (h.config.reasoningEffort !== undefined) nonempty(h.config.reasoningEffort)
  assert.ok(['initial', 'resume', 'change', 'series'].includes(d.reason), 'request reason')
  if (d.startsSeries !== undefined) assert.equal(d.startsSeries, true)
  if (h.adapterDefaults !== undefined) {
    assert.ok(object(h.adapterDefaults) && Object.keys(h.adapterDefaults).length > 0, 'nonempty adapterDefaults')
    for (const [key, marker] of Object.entries(h.adapterDefaults)) {
      assert.ok(['reasoningEffort', 'maxTokens'].includes(key), 'adapterDefaults key')
      assert.equal(marker, true); assert.notEqual(h.config[key], undefined, 'adapter default has config value')
    }
  }
}

/** Portable mirror of the native rules applicable to complete fixture histories.
 * No synthetic end-seed is added: live missing compaction/end must remain invalid.
 */
export function validateFixtureV4(records: readonly SessionWireEvent[], running = false): void {
  const surface: number[] = [], calls = new Map<string, Data>(), dispatches = new Map<string, Data>()
  const commands = new Set<string>(), pendingCommands = new Set<string>(), retries: Data[] = [], starts = new Set<string>()
  let turn: number | null = null, step: number | null = null, nextTurn = 1, nextStep = 1, provider: string | undefined
  let compact: Data | undefined, protectedHead: number | undefined
  const requireTurn = () => assert.notEqual(turn, null, 'open turn')
  const requireStep = (d: Data) => { requireTurn(); assert.notEqual(step, null, 'open step'); assert.equal(d.turn, turn); assert.equal(d.step, step) }
  const compactOwner = (d: Data) => {
    nonempty(d.compactionId); if (d.sourceCommandId !== undefined) nonempty(d.sourceCommandId)
    assert.ok(compact, 'matching compaction/start'); assert.equal(d.compactionId, compact.id); assert.equal(d.sourceCommandId, compact.command)
  }
  const span = (d: Data, seq: number) => {
    assert.ok(object(d.shadowedRange)); earlier(d.shadowedRange.start, seq); earlier(d.shadowedRange.end, seq)
    assert.ok(Array.isArray(d.shadowedSeqs) && d.shadowedSeqs.length > 0)
    d.shadowedSeqs.forEach(count)
    const first = surface.indexOf(d.shadowedRange.start), last = surface.indexOf(d.shadowedRange.end)
    assert.ok(first >= 0 && last >= first, 'current surface span')
    assert.deepEqual(d.shadowedSeqs, surface.slice(first, last + 1), 'every current surface node in order')
    assert.ok(protectedHead === undefined || !d.shadowedSeqs.includes(protectedHead), 'protected system head')
  }
  for (const [seq, event] of records.entries()) {
    json(event)
    assert.ok(Object.keys(event).every(key => ['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable'].includes(key)), 'event envelope fields')
    count(event.seq); assert.equal(event.seq, seq, 'dense sequence'); assert.ok(Number.isSafeInteger(event.time), 'integer time')
    if (event.ignorable !== undefined) assert.equal(event.ignorable, true)
    assert.ok(fixtureTypes.has(event.type), `unmapped fixture type: ${event.type}`)
    const d = event.data as Data
    assert.ok(object(d), 'event data object')
    const role = roles[event.type], message = role === 'user' ? d : d.message
    if (role) {
      assert.ok(object(message)); nonempty(message.id); assert.equal(message.role, role)
      assert.ok(object(message.source)); nonempty(message.source.kind); assert.notEqual(message.source.kind, 'plugin')
      content(message.content, role === 'developer')
      if (role === 'system') { assert.equal(message.source.kind, 'system-prompt'); positive(d.turn); positive(d.step); systemContent(message.content) }
      if (role === 'assistant') { assert.equal(message.source.kind, 'model'); pair(message.source) }
      if (role === 'tool') {
        assert.equal(message.source.kind, 'tool'); nonempty(message.source.callId); assert.equal(message.toolCallId, message.source.callId)
        if (message.isError !== undefined) assert.equal(typeof message.isError, 'boolean')
        if (d.error !== undefined) assert.equal(message.isError, true, 'error requires isError true')
        // The reserved fork identity is validated by native row admission even
        // when the referenced tool has already started in an ordinary history.
        if (d.error?.code === 'TOOL_NOT_STARTED' && message.id.startsWith('forked-tool-result-')) {
          const prefix = `forked-tool-result-${message.source.callId}-`
          const suffix = message.id.slice(prefix.length), sequence = Number(suffix)
          const operation: unknown = event.surfaceOp
          const replacement = object(operation) && operation.op === 'replace'
          assert.ok(message.id.startsWith(prefix) && /^(0|[1-9]\d*)$/.test(suffix) && Number.isSafeInteger(sequence), 'invalid V4 not-started fork result identity')
          assert.equal(d.error.name, 'ToolNotStartedError'); assert.equal(message.isError, true)
          if (replacement) { earlier(sequence, seq); assert.deepEqual(event.sourceEventSeqs, [sequence]) }
          else { assert.equal(sequence, seq); assert.equal(event.surfaceOp, 'append'); assert.equal(event.sourceEventSeqs, undefined) }
          assert.equal(message.content.length, 1); assert.equal(message.content[0]?.type, 'text'); assert.equal(typeof message.content[0]?.text, 'string')
        }
      }
      if (role === 'developer') {
        positive(d.turn); positive(d.step)
        const additions = message.content.filter((b: Data) => b?.type === 'tool-addition')
        if (additions.length === 0) assert.ok(!Object.hasOwn(d, 'headerSeq'), 'headerSeq only with additions')
        else {
          earlier(d.headerSeq, seq)
          const header = records[d.headerSeq]!
          assert.equal(header.type, 'request/header')
          for (const block of additions) {
            const definitions = (header.data as Data).header.tools?.filter((t: Data) => t.name === block.toolName) ?? []
            assert.equal(definitions.length, 1, 'unique historical tool definition')
            assert.equal(typeof definitions[0].description, 'string'); assert.ok(object(definitions[0].parameters))
          }
        }
      }
    }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      positive(d.turn); positive(d.step); assert.ok(Array.isArray(d.stream))
      for (const entry of d.stream) if (entry?.type === 'chunk') {
        if (entry.chunk?.type === 'block-start') content([{ type: entry.chunk.blockType }])
        if (entry.chunk?.type === 'block-end') content([entry.chunk.block])
      }
    }
    if (event.type === 'compaction/summary') { content(d.summary); if (d.rawOutput !== undefined) content(d.rawOutput) }
    if (event.type === 'tool/ptc-dispatch') content(d.content)
    // Log-only records cannot smuggle placement or references into the surface.
    if (!role) { assert.equal(event.surfaceOp, undefined); assert.equal(event.sourceEventSeqs, undefined) }
    else {
      const refs = event.sourceEventSeqs
      if (refs !== undefined) {
        assert.notEqual(role, 'assistant'); assert.ok(Array.isArray(refs) && refs.length > 0)
        refs.forEach(ref => earlier(ref, seq)); assert.equal(new Set(refs).size, refs.length)
      }
      const op: unknown = event.surfaceOp
      if (role === 'system' && surface.length > 0) assert.notEqual(protectedHead, undefined, 'system head must be first')
      if (op === 'append') { if (role === 'system' && surface.length === 0) protectedHead = seq; surface.push(seq) }
      else {
        assert.ok(object(op), 'surface marker'); assert.deepEqual(Object.keys(op).sort(), ['endSeq', 'op', 'startSeq'])
        assert.equal(op.op, 'replace'); earlier(op.startSeq, seq); earlier(op.endSeq, seq)
        const first = surface.indexOf(op.startSeq), last = surface.indexOf(op.endSeq)
        assert.ok(first >= 0 && last >= first, 'replacement current surface endpoints')
        const removed = surface.slice(first, last + 1)
        assert.ok(removed.every(value => refs?.includes(value)), 'replacement covers every removed node')
        if (removed.includes(protectedHead!)) { assert.equal(role, 'system'); assert.equal(removed.length, 1); protectedHead = seq }
        if (role === 'tool') {
          assert.equal(removed.length, 1); const original = records[removed[0]!]!
          assert.equal(original.type, 'tool/result')
          const previous = original.data as Data
          assert.deepEqual({ ...d, message: { ...message, content: null } }, { ...previous, message: { ...previous.message, content: null } })
        }
        if (role === 'user' && message.source.kind === 'compact-checkpoint') compactOwner(message.source)
        surface.splice(first, removed.length, seq)
      }
    }
    if (event.type.startsWith('turn/')) assert.equal(compact, undefined, 'turn boundary crosses open compaction')
    switch (event.type) {
      case 'turn/start': assert.equal(turn, null); assert.equal(d.turn, nextTurn); turn = nextTurn++; nextStep = 1; break
      case 'turn/end': requireTurn(); assert.equal(d.turn, turn); assert.equal(step, null); assert.equal(calls.size, 0); turn = null; break
      case 'step/start': requireTurn(); assert.equal(d.turn, turn); assert.equal(step, null); assert.equal(d.step, nextStep); step = nextStep++; break
      case 'step/end': requireStep(d); assert.equal(calls.size, 0); step = null; break
      case 'system/message': case 'developer/message': case 'assistant/attempt': requireStep(d); break
      case 'assistant/message':
        requireStep(d)
        for (const block of message.content) {
          assert.ok(object(block))
          if (block.type !== 'tool-call') continue
          nonempty(block.id); assert.ok(!calls.has(block.id)); calls.set(block.id, { ...block, started: false })
        }
        break
      case 'tool/call': {
        requireStep(d); nonempty(d.callId); assert.equal(typeof d.arguments, 'string')
        const call = calls.get(d.callId); assert.ok(call && !call.started); assert.equal(call.name, d.name); assert.equal(call.arguments, d.arguments); call.started = true; break
      }
      case 'tool/result':
        if (event.surfaceOp !== 'append') { requireTurn(); break }
        requireStep(d); assert.equal(calls.get(message.toolCallId)?.started, true, 'fixture tool result must have a start (no synthetic fork repair fixtures)')
        calls.delete(message.toolCallId); break
      case 'request/header': requireTurn(); requestHeader(d); provider = d.header.config.provider; break
      case 'request/context': requireTurn(); break
      case 'tool/ptc-dispatch-start': case 'tool/ptc-dispatch': {
        requireTurn(); nonempty(d.subCallId); nonempty(d.rootCallId); nonempty(d.parentCallId)
        if (d.parentCallId !== d.rootCallId) assert.equal(dispatches.get(d.parentCallId)?.rootCallId, d.rootCallId)
        const prior = dispatches.get(d.subCallId)
        if (event.type.endsWith('-start')) { assert.equal(prior, undefined); dispatches.set(d.subCallId, { ...d, settled: false }) }
        else { assert.ok(prior && !prior.settled); for (const key of ['rootCallId', 'parentCallId', 'name', 'arguments']) assert.deepEqual(d[key], prior[key]); prior.settled = true }
        break
      }
      case 'llm/retry': {
        requireTurn(); assert.equal(d.turn, turn); assert.equal(d.step, step ?? nextStep - 1); assert.equal(d.provider, provider); nonempty(d.retryId); count(d.retry)
        const prior = [...retries].reverse().find(r => ['turn', 'step', 'provider', 'policyKey'].every(key => r[key] === d[key]))
        assert.equal(d.retry, prior ? prior.retry + 1 : 1)
        if (prior) assert.equal(d.retryId, prior.retryId)
        else assert.ok(!retries.some(r => r.retryId === d.retryId))
        retries.push(d); break
      }
      case 'llm/retry-started': {
        nonempty(d.retryId); count(d.retry)
        const prior = retries.find(r => r.retryId === d.retryId && r.retry === d.retry)
        assert.ok(prior); assert.equal(d.turn, prior.turn); assert.equal(d.step, prior.step)
        const key = JSON.stringify([d.retryId, d.retry]); assert.ok(!starts.has(key)); starts.add(key); break
      }
      case 'model/selection': pair(d); if (d.reasoningEffort !== undefined) nonempty(d.reasoningEffort); break
      case 'command/run': nonempty(d.commandId); assert.ok(object(d.source)); nonempty(d.source.kind); assert.ok(!commands.has(d.commandId)); commands.add(d.commandId); pendingCommands.add(d.commandId); break
      case 'command/done':
        nonempty(d.commandId); assert.ok(commands.has(d.commandId)); assert.ok(pendingCommands.delete(d.commandId))
        if (d.sourceEventSeq !== undefined) { earlier(d.sourceEventSeq, seq); assert.equal(d.kind, 'success'); assert.ok(!records[d.sourceEventSeq]!.type.startsWith('command/')) }
        break
      case 'compaction/start':
        assert.equal(compact, undefined); nonempty(d.compactionId); if (d.sourceCommandId !== undefined) nonempty(d.sourceCommandId)
        assert.equal(d.turn, turn); compact = { id: d.compactionId, command: d.sourceCommandId, turn, summarized: false }; break
      case 'compaction/summary':
        compactOwner(d); assert.equal(compact!.turn, turn); assert.equal(compact!.summarized, false)
        span(d, seq); count(d.shadowedTokenCount); compact!.summarized = true; break
      case 'compaction/end':
        compactOwner(d); assert.equal(d.turn, compact!.turn); assert.equal(d.turn, turn)
        if (d.error === undefined) assert.equal(compact!.summarized, true, 'successful compaction requires summary')
        compact = undefined; break
      case 'compaction/prune': span(d, seq); break
    }
  }
  if (!running) { assert.equal(turn, null); assert.equal(step, null); assert.equal(calls.size, 0); assert.equal(compact, undefined); assert.equal(pendingCommands.size, 0) }
}
