import { memo } from 'react'
import { Markdown } from '../../app/Markdown.tsx'

/** Stable string props keep unrelated stream updates out of the Markdown parser. */
export const ChatMarkdown = memo(Markdown)
