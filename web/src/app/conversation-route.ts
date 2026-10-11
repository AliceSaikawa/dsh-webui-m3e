import { resolveRoute } from './route-match.ts'

/** Shared by route registration, reference ownership and overlay ownership. */
export const conversationPaths = {
  chat: '/s/:id', trace: '/s/:id/trace', files: '/s/:id/files', file: '/s/:id/file',
  jobs: '/s/:id/jobs', subagents: '/s/:id/subagents', goal: '/s/:id/goal',
} as const
const definitions = Object.values(conversationPaths).map(path => ({ path, render: () => null }))

export function conversationSessionId(path: string): string | undefined {
  const route = resolveRoute(path, definitions)
  return route.definition ? route.params.id || undefined : undefined
}
