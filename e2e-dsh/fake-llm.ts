/**
 * A scripted stand-in for the DeepSeek chat-completions endpoint.
 *
 * The real DSH Host talks to this server through DEEPSEEK_BASE_URL, so the
 * Host, its transport, and the M3E browser client are real; only the model is
 * fake. Each reply is chosen from a marker in the latest user message, which
 * keeps every test deterministic and needs no API key or external network.
 */
import { createServer, type Server } from 'node:http'
import { appendFileSync } from 'node:fs'

export interface ChatMessage { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }
export interface ChatRequest { model: string; messages: ChatMessage[]; tools?: { function: { name: string } }[] }

export interface FakeLlm {
  readonly url: string
  readonly requests: ChatRequest[]
  /** Requests whose stream the client closed before the scripted reply finished, such as a stop. */
  readonly abandoned: ChatRequest[]
  close(): Promise<void>
}

/** Markers a test puts in its prompt to pick the scripted reply. */
export const MARK = {
  /** A reply streamed slowly enough for a test to observe partial text and stop it. */
  slow: '[[slow]]',
  /** A bash call that asks for wider sandbox permission, which DSH turns into an approval request. */
  approval: '[[approval]]',
  /** An ask_user_question call. */
  question: '[[question]]',
} as const

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => typeof part === 'object' && part && 'text' in part ? String((part as { text: unknown }).text) : '').join('')
  return ''
}

/** DSH appends runtime-context user messages, so read every user message of the current turn. */
function currentTurnText(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (let index = messages.length - 1; index >= 0 && messages[index]!.role !== 'assistant'; index--) {
    if (messages[index]!.role === 'user') parts.unshift(textOf(messages[index]!.content))
  }
  return parts.join('\n')
}

/** `会話：` plus the first human message, markers removed. */
export function titleFor(prompt: string): string {
  const first = /"text":"((?:[^"\\]|\\.)*)"/.exec(prompt)?.[1] ?? ''
  const text = first.replace(/\[\[[a-z]+\]\]\s*/g, '').trim()
  return `会話：${text || '統合試験'}`
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function startFakeLlm(options: { port?: number; log?: string } = {}): Promise<FakeLlm> {
  const requests: ChatRequest[] = []
  const abandoned: ChatRequest[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      void (async () => {
        if (!req.url?.includes('chat/completions')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return }
        const request = JSON.parse(body) as ChatRequest
        requests.push(request)
        const last = request.messages.at(-1)
        const prompt = currentTurnText(request.messages)
        if (options.log) appendFileSync(options.log, `${JSON.stringify({ last: last?.role, prompt: prompt.slice(-200), tools: request.tools?.length ?? 0 })}\n`)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        let closed = false
        let done = false
        res.on('close', () => { closed = true; if (!done) abandoned.push(request) })
        const base = { id: `fake-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: request.model }
        const send = (delta: Record<string, unknown>, finish: string | null = null) => {
          if (!closed) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
        }
        const finish = (reason: string) => {
          send({}, reason)
          if (!closed) res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`)
          done = true
          if (!closed) { res.write('data: [DONE]\n\n'); res.end() }
        }
        const words = async (parts: string[], delay: number) => {
          for (const part of parts) { if (closed) return; send({ content: part }); await sleep(delay) }
        }
        send({ role: 'assistant', content: '' })
        // Title generation and other side requests carry no tools. The title
        // names the first human message so tests can tell sessions apart.
        if (!request.tools?.length) { await words([titleFor(prompt)], 0); finish('stop'); return }
        if (last?.role === 'tool') { await words(['ツールの結果を受け取りました。'], 20); finish('stop'); return }
        if (prompt.includes(MARK.slow)) {
          await words(Array.from({ length: 200 }, (_, index) => `第${index + 1}節。`), 150)
          finish('stop'); return
        }
        if (prompt.includes(MARK.approval)) {
          send({ tool_calls: [{ index: 0, id: 'call-approval', type: 'function', function: { name: 'bash', arguments: '' } }] })
          send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: 'echo m3e-approval-ok', description: 'Print a test marker', sandbox_permissions: 'danger-full-access', justification: '統合試験の承認確認です。' }) } }] })
          finish('tool_calls'); return
        }
        if (prompt.includes(MARK.question)) {
          send({ tool_calls: [{ index: 0, id: 'call-question', type: 'function', function: { name: 'ask_user_question', arguments: '' } }] })
          send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ questions: [{ id: 'color', question: '統合試験の質問です。どちらを選びますか？', options: [{ label: '赤' }, { label: '青' }] }] }) } }] })
          finish('tool_calls'); return
        }
        await words(['こんにちは', '。', '偽の', 'モデル', 'です。'], 30)
        finish('stop')
      })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(String(error)) })
    })
  })
  await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    abandoned,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}
