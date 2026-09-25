import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Raw HTML and remote images are deliberately not rendered. */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`markdown ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    components={{ img: ({ alt }) => <span>{alt ? `画像：${alt}` : '画像'}</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{children}</ReactMarkdown></div>
}
