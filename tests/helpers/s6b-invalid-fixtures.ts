import assert from 'node:assert/strict'
import { histories } from './s6b-histories.ts'

type Event = { type: string; seq: number; time: number; data: Record<string, any>; surfaceOp?: any; sourceEventSeqs?: number[]; ignorable?: true }
export function invalidFixtureCases() {
  const all = histories()
  const clone = (id: string) => structuredClone(all.find(row => row.id === `default/${id}`)!.records) as Event[]
  const find = (events: Event[], type: string) => { const e = events.find(e => e.type === type); assert.ok(e, type); return e }
  const cases: { id: string; records: Event[]; reason: RegExp }[] = []
  const add = (id: string, source: string, change: (events: Event[]) => void, reason: RegExp) => {
    const records = clone(source); change(records); cases.push({ id, records, reason })
  }
  add('N1 tool result contains developer-only removal', 'chat-samples', es => { find(es, 'tool/result').data.message.content[1] = { type: 'tool-removal', toolName: 'read_file' } }, /developer role/)
  add('N2 error with isError false', 'chat-spec-check', es => { es.find(e => e.type === 'tool/result' && e.data.error)!.data.message.isError = false }, /isError true/)
  add('N3 empty header.tools', 'trace-example', es => { find(es, 'request/header').data.header.tools = [] }, /empty tools/)
  add('N4 compaction start changes id', 'trace-example', es => { find(es, 'compaction/start').data.compactionId = 'other-compaction' }, /other-compaction/)
  add('N5 compaction end changes turn', 'trace-example', es => { find(es, 'compaction/end').data.turn = 1 }, /1 !== 2/)
  add('N6 missing compaction end crosses turn', 'trace-example', es => { es.splice(es.findIndex(e => e.type === 'compaction/end'), 1); es.forEach((e, seq) => { e.seq = seq }) }, /crosses open compaction/)
  add('X01 empty adapterDefaults', 'trace-example', es => { find(es, 'request/header').data.header.adapterDefaults = {} }, /nonempty adapterDefaults/)
  add('X02 retired header.system', 'trace-example', es => { find(es, 'request/header').data.header.system = '' }, /header.system/)
  add('X03 adapter default without config', 'trace-example', es => { find(es, 'request/header').data.header.adapterDefaults = { maxTokens: true } }, /config value/)
  add('X04 invalid header reason', 'trace-example', es => { find(es, 'request/header').data.reason = 'unknown' }, /request reason/)
  add('X05 noncanonical startsSeries', 'trace-example', es => { find(es, 'request/header').data.startsSeries = false }, /false !== true/)
  add('X06 false deferLoading', 'trace-example', es => { find(es, 'request/header').data.header.tools = [{ name: 'x', deferLoading: false }] }, /false !== true/)
  add('X07 obsolete stream block', 'trace-example', es => { find(es, 'assistant/message').data.stream.push({ type: 'chunk', chunk: { type: 'block-start', blockType: 'tool-result' } }) }, /retired tool-result/)
  add('X08 developer-only summary block', 'trace-example', es => { find(es, 'compaction/summary').data.summary = [{ type: 'tool-addition', toolName: 'x' }] }, /developer role/)
  add('X09 wrong compaction sourceCommandId', 'trace-example', es => { find(es, 'compaction/end').data.sourceCommandId = 'another-command' }, /another-command/)
  add('X10 incomplete shadowed span', 'trace-example', es => { find(es, 'compaction/summary').data.shadowedSeqs.splice(1, 1) }, /every current surface node/)
  add('X11 fractional compaction tokens', 'trace-example', es => { find(es, 'compaction/summary').data.shadowedTokenCount = 0.5 }, /safe integer/)
  add('X12 duplicate surface references', 'trace-example', es => { const e = es.find(e => typeof e.surfaceOp === 'object')!; e.sourceEventSeqs = [...e.sourceEventSeqs!, e.sourceEventSeqs![0]!] }, /4 !== 3|3 !== 4/)
  add('X13 extra replacement key', 'trace-example', es => { Object.assign(es.find(e => typeof e.surfaceOp === 'object')!.surfaceOp!, { oldStart: 0 }) }, /oldStart/)
  add('X14 log-only surface marker', 'trace-example', es => { find(es, 'llm/retry').surfaceOp = 'append' }, /append/)
  add('X15 command source references itself', 'readme-review', es => { const e = find(es, 'command/done'); e.data.sourceEventSeq = e.seq }, /earlier event/)
  add('X16 retry skips attempt', 'trace-example', es => { find(es, 'llm/retry').data.retry = 2 }, /2 !== 1/)
  add('X17 nested dispatch changes parent', 'trace-example', es => { find(es, 'tool/ptc-dispatch').data.parentCallId = 'missing' }, /trace-root/)
  add('X18 legacy producer wrapper', 'chat-samples', es => { find(es, 'user/message').data.source = { kind: 'plugin', plugin: 'unknown' } }, /plugin/)
  add('X19 system text is non-string', 'chat-samples', es => { find(es, 'system/message').data.message.content[0].text = 7 }, /string/)
  add('X20 nonboolean tool isError', 'chat-samples', es => { find(es, 'tool/result').data.message.isError = 'false' }, /boolean/)
  add('X21 envelope extra key', 'trace-example', es => { Object.assign(es[0]!, { extra: true }) }, /envelope fields/)
  add('X22 command id reused after completion', 'chat-spec-check', es => { for (const e of es) if (e.data.commandId === 'spec-success') e.data.commandId = 'spec-failed' }, /commands.has/)
  add('X23 success without compaction summary', 'trace-example', es => { find(es, 'compaction/summary').type = 'request/context' }, /requires summary/)
  add('X24 replacement refers to removed surface node', 'trace-example', es => {
    const first = es.find(e => typeof e.surfaceOp === 'object')!
    const duplicate = structuredClone(first); duplicate.seq = first.seq + 1; duplicate.data.id += '-again'
    es.splice(duplicate.seq, 0, duplicate); es.forEach((e, seq) => { e.seq = seq })
  }, /current surface endpoints/)
  for (const suffix of ['invalid', '01', '9007199254740992']) add(`X25 fork result reserved suffix ${suffix}`, 'chat-samples', es => {
    const e = find(es, 'tool/result')
    e.data.message.id = `forked-tool-result-${e.data.message.toolCallId}-${suffix}`
    e.data.message.isError = true
    e.data.error = { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' }
  }, /not-started fork result identity/)
  return cases
}
