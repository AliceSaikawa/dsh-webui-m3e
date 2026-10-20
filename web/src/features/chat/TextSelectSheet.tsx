import { useEffect, useRef, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { M3eButton } from '@m3e/react/button'
import { pageHref } from '../../app/route-match.ts'
import { showSnackbar } from '../../app/overlay/index.ts'
import { useMessages } from '../../i18n/index.ts'
import { chatActionMessages } from './messages.ts'
import { codeBlockCopyText, type MessageBody, type MessageTextState } from './text-selection.ts'

function CodeBlock({ label, onCopy, children }: { label: string; onCopy: (code: string) => void; children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null)
  return <div className="chat-code-block">
    <M3eButton className="chat-code-copy" onClick={() => onCopy(codeBlockCopyText(code.current?.textContent ?? ''))}>{label}</M3eButton>
    <pre ref={code}>{children}</pre>
  </div>
}

function SelectableMarkdown({ text, copyLabel, onCopyBlock }: { text: string; copyLabel: string; onCopyBlock: (code: string) => void }) {
  const components: Components = {
    img: ({ alt }) => <span>{alt ? `画像：${alt}` : '画像'}</span>,
    a: ({ children, href }) => <a href={href == null ? href : pageHref(href, window.location.href)} target="_blank" rel="noopener noreferrer">{children}</a>,
    pre: ({ children }) => <CodeBlock label={copyLabel} onCopy={onCopyBlock}>{children}</CodeBlock>,
  }
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{text}</ReactMarkdown></div>
}

/** A full sheet where Safari can select text. The transcript keeps the long-press sheet. */
export function TextSelectSheet({ state, body, close }: { state: MessageTextState; body: MessageBody; close: () => void }) {
  const text = useMessages(chatActionMessages)
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const sheet = root.current?.closest('m3e-bottom-sheet') as HTMLElement | null
    const focus = () => {
      if (!sheet?.matches(':popover-open') || sheet.hidden || sheet.inert) return
      root.current?.querySelector('h2')?.focus({ preventScroll: true })
    }
    sheet?.addEventListener('opened', focus)
    sheet?.addEventListener('toggle', focus)
    focus()
    return () => {
      sheet?.removeEventListener('opened', focus)
      sheet?.removeEventListener('toggle', focus)
    }
  }, [])
  const copyBlock = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      showSnackbar(text.blockCopied)
    } catch {
      showSnackbar(text.blockCopyFailed)
    }
  }
  return <section className="chat-select" ref={root} data-chat-select={body} data-chat-streaming={state.streaming ? 'true' : 'false'}>
    <header className="chat-select-header">
      <h2 tabIndex={-1}>{text.selectTitle}</h2>
      <M3eButton onClick={close}>{text.close}</M3eButton>
    </header>
    <p className="chat-select-help">{text.selectHelp}</p>
    {state.streaming && <p role="status">{text.streamingHint}</p>}
    <div className="chat-select-body" aria-label={text.selectBody}>
      {body === 'plain'
        ? <p className="chat-select-plain">{state.text}</p>
        : <SelectableMarkdown text={state.text} copyLabel={text.copyBlock} onCopyBlock={code => void copyBlock(code)} />}
    </div>
  </section>
}
