import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMessages } from '../i18n/index.ts'
import { markdownMessages } from './messages.ts'
import { pageHref } from './route-match.ts'

/** Raw HTML and remote images are deliberately not rendered. */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  const text = useMessages(markdownMessages)
  return <div className={`markdown ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    components={{ img: ({ alt }) => <span>{alt ? text.imageNamed(alt) : text.image}</span>, a: ({ children, href }) => <a href={href == null ? href : pageHref(href, window.location.href)} target="_blank" rel="noopener noreferrer">{children}</a> }}>{children}</ReactMarkdown></div>
}
