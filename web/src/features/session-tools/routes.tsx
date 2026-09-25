import type { RouteDef } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
const pages = [['files', 'ファイル'], ['file', 'ファイルの中身'], ['jobs', 'ジョブ'], ['subagents', 'サブエージェント'], ['goal', 'ゴール']] as const
export const routes: RouteDef[] = pages.map(([page, title]) => ({ path: `/s/:id/${page}`, render: () => <PageScaffold title={title}><p className="page-padding">準備中です</p></PageScaffold> }))
