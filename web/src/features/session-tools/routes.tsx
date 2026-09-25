import type { RouteDef } from '../../app/router.ts'
import { FilesScreen } from './FilesScreen.tsx'
import { FileScreen } from './FileScreen.tsx'
import { JobsScreen } from './JobsScreen.tsx'
import { GoalScreen } from './GoalScreen.tsx'
import { SubagentsScreen } from './SubagentsScreen.tsx'
import './session-tools.css'
export const routes: RouteDef[] = [
  { path: '/s/:id/files', render: ({ id }) => <FilesScreen key={id} sessionId={id!} /> },
  { path: '/s/:id/file', render: ({ id }) => <FileScreen key={id} sessionId={id!} /> },
  { path: '/s/:id/jobs', render: ({ id }) => <JobsScreen key={id} sessionId={id!} /> },
  { path: '/s/:id/subagents', render: ({ id }) => <SubagentsScreen key={id} sessionId={id!} /> },
  { path: '/s/:id/goal', render: ({ id }) => <GoalScreen key={id} sessionId={id!} /> },
]
