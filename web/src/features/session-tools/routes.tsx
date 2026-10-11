import type { RouteDef } from '../../app/router.ts'
import { conversationPaths } from '../../app/conversation-route.ts'
import { FilesScreen } from './FilesScreen.tsx'
import { FileScreen } from './FileScreen.tsx'
import { JobsScreen } from './JobsScreen.tsx'
import { GoalScreen } from './GoalScreen.tsx'
import { SubagentsScreen } from './SubagentsScreen.tsx'
import './session-tools.css'
export const routes: RouteDef[] = [
  { path: conversationPaths.files, render: ({ id }) => <FilesScreen key={id} sessionId={id!} /> },
  { path: conversationPaths.file, render: ({ id }) => <FileScreen key={id} sessionId={id!} /> },
  { path: conversationPaths.jobs, render: ({ id }) => <JobsScreen key={id} sessionId={id!} /> },
  { path: conversationPaths.subagents, render: ({ id }) => <SubagentsScreen key={id} sessionId={id!} /> },
  { path: conversationPaths.goal, render: ({ id }) => <GoalScreen key={id} sessionId={id!} /> },
]
