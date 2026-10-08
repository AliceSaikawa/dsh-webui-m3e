# 00 共通の土台

段階 1 で、Codex 1 本だけで作ります。これが main に入るまで、ほかの機能は始めません。

## 目的

各機能が互いを待たずに並行で作れるように、次のものを先に用意します。

- 画面の枠（上のバー、下のナビゲーションバー、戻るボタンの付いた画面、会話画面）
- 画面の切り替え（URL、戻る操作、左端からのスワイプ）
- DSH との接続の窓口と、セッション 1 件を扱う窓口
- シート、ダイアログ、スナックバーの仕組み
- ツール承認と AI からの質問を受け取って溜めておく仕組み
- 開発用の偽データ（`?mock`）
- 各機能の「仮の部品」（決まった形だけを持ち、中身は空の画面や関数）

## 担当するファイル

段階 1 の担当は、次のファイルを作ったり変えたりしてよいです。

- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- `web/index.html`、`web/src/main.tsx`
- `web/src/app/` の全部
- `web/src/dsh/` の全部（今あるファイルを含む）
- `web/src/features/*/` の仮の部品（下の「仮の部品」の表のファイルだけ）
- `web/src/App.tsx`（消して `web/src/app/App.tsx` に移す）
- `tests/00-*.test.ts`
- `README.md` の「今の状態」と「コマンド」
- この設計書の「実装メモ」

`src/host/`、`src/client/`、`src/shared/` は変えません。

## 入れる依存

段階 2 以降は依存を足せないので、ここでまとめて入れます。版は入れる時点の最新の安定版に固定します。

- `@m3e/web` と `@m3e/react`：部品集。2026-09-25 に採用が決まりました（`docs/handoff.md` の「部品集の実機比較」）。比較のときの版は 2.8.2 です。
- Material Symbols のフォント（Outlined、可変フォント）：npm のパッケージから woff2 を同梱します。Google Fonts から読み込みません。
- Markdown の描画：`react-markdown` と `remark-gfm`。チャットの返事（02）、プランの本文（05）、ファイルの中身（09）で使います。生の HTML は描かない設定にします。`web/src/app/Markdown.tsx` に、テーマに合わせた `Markdown` 部品として包んで置きます。
- ほかに必要と分かったものがあれば、ここで入れて、実装メモに理由を書きます。

## フォルダの構成

```text
web/src/
  main.tsx                 起動。?mock なら偽の ctx、そうでなければ bootDsh()
  app/
    App.tsx                根。テーマ、シートの置き場、画面の切り替え
    router.ts              ハッシュによる画面の切り替え
    routes.ts              features/*/routes.tsx を集める
    shell/                 画面の枠（TabScaffold、PageScaffold、EdgeSwipeBack、ConnectionBanner）
    overlay/               シート、ダイアログ、スナックバーの置き場
    viewport.ts            キーボードに合わせて画面の高さを変える
    theme/                 テーマの色、明暗、外観の設定の保存
    icons/                 Material Symbols のフォントと Icon 部品
  dsh/
    boot.ts, boot-graph.ts, node-module-shim.ts, use-snapshot.ts   今あるもの
    services.ts            DSH の窓口と型
    session.ts             セッション 1 件の窓口（useSession）
    interactions.ts        ツール承認と AI からの質問の受け取り
    remote-result.ts       RemoteResult の扱いとエラーの文言
    mock/                  偽の ctx と共通の偽データ
  features/
    conversation/          会話画面の枠（段階 1 の担当のまま）
    home/ chat/ composer/ trace/ interactions/ inbox/ search/ settings/ session-tools/
```

## 画面の切り替え

サーバーは `/m3e/` の直下しか画面を返さないので、URL のハッシュで画面を切り替えます。

| URL | 画面 | 担当 |
|---|---|---|
| `#/` | 一覧（下のタブ） | 01 |
| `#/search` | 検索（下のタブ） | 07 |
| `#/inbox` | 対応待ち（下のタブ） | 06 |
| `#/settings` | 設定（下のタブ） | 08 |
| `#/settings/<ページ>` | 設定の詳細 | 08 |
| `#/workspaces/add` | フォルダの選択 | 01 |
| `#/new?ws=<ワークスペース id>` | 新しいセッション | 03 |
| `#/s/<セッション id>` | 会話（チャット） | 00 の枠、中身は 02・03 |
| `#/s/<セッション id>/trace` | 会話（トレース） | 00 の枠、中身は 04 |
| `#/s/<セッション id>/files?path=<パス>` | ファイル | 09 |
| `#/s/<セッション id>/file?path=<パス>` | ファイルの中身 | 09 |
| `#/s/<セッション id>/jobs` | ジョブ | 09 |
| `#/s/<セッション id>/subagents` | サブエージェント | 09 |
| `#/s/<セッション id>/goal` | ゴール | 09 |

`router.ts` が提供するもの：

- `useRoute()`：今の画面のパターン名と引数
- `navigate(path, { replace? })`：画面を移る。下のタブどうしの切り替えと、チャットとトレースの切り替えは `replace` にして、戻る操作の対象にしません（`docs/ui-spec.md` の「画面遷移の決まり」）。
- `back()`：来た画面に戻る。履歴がないとき（URL を直接開いたとき）は一覧に戻る。
- `RouteDef` 型：`{ path: string; tab?: 'home' | 'search' | 'inbox' | 'settings'; render(params): ReactNode }`

`routes.ts` は `import.meta.glob('../features/*/routes.tsx', { eager: true })` で各機能の `routes` を集めます。同じ `path` が 2 回登録されたら、開発時にコンソールへ警告を出します。

## 画面の枠

- **TabScaffold**：下のタブの 4 画面の枠です。上のバー（中身は各機能が渡す）、本文、右下の FAB の置き場、下のナビゲーションバーを持ちます。ナビゲーションバーは「一覧・検索・対応待ち・設定」の順で、対応待ちのアイコンは `front_hand` です。件数のバッジは `features/inbox/count.ts` の `useInboxCount()` から取ります。
- **PageScaffold**：奥の画面の枠です。← の付いた上のバーと本文を持ちます。← は `back()` を呼びます。
- **EdgeSwipeBack**：画面の左端から右へのスワイプで `back()` を呼びます。ホーム画面から開いた Web アプリにはブラウザの戻る操作がないため、自前で持ちます。
- **ConnectionBanner**：接続が切れたときのバナーと、再接続中の細い進捗バーです（`docs/ui-spec.md` の「接続が切れたとき」）。TabScaffold と会話画面の上のバーの下に出します。`useConnection()` で接続状態を他の機能にも渡します。
- **safe-area**：`@m3e/web` の部品は safe-area を扱わないので、ナビゲーションバー、下に出すシート、上のバーに `env(safe-area-inset-*)` の余白を付け、その部分にもバーと同じ背景色を塗ります。
- **キーボード**：画面の枠を `position: fixed` にし、`top` と `height` を `visualViewport` の `offsetTop` と `height` に合わせます（`viewport.ts`）。部品集の比較のときに、この組み方で上のバーを残したまま入力欄がキーボードのすぐ上に来ることを確かめています（`tmp/libtest/src/hud.tsx` と `shared.css`）。

## 会話画面の枠

`features/conversation/ConversationScreen.tsx` は段階 1 の担当が作り、段階 2 では変えません。

- 上のバー：←（`back()`）、題名（`displayTitle`）、右に `features/session-tools/SessionMenu.tsx` の `SessionMenuButton`
- その下に「チャット / トレース」のタブ。切り替えは `replace` で URL を変えます。
- 本文：チャットなら `features/chat/ChatView.tsx` の `ChatView`、トレースなら `features/trace/TraceView.tsx` の `TraceView`
- 下：チャットのときだけ `features/composer/Composer.tsx` の `Composer`。トレースのときは出しません。
- 承認と質問：このセッションに未回答の承認や質問が来たら、チャットでもトレースでも、`features/interactions/InteractionSheet.tsx` の `presentInteraction(pending, { from: 'conversation' })` を呼んでシートを出します。返事が必要なシートが開いている間は、`Composer` を出しません。
- 入力欄の上（チャットのときだけ）に `features/interactions/PendingChip.tsx` の `PendingChip({ sessionId })` を描きます。「あとで」にした返事待ちを開き直すためのものです。

## DSH の窓口（services.ts）

今の `App.tsx` と同じく、DSH の型を自分で書き直して持ちます（DSH のパッケージを型のために読み込みません）。`useDsh()` で次のものを返します。

- `connection`：`state`（`ObservableSnapshot`）、`reconnect()`
- `sessions`：`list`（`SessionListState`）、`create`、`search`、`fork`、`refresh`、`openSubagent`、`scope`、`binding`
- `workspaces`：`ctx.workspaces` の `list` と各操作。`ctx.remote.workspace` は RPC の名前空間で、画面からは使わない。
- `remote`：`ctx.remote` をそのまま（型は緩いままでよい。各機能が自分のフォルダで型を書き直す）

型は `SessionSummary`、`SessionListState`、`WorkspaceView`、`WorkspaceSnapshot`、`SessionSnapshot`、`QueuedMessage`、`SessionWireEvent`、`ContentBlock`、`RemoteResult`、`RemoteFailure` を用意します。中身は API の調査メモの §3、§8 に合わせます。

## セッション 1 件の窓口（session.ts）

チャット、入力欄、トレース、会話の補助の 4 つが同じ窓口を使うので、ここで決めます。

- `useSession(id)` が返すもの
  - `face`：`ISession`（`prompt`、`beginSubmission`、`updateQueue`、`cancel`、`rename`、`loadOlder`、`command`、`readAttachment`、`projections`）
  - `snapshot`：`SessionSnapshot`（`running`、`queue`、`pendingSubmissions`、`hasMore`、`loadingOlder`、`promptError`、`lastAgentError`、`openState` など）
  - `records`：履歴のイベント（`SessionWireEvent[]`）を古い順に
  - `stream`：生成中の応答（assistant-stream）の今の中身
  - `projection(key)`：`projections.faceOf(key)` を読むフック
- 取り出し方は、`sessions.scope(id)` で Agent の ctx を得て、`sessions.sessionOf(scopeCtx)` で `ISession` を得る想定です。DSH の型（`dsh-api-session-controller/lib/types/client/contract/`）で確かめ、違っていたら実装メモに書いてください。
- 履歴の追従（follow ストリーム）と、再接続したときの復元（`snapshot` の baseline と `nextIndex`）は、ここでまとめて扱います。各機能は `records` と `stream` を読むだけにします。
- 会話を開いたら `sessions.open(id)` を呼び、今開いている会話を DSH に知らせます。

## 承認と質問の受け取り（interactions.ts）

- 起動時に 1 回だけ `ctx.remote.$on('approval/request', …)` と `ctx.remote.$on('user-questions/request', …)` を登録します。どちらもブラウザが答えを返せるイベント（waterfall）で、ハンドラの `this` が質問の来たセッションの ctx です（今の画面の `dsh-client-ui-approval` と `dsh-client-ui-user-questions` がこの形）。
- 届いたものを `PendingInteraction` として溜めます。
  - `{ key, kind: 'approval', sessionId, toolName, callId?, reason?, answer(outcome) }`
  - `{ key, kind: 'question', sessionId, items, answer(answer) }`。`items` のどれかの `intent.kind` が `'plan-review'` なら、プランの確認として扱います。
- `usePendingInteractions(sessionId?)` で一覧を読めます。答えるか、DSH 側で取り消されたら（`signal` の中断）一覧から消えます。
- `defer(key)` で「あとで」の印を付けられます。会話画面は、印の付いたものを自動では開きません。印は、そのセッションの会話画面を開き直すと消えます。
- 答えの型は API の調査メモの §9.1、§9.2 に合わせます（`ApprovalOutcome`、`AskUserQuestionAnswer`）。

## シート、ダイアログ、スナックバー（overlay/）

- `openSheet(render, { dismissible })`：下から出るシートを開き、閉じる関数を返します。`dismissible: false` なら、下に払っても閉じません（返事が必要なシート）。シートを開いている間は背景がスクロールしないようにします。
- `openFullSheet(render)`：全画面のシート（プランの確認で使う）。
- `openDialog(render)`：ダイアログ。
- `TextPromptDialog`：文字を 1 つ入力して「OK」「キャンセル」を選ぶダイアログ。題名の変更（01、09）とワークスペースの名前の変更（01）で使います。
- `showSnackbar(message)`：スナックバー。`@m3e/web` のスナックバーは命令的に呼び出す API なので、ここで包みます。
- シートは戻る操作の対象にしません。

## テーマ（theme/）

- Canvas の `paletteKey` は `purple` です。M3 の紫を種の色にして、明暗の両方を用意します。
- 外観（明暗）は、この端末ごとに `localStorage` に保存します。値は「端末の設定に合わせる」「ライト」「ダーク」で、既定は「端末の設定に合わせる」です。`useAppearance()` と `setAppearance()` を用意し、画面は 08 が作ります。
- 「今の画面に戻す」の処理（Cookie `dsh-webui` を `classic` にして `/` へ移る）を `backToClassic()` として置きます。今の `App.tsx` にある処理を移します。

## 偽データ（mock/）

- `pnpm dev` で `?mock` を付けて開くと、`bootDsh()` の代わりに偽の ctx で起動します。本番のビルドには含めません（`import.meta.env.DEV` のときだけ読み込む）。
- 偽の ctx は、`services.ts` と `session.ts` が使う窓口を、メモリの中の値で実装します。`ObservableSnapshot` の形も同じにします。
- 共通の偽データは Canvas の中身に合わせます。
  - ワークスペース 3 つ（`dsh-webui-m3e`、`deepseek-harness`、`notes`）
  - 「README の見直し」（待機中）：履歴は Canvas の `chatDetail` の中身（自分のメッセージと画像、考えた内容、`read_file` の成功、`bash` の失敗、返事、`/permission` のコマンドの結果）
  - 「承認シートの実装」（実行中）：履歴は Canvas の `trace` の中身（ターン 2 は完了、ターン 3 は実行中）
  - この 2 つの履歴は 02 と 04 の両方が使うので、ここで作り、段階 2 では変えません。
- 各機能は `features/<機能>/mock.ts` で `extendMock(kit)` を書き出して、自分の偽データを足します。`kit` は次の関数を持ちます。
  - `addWorkspace`、`addSession(summary, records)`：ワークスペースやセッションを足す。各機能は、共通の 2 つのセッションの履歴を書き換えず、必要なら自分のセッションを足します。
  - `addRemote(namespace, impl)`：`ctx.remote` の名前空間を足す。同じ名前空間を 2 つの機能が足したら、開発時にコンソールへ警告を出します。
  - `emit(event, payload, { afterMs })`：イベントを発火する（例：承認の要求を 3 秒後に出す）。
  - `streamAssistant(sessionId, text, { chunkMs })`：生成中の応答を少しずつ流す。
  - `setProjection(sessionId, key, value)`：projection の値を置く（例：`permissions`、`tokenUsage`）。
  - `patch(path, impl)`：窓口の関数を差し替える（例：`patch('sessions.search', …)`）。
  - `updateList(fn)`：一覧の状態（`jobsBySession`、`subagentsByParent` など）を書き換える。
- 偽の `ISession` は、`beginSubmission` と `prompt` で送ったメッセージを履歴に足し、実行中なら順番待ち（`queue`）に入れます。`updateQueue`、`cancel`、`rename`、`command`、`loadOlder` も、それらしく動くようにします。
  - `scenario(name, setup)`：`?mock&scenario=<名前>` で開いたときだけ `setup(kit)` を実行する状態を登録する。
- 00 が用意する状態は `disconnected`（接続切れ）と `reconnecting`（再接続中）です。各機能の状態の名前は、各設計書に書いてあります。

## 仮の部品

段階 1 で、次のファイルを「決まった形だけを持ち、中身は仮」の状態で作ります。段階 2 では、各機能がこのファイルを自分のものとして書き換えます。引数と戻り値の形は、段階 2 で変えません。

| ファイル | 書き出すもの | 担当 |
|---|---|---|
| `features/home/routes.tsx` | `routes`（`#/`、`#/workspaces/add`） | 01 |
| `features/home/HomeScreen.tsx` | `HomeScreen()` | 01 |
| `features/chat/ChatView.tsx` | `ChatView({ sessionId })` | 02 |
| `features/composer/Composer.tsx` | `Composer({ target })`。`target` は `{ kind: 'session'; sessionId }` か `{ kind: 'new'; workspaceId }` | 03 |
| `features/composer/routes.tsx` | `routes`（`#/new`） | 03 |
| `features/trace/TraceView.tsx` | `TraceView({ sessionId })` | 04 |
| `features/interactions/InteractionSheet.tsx` | `presentInteraction(pending: PendingInteraction, { from: 'conversation' \| 'inbox' })` | 05 |
| `features/interactions/PendingChip.tsx` | `PendingChip({ sessionId })`（仮は何も描かない） | 05 |
| `features/inbox/routes.tsx`、`InboxScreen.tsx` | `routes`（`#/inbox`）、`InboxScreen()` | 06 |
| `features/inbox/count.ts` | `useInboxCount(): number` | 06 |
| `features/search/routes.tsx`、`SearchScreen.tsx` | `routes`（`#/search`）、`SearchScreen()` | 07 |
| `features/settings/routes.tsx`、`SettingsScreen.tsx` | `routes`（`#/settings`、`#/settings/:page`）、`SettingsScreen()` | 08 |
| `features/session-tools/SessionMenu.tsx` | `SessionMenuButton({ sessionId })` | 09 |
| `features/session-tools/routes.tsx` | `routes`（`#/s/:id/files` など） | 09 |
| `features/*/mock.ts` | `extendMock(kit)`（中身は空） | 各機能 |

会話画面の `#/s/:id` と `#/s/:id/trace` の登録は、`features/conversation/routes.tsx` に段階 1 の担当が書きます。

## テスト

- `tests/00-router.test.ts`：URL のパターンの一致と引数の取り出し
- `tests/00-interactions.test.ts`：承認と質問の溜め方、答えたあとと取り消されたあとの消え方
- 今ある `tests/*.test.ts` は通ったままにします。

## 完了条件

- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。
- `?mock` で開くと、下のタブの 4 画面（中身は仮）と、会話画面の枠（チャットとトレースの切り替え、← で戻る）が動きます。
- 偽データの承認の要求を出すと、会話画面で仮のシートが開きます。
- 実物の DSH での確認はしません（段階 1 と 2 は偽データだけ）。`bootDsh()` の経路を壊していないことは、`tests/boot-graph.test.ts` が通ることと、`?mock` を付けずに開いたときに今と同じ「DSH の Host が描いたページではない」旨のエラーが出ることで確かめます。
- `README.md` の「今の状態」と「コマンド」を、`?mock` の使い方を含めて更新します。

## 実装メモ

### 2026-10-07：Issue #48、生成中ブロックの到着順を保持

- 利用者の許可により、共有の `session-journal.ts` を修正した。ブロック番号をソートせず、最初に届いた順番を保持する。block-start の時点で順番を登録し、後着のツールのデルタにも同じ順番を使う。未変更ブロックのオブジェクト再利用と増分処理は維持する。
- `tests/00-session.test.ts` の交互に届くブロックの期待順を、DSH 0.2.0-rc.2 の実際の `BlockAssembler` と一致する到着順へ変更した。確定との対応付け・重複防止・検証結果は [02 の Issue #48 実装メモ](02-chat.md) に記録した。

### 2026-09-25：読み取り調査の拒否により着手前に停止

- 作業場所が `feat/00-foundation` で、開始時に未コミットの変更がないことを確認した。共通・プロジェクトの AGENTS.md、設計 README、本設計書、画面仕様と既存の起動処理を読んだ。
- 次の読み取り操作が PreToolUse フックに拒否されたため、依頼の「拒否された操作は回避せず止める」に従い、実装と並列の調査を停止した。別コマンド・別ツールでの再試行はしていない。
  - `README.md`、`web/index.html`、`pnpm-workspace.yaml` の読み取りと、段階 2 の設計書内の依存・未確認事項などの検索をまとめたコマンド。拒否理由は `Opaque shell wrappers are blocked unless Codex can split them into allowed commands.`。
  - インストール済み DSH の session controller・既存 UI 配下の型ファイルを、禁止パスの除外指定付きで列挙する調査。拒否理由は `tool input references a protected path or sensitive filename pattern`。この操作とまとめていた API 調査メモの続きの読み取りも取得できなかった。
- 未確認のこと：実物の `sessions.scope` / `sessionOf`、履歴の follow・baseline・nextIndex、waterfall イベントの現行契約は確認が完了していない。推測で実装せず、未確認のまま残した。DSH は起動していない。
- API 調査メモ §9.1 / §9.2 では、承認の答えが `allowed-once | rejected | cancelled | unavailable` で、要求にツールの引数がないこと、質問の `intent.kind === 'plan-review'` がプラン確認を示すことを確認した。ただし、インストール済みプラグインとの照合は未完了。
- 依存の候補は npm registry の `version` で、`@m3e/web` / `@m3e/react` が `2.8.2`、`material-symbols` が `0.47.5`、`react-markdown` が `10.1.0`、`remark-gfm` が `4.0.1` と確認できた。導入・互換性検証は行っていない。
- 自分で決めたこと：共有契約を未検証のまま固定しない。実装ファイルと依存を変更せず、この停止記録だけを残す。
- 検証：実装前の停止のため、`pnpm typecheck`、`pnpm test`、`pnpm build` と `?mock` の画面操作は未実施。
- 全担当のファイル変更がないことを回収し、この実装メモだけが差分であることを確認した。停止記録に対する `git diff --check` は成功。
- 担当外で必要になったソース変更：なし。再開には、上記の読み取りを許可された形で実行できることの確認が必要。フックや権限設定は変更していない。

### 2026-09-25：許可された再試行と、コード編集の拒否

- ユーザーから再試行の許可を得て、先に拒否された読み取りを、連結しない単独コマンドで実行した。README、HTML、workspace 設定、段階 2 の設計書検索、禁止パスの除外付き DSH 型ファイル一覧はすべて取得できた。読み取りの停止要因は解消した。
- 続いて `web/src/main.tsx` に、この設計書の「偽データ」節で指定された Vite の開発モード判定と、mock の条件付き読み込みを追加しようとしたところ、`apply_patch` が PreToolUse フックに拒否された。理由は `Blocked: tool input references a protected path or sensitive filename pattern`。
- 現在の保護フックは、編集先だけでなく差分本文の文字列も部分一致で判定する。今回の差分では、Vite の開発モード判定式に含まれるプロパティ名が禁止ファイル名の文字列に一致する。保護対象ファイルの読み書きを要求した操作ではない。
- 拒否されたコード編集は適用されていない。別表記・別ツールでの回避はせず、実装を再度停止した。DSH は起動していない。実装、3 つの検証コマンド、画面操作は引き続き未完了。
- 担当外で必要になった対応：個人の保護フックの誤検知への対応。実際の禁止パスへのアクセス制限を保ちつつ、許可されたソースの開発モード判定式を編集できる必要がある。フックは担当範囲外のため変更していない。

### 2026-09-25：明示許可後の実装

上の停止記録はその時点の記録として残す。その後、ユーザーが個人フックの誤検知修正を許可したため、禁止パスの判定を維持したまま、この worktree の TypeScript ソース差分にある Vite の開発判定式だけを認識する修正を行った。修正前のバックアップを保存し、構文と 65 件のポリシー確認が成功した。実際の禁止対象にはアクセスしていない。修正対象は `/Users/user/.codex/hooks/protect_sensitive_paths.rb`。プロジェクトの AGENTS.md や権限設定は変更していない。

#### 実装した共通基盤

- ハッシュルーター、画面の自動収集、4 タブの枠、戻る画面、左端スワイプ、接続状態、会話のチャット／トレース枠を作った。タブ間の移動は履歴を置換し、直接開いた詳細画面の戻り先は一覧にする。
- safe-area と visualViewport に対応した固定の画面枠、紫を種にした明暗テーマ、端末別の外観保存、ローカル同梱の Material Symbols、HTML を描画しない Markdown 部品を作った。Markdown 内の画像は代替テキストとし、外部画像を自動取得しない。
- シート・全画面シート・ダイアログ・文字入力ダイアログ・スナックバーを共通化した。シートは URL の履歴に追加しない。応答必須のシートは取り消し操作を拒否し、表示中は背景操作と入力欄を止める。
- 全担当の仮の部品と空の `mock.ts` を作った。会話画面の枠以外の機能は段階 2 が置き換える。

#### 段階 2 が使う公開入口

- `app/router.ts`：`useRoute()` は `path`（登録パターンまたは null）、`pathname`、`params`、`query`、`tab`、`definition` を返す。`params` はクエリー引数も含むが、パス引数を優先する。`RouteDef.render(params)` は ReactNode を返す。
- `app/shell/index.ts`：`TabScaffold({ title?, topBar?, children, fab?, tab? })`、`PageScaffold({ title, children, actions?, footer? })`、`useConnection()`。後者は `state / connected / lastConnectedAt / reconnect` を返す。接続成功時刻が不明の切断画面では、架空の経過時間を出さず、保存済みデータと表示する。
- `app/overlay/index.ts`：`openSheet / openFullSheet / openDialog` は `ReactNode` または `(close) => ReactNode` と任意の options を受け、何度呼んでも安全な `close(): void` を返す。従来の `dismissible / label / interactionKey / sessionId` に任意の `owner` を追加した。`owner: { kind: 'conversation', sessionId }` は同じ会話の全補助画面に属し、`owner: { kind: 'route', path }` はクエリーを含む指定ルートに属する。省略時は開いた URL から自動設定する。Frame の `OverlayRouteScope({ path })` が持ち主の画面を離れたシートを取り除く。応答シートの `sessionId` は要求の識別用で、owner とは別（対応待ち画面からの回答にも使える）。
- OverlayHost は下のシートの React 部品をマウントしたまま保ち、いちばん上の 1 枚だけを表示・操作可能にする。隠れた面は `hidden` と `inert`、上面は native modal の切り替え中に `inert` が再付与されても解除する監視を持つ。監視は上面を隠す前に止める。割り込み時も入力・処理中・結果の状態を保持するため、次のシートを開く前に下を閉じる必要はない。明示的な close と所有画面からの離脱では破棄する。ネイティブのシート／ダイアログは閉じ終わってから次を開く。通常シートは実際の handle 属性を設定し下へのスワイプで閉じられるが、`dismissible: false` の応答必須シートは閉じない。
- `TextPromptDialog({ title, initialValue?, label?, multiline?, rows?, confirmLabel?, onConfirm, onCancel })` の `onConfirm(value)` は `void` または `Promise<void>`。確定ボタンは `confirmLabel` で指定でき、既定は従来の「OK」。01 は「保存」「作成」を渡せる。既定は従来の単行 input で、前後の空白を除いた値を渡す。03 の順番待ち編集では `multiline: true` を指定すると textarea になり、Enter は改行、字下げ・改行を含む原文を渡す。`rows` は任意で既定 4。空白だけの値はどちらも送らない。保存失敗は `remoteErrorMessage` の日本語文言を出す。保存成功後に閉じる責任は呼び出し元が持つ。`Markdown({ children, className? })` の children は Markdown 文字列。
- `app/theme/index.ts`：`useAppearance()` は `system | light | dark`、`setAppearance(value)` と `backToClassic()`。`app/icons/Icon.tsx`：`Icon({ name, slot?, filled?, className? })`。
- 共通 CSS の派生トークン：`--app-space-xs / s / m / l / xl` は基準 `--app-space: 16px` の 1/4・1/2・1・1.5・2 倍（4・8・16・24・32px）。`--app-radius-s / m / l / xl` は基準 `--app-radius: 28px` の 3/7・4/7・5/7・1 倍（12・16・20・28px）、`--app-radius-pill` は 999px。各機能は固定値を置き換える際に利用できる。切断バナーの色は `tertiary-container / on-tertiary-container`。
- 画面遷移は Frame の `useRouteMotion(pathname)` が管理する。下の 4 タブ間は 160ms のフェード、詳細への移動は右から、履歴を戻るときは左から 220ms で入る。ルーターに追加した `getRouteHistoryIndex()` で方向を判定し、直接 URL を開いた画面から一覧へ戻る場合も逆向きにする。チャット／トレースとクエリーだけの変更は動かさず、画面をアニメーション用に再マウントしない。`prefers-reduced-motion` では動かさず、途中で有効にされた場合も停止する。
- テーマの html 側と M3eTheme 側は同じ色種 `#6750A4`・`tonal-spot`・標準コントラストで、同梱 M3e 2.8.2 と同じ DynamicScheme へ 6 パレットを渡して計算する。surface / background はライト `#fdf8fd`、ダーク `#141316`。10 は manifest の background_color / theme_color と index.html の明暗 theme-color をこの値へ更新する（00 では 10 のファイルを変更しない）。外観 API と Theme の引数は維持する。
- `dsh/services.ts`：`DshProvider / useDsh` と共有型。`dsh/session.ts`：`useSession(id)` は `face / snapshot / records / stream / projection / ctx`。開けない ID の `face` は undefined。`projection<T>(key)` はフックなので、最上位で無条件に呼ぶ。別名の `useSessionProjection(face, key)` も用意した。
- `useSession(id)` は読むだけで、`sessions.open` を呼ばない。会話の選択は App の Frame 内に置いた、null を返す `ConversationSelection({ pathname })` が URL で管理する。`useConversationSelection(pathname)` の一覧・face の購読はこの小さな部品内に閉じ、一覧の更新だけでは Frame・画面の描画関数・OverlayHost を描き直さない。履歴や projection を読む部品自身には、選択・解除の責任を持たせない。
- `#/s/<id>` とその下のチャット・トレース・09 の全補助画面は同じ選択を保つ。選択には削除済みでない face に加え、`list.byId[id]` または `sessions.subagentAddress(id)` が必要。この条件を共通の `canSelectConversation` で判定し、その真偽値も effect の依存に含める。URL・face・phase が変わらず一覧へ追加された場合も選択する。scope しかない ID は ready 後も選択しない。会話内の選択は下記 `openConversationSession` を使い、同期例外・カタログ取得失敗は console.error と日本語スナックバーで知らせ、画面全体へ投げない。face の参照変更だけでは選び直さない。会話 URL 以外では、従来どおり一覧が ready になり選択が残っている場合だけ `sessions.clear()` を呼ぶ。部品単位の unmount cleanup では解除しない。
- `dsh/session-navigation.ts` の `openConversationSession(sessions, sessionId, isActive?): Promise<boolean>` は通常会話と子の選択の共通入口。通常会話は一覧で存在を確かめ、`current !== id` の場合だけ open する。`origin === 'subagent'` または保持済み子アドレスがある場合は親のカタログを解決し、子の ID・kind・mode を照合して openSubagent する。カタログが未取得なら refreshSubagents を待ち、同じ親への同時取得は共有する。09 が既に同じアドレスを選択済みなら再選択しない。`isActive` は既定で true、取得中に画面を離れた場合は false を返す関数を渡すと選択せず Promise が false で完了する。true は選択済み、取得・検証失敗は reject。01・05・06・09 は入口を共通化する際に使い、成功後の navigate は各機能が行う。URL 直開きも Frame から同じ関数を使う。
- `dsh/session-access.ts` の `sessionAccess(summary, snapshot)` は `{ isSubagent, mode, canCompose, readOnly }` を返す。origin と snapshot のアドレスで子を判定し、子 ID・親 ID が一致する検証済み continuable だけ `canCompose: true`。one-shot と mode 未確認の子は読むだけ。通常の分岐は parentId があっても子として扱わない。ConversationScreen はこの判定で入力欄を出し分ける。03・09 は入力・編集の判定に同じ関数を利用する（通常会話の removed・busy などの条件は各機能が別に守る）。
- 取得エラーでも有効な会話は選択の対象とし、mock のエラー状態は mock 側で保持する。同じ会話を一覧から開き直すだけでは実物の再取得を保証できないため、取得エラー画面の「もう一度開く」でページを再読み込みする。「戻る」は既存の back を使う。実物で起動時の選択が復元されるかは段階 3 で確かめる。
- **01・02・04 への失敗通知の契約**：初回取得・背景 follow の失敗は既存の `useSession(id).snapshot.openState / openError` を使う。mock は `kit.setSessionState(id, { openState: 'error', openError: failure })` で再現する。一覧は**初回に限り、`await sessions.refresh()` の完了後も phase が pending なら失敗と判断してよい。ready 後の通常の取得失敗は知る手段がない**。pending 単独では取得中と失敗を区別できず、この判定から具体的原因も分からない。`sessions.manager` は実行時には読めるが、公開の型では private なので使わない。手動の `loadOlder / loadThrough` の取得失敗も実物の API では知る手段がない（2026-09-26 の調査根拠を下記に記載）。sessions.list や SessionSnapshot に架空のエラー欄を足さず、mock にもその失敗通知を足さない。`loadingOlder === false` や履歴件数が増えないことは成功・枯渇時にも起こり、失敗の判定に使わない。mock で初回一覧取得の失敗を再現する場合は `updateList` で phase を pending にし、`patch('sessions.refresh', async () => {})` などで refresh 完了後もその状態を保つ。
- `SubagentAddress` は `{ parentSessionId, childSessionId, mode: 'one-shot' | 'continuable' }`。09 は子のカタログ行の mode をそのまま渡す。ID だけから mode を推測しない。mock の `openSubagent` も親のカタログの子 ID・kind・mode を照合し、不一致なら選択を変えずに例外にする。シナリオでは `addSession` で子の履歴を用意し、`updateList` で `subagentsByParent[parentSessionId].entries` に `{ kind: 'child', id, mode, ... }` を登録する。
- **02・04 の入口変更**：`ChatView({ sessionId, active })` と `TraceView({ sessionId, active })` に必須の `active: boolean` を追加した。正常な会話では両方をマウントしたまま、非表示側のパネルに `hidden` と `inert` を付ける。同じ会話のタブ切り替えでは部品と DOM を再作成せず、展開状態・検索条件と閲覧位置を保持する。別の会話へ移る、会話画面から出る、会話を開けない状態になる場合の保持は対象外。
- 両パネルは独立した高さ 100% のスクロール領域を持ち、共通の `main` 自体はスクロールしない。02・04 は各パネル、またはその中で高さ 100% に収まる専用要素をスクロール対象にし、二重のスクロールを作らない。土台の `data-scroll-area` は表示中のパネルだけに付く。非表示側はレイアウト・フォーカス・アクセシビリティツリーの対象外とし、隠れる本文や消える入力欄にフォーカスが残る場合は表示先のタブへ移す。
- 土台の `RetainedScrollPanel` が非表示の直前にルートパネルと **`data-scroll-area` を付けた子孫だけ**の縦・横スクロール位置を保存し、再表示時に同じ DOM 要素へ即時復元する。02・04 が内部に独自のスクロール領域を作る場合は、その実際にスクロールする要素に `data-scroll-area` を付ける。ルートパネルは自動で対象になる。目印のない子孫はスクロール位置の読み取り・保存の対象外で、非表示中に消えた要素には復元しない。02・04 の引数は前回追加した `active` のままで、保存のための引数は増やさない。実ブラウザでの位置保持とフォーカスはオーケストレーターがブラウザで確かめる。
- **02・04 が守ること**：`active === false` の間は末尾への自動移動・寸法による末尾判定・フォーカス移動を行わない。タイマー、スクロール監視、予約済みのフレーム処理も停止する。初回の末尾移動は初めて `active === true` になり履歴を表示できたときだけ行い、非表示中に初回表示済みの印を付けない。再表示だけを理由に初回の移動を繰り返さず、保持した閲覧位置・表示状態から再開する。非表示中も履歴データの購読は続けてよい。
- `stream` は `{ attemptId, turn, step, chunks, content, usage?, finishReason? } | null`。`content` は復元済みの ContentBlock 配列。`finishReason` は文字列でなく `{ kind: ... }`。
- `dsh/interactions.ts`：`initializeInteractions(ctx)` を描画前に一度呼ぶ。`usePendingInteractions / defer / resetDeferred / isPlanReview` を公開。pending の `deferred` は boolean、`answer()` は `Promise<void>`。`presentInteraction(pending, { from })` の戻り値は `close(): void`。ユーザーの決定 2 に従い、別の会話を訪れてから元の会話へ戻ったときだけ deferred を解除する。Frame の訪問 tracker が担当し、同じ会話のチャット／トレース／09 の補助画面との往復や、一覧だけを経由した往復では解除しない。各機能のマウントで resetDeferred を重ねて呼ばない。
- ConversationScreen は `dsh/interaction-presentation.ts` の `shouldHideComposer(sessionId, pending, overlays): boolean` で入力欄の表示を決める。同じ会話の未回答の承認は、05 の「トレースで見る」で deferred になっても回答・取消まで Composer を隠す。質問・プランの「あとで」は、応答シートが閉じれば入力を許す。deferred でない要求と、同じ会話の interactionKey 付きシートが残る間も入力欄を隠す。仮の部品の引数・戻り値は変更していない。
- `dsh/mock/kit.ts`：MockKit の型入口。すべての指定関数を実装した。`emit` と `streamAssistant` は Promise を返す。`emit` の宛先は payload の `agent`（セッション ID）または `sessionId` で指定する。`addWorkspace` は WorkspaceView、`addSession` は SessionSummary と履歴を受け取る。`updateList` は新しい一覧を返す形と渡された一覧を変更する形の両方に対応する。`scenario` は名前に合う URL のときだけ実行する。
- MockKit の共有設定：08 が `registerSettingsReader(namespace => namespaces.get(namespace)?.value)` を一度登録し、03 は会話作成時に `getSettingsValue<T>('permission')` などで現在の既定値を読む。reader は ctx ごとに 1 つで後からの重複登録は console.warn で無視、ctx 破棄で解除する。値の二重管理はせず毎回 reader を呼び、返り値を複製する。未登録・未知 namespace は undefined。既定権限の namespace は permission、値の項目は defaultPreset。既存会話へ遡って適用するための API ではない。
- MockKit の共有 projection：`getProjection<T>(sessionId, key): T | undefined` と `updateProjection<T>(sessionId, key, current => next): void` を追加した。最新の共有値の複製を読み、更新関数は完全な次の値を返す。03 のモデル変更では current を展開して next だけ更新し、01・09 が書いた lastUsed を残す。setProjection も受け取る値を複製する。未登録 projection は undefined、未登録会話と更新関数の例外は投げて状態を変更しない。model face と一覧の projectionValues を同時に更新する。
- MockKit の `isScenario(...names: (string | undefined)[]): boolean` は extendMock 実行中にも選択シナリオを照合できる。undefined はシナリオ指定なしのデモ。例：`if (kit.isScenario(undefined, 'home-demo'))` の中だけでデモ要求や完了印を登録する。既存 scenario の登録・実行順と関数の形は変えず、01・06・09 が全拡張統合時の要求を出し分けるために使う。
- `dsh/workspace-errors.ts`：`normalizeWorkspaceError(error): unknown` と `workspaceOperation<T>(() => Promise<T>): Promise<T>` を公開する。DSH の workspace rename/delete/reorder/session archive/move が文字列化した失敗から RemoteCallError を復元し、既に構造化された失敗や未知の例外はそのまま保つ。01・09 は共通関数を通したあと remoteErrorMessage へ渡す。成功後の遷移は各機能が持つ。
- `MockKit.updateWorkspace(workspaceId, update): void` を追加した。update は `Partial<Omit<WorkspaceView, 'workspaceId'>>` または `(current: WorkspaceView) => Partial<Omit<WorkspaceView, 'workspaceId'>>`。既存行へ patch を浅くマージし、ID とワークスペースの並びを保って更新を通知する。01 などが共通ワークスペースへ会話を足すときは、`kit.updateWorkspace(id, w => ({ sessionIds: [...w.sessionIds, addedSessionId] }))` とし、先に他機能が追加した ID を残す。配列は置換で、会話自体の登録は引き続き addSession を使う。関数には現在値の複製を渡し、返した patch も複製する。存在しない ID または関数の例外は更新せずに投げる。既存の MockKit 関数の形は変えない。
- **06 の即時シナリオ**：ctx 構築中の `extendMock` / シナリオ内で遅延なしの `kit.emit()` を使える。受け手が未登録なら、そのイベントの最初の `$on` 登録後の microtask で一度だけ配送し、承認・質問・プランを対応待ちへ入れる。シナリオの状態設定は引き続き同期実行する。`emit()` の Promise は承認・質問への回答まで待つ。構築完了後の通常の未登録イベントは保留・後日再生しない。配送前の ctx 破棄・対象セッション削除で保留要求を片付ける。
- MockKit に `setSessionState(sessionId, patch: Partial<SessionSnapshot>): void`、`removeSession(sessionId): void`、`removeWorkspace(workspaceId): void` を追加した。`lastAgentError`、`openState: 'error'` と `openError`、`promptError` は `setSessionState` で設定できる。共通データを消すシナリオには後の 2 関数を使う。既存の 9 関数の引数と戻り値は維持した。偽データに `ctx.remote.workspace` は置かない。
- mock は会話を選ぶと通常・子とも完了の未読印を解除する。生成開始で前回の印を解除し、正常完了時に未選択の会話だけ印を付ける。`addSession` / `addWorkspace` の ID 重複は `console.error` で知らせ、その 1 件だけを無視する。既存データと後続の拡張登録は保持し、引数・戻り値は変えない。
- `MockExtension` は任意の `source?: string` を受け取る。Vite の機能収集では元の `features/<機能>/mock.ts` のパスを自動で付け、各 `extendMock(kit)` が投げた例外を出所とともに `console.error` へ出して次の機能へ進む。各機能が source を書き出す必要はなく、`extendMock(kit): void` は変更しない。直接渡す拡張で source を省略した場合は拡張の順番を示す。mock の検索上限は実物と同じ 20 件で、超過時は hasMore を返す。

#### 未確認事項を静的に照合した結果と判断

参照元はインストール済み DSH の `node_modules/@deepseek-ai/` 以下。参照だけで、DSH 本体の変更・起動はしていない。

1. `scope(id)` → `sessionOf(scope)` は設計どおり。SessionFace 自身が `getSnapshot / subscribe` を持つ。履歴は `binding(id).eventSource`。根拠は `dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`、`session.d.ts`、`events.d.ts`。
2. follow・再接続の baseline と nextIndex は既存 controller が管理する。二重に follow RPC を始めず、復元された eventSource を共有購読する。根拠は同 `sessions/session.js` と `sessions/assistant-stream.js`。複数 consumer は同じ派生キャッシュを使う。
3. ワークスペースの設計上のパスは実物と異なった。observable の一覧と操作は `ctx.workspaces` で、`ctx.remote.workspace` は RPC 名前空間。`useDsh().workspaces` は実物に合わせた。根拠は `dsh-api-workspace-controller/lib/types/client/service.js` のサービス登録と同 `client/index.js`。
4. 既存 UI は承認・質問の宛先を `ctx.sessions.scopeOf(this)` で解決し、解決できなければ次の waterfall へ渡す。質問の wire payload は `questions`、公開 pending は設計どおり `items`。取消時は承認が signal.reason、質問が UserQuestionError / ASK_ABORTED。根拠は既存 `dsh-client-ui-approval` と `dsh-client-ui-user-questions` の client 実装。
5. `beginSubmission` は送信前 echo の登録で、実送信は `prompt` に requestId を渡して行う。偽データもこの順序にし、履歴の重複を避けた。ツール結果の入れ子、ターン開始とユーザーメッセージの順序、保存された stream の chunk 種別も実物に合わせた。
6. 共通の偽データは Canvas の chatDetail / trace の内容を使い、ID は `readme-review / approval-sheet`、ワークスペースは `ws-m3e / ws-harness / ws-notes`。承認デモは `approval-demo` とし、前者の会話に 1 秒後に要求を出す。
7. 追加で調べようとした `$on` の解除関数の詳細型は、型ディレクトリの内容検索に付けた禁止パス除外指定をフックが拒否したため未確認。該当調査を止め、代替の検索はしていない。登録戻り値が関数の場合だけ呼べる契約と、解除を持たない場合を扱い、偽の waterfall で一度だけの登録・解除を検証した。実接続での確認は段階 3 に残す。

#### 依存と検証

- 指定の依存は確認時の安定版に固定：M3E 両パッケージ 2.8.2、material-symbols 0.47.5、react-markdown 10.1.0、remark-gfm 4.0.1。
- 追加依存は `@material/material-color-utilities` 0.4.0（命令的スナックバーを含む document 全体の明暗色）と `@playwright/test` 1.63.0（段階 2 以降も使えるスマートフォン幅の操作検証）。Playwright の Chromium も検証用キャッシュに導入した。
- `pnpm typecheck` 成功、`pnpm test` は 45 件成功、`pnpm build` 成功。起動グラフなどの既存テストも維持。本番 JavaScript に偽データの固有文字列が含まれないことを確認した。
- 390×664 の Chromium で `?mock` の一覧表示と実行エラーがないことを確認した。続く一連の画面操作の検証コマンドは「Opaque shell wrappers」として拒否され、停止。検証内容を一時スクリプトとして実行する再試行の許可を確認中。
- 残る注意：既存 DSH store 配下の use-sync-external-store 1.2.0 には React 19 の peer 範囲警告がある。本番 JavaScript は約 881 KB、同梱フォントは約 4 MB で、Vite の chunk サイズ警告がある。実物の DSH 接続と iOS 実機・Simulator のキーボード検証は段階 3 に残す。

### 2026-09-25：レビュー指摘 1〜6 の修正

- 偽データの `remote.workspace = workspaces` を削除した。`ctx.remote.workspace` は undefined になり、画面が誤った窓口を使うと偽データでも動かない。明示された例外の範囲で、本文の workspaces の説明も `ctx.workspaces` に直した。
- MockKit に上記の状態設定と削除の 3 関数を追加した。削除したセッションは一覧、ワークスペースの sessionIds、scope / binding から消える。選択・送信前 echo・待機列・生成中の応答・遅延タイマーも片付け、古い face や同じ ID の再追加から古い処理が復活しないようにした。
- `useSession` の戻り値は維持し、開く副作用と `ensureSessionOpen` を削除した。会話の選択は `ConversationScreen` だけが行う。存在しない・削除済み・openState が error の face では開く操作を行わない。これにより、画面を描く前に設定した open-error シナリオも上書きされない。
- open error では `remoteErrorMessage(snapshot.openError)` と `back()` を呼ぶ「一覧に戻る」を表示する。「もう一度開く」を削除し、開けていない会話には Composer も表示しない。
- transient だけの append では直前の records 配列を再利用する。revision が飛んだ場合は確定イベントの参照と件数を照合し、同じときだけ再利用する。初回や途中で確定イベントが増えた場合は窓全体から復元する。event の追加・replace は新しい配列にし、stream は毎回復元する。
- OverlayHost のコードは変更せず、下のシートの状態が保たれない制約と、別のシートやダイアログを開く前に閉じる手順を「段階 2 が使う公開入口」に追記した。

#### 静的に確かめたことと、実装上の判断

- インストール済み `dsh-api-session-controller/lib/client.js` の `open(id)` は `manager.select(id)` を呼ぶ。同 `lib/types/client/sessions/manager.js` の select は選択中 ID を変え、`completedNotifications.delete(sessionId)` で未読の完了印を消す。一覧になく保持された子セッションのアドレスもない ID は例外になる。そのため、状態を読むフックからは選択を呼ばない。
- `client.js` の followCurrent は `current === this.watched` なら終了する。同じ ID の open だけで再読み込みできるとは扱わず、再試行ボタンは設けない。実物は読み取りだけで、DSH は起動していない。
- MockKit の既存 9 関数の引数・戻り値と `dsh/mock/kit.ts` の型公開は維持した。削除を繰り返しても安全にし、セッションがない場合の `setSessionState` は既存 kit と同様に誤った ID として例外にする。sessionId は snapshot の patch で変更できない。

#### 今回の検証

- `pnpm typecheck`：成功。
- `pnpm test`：55 件すべて成功。MockKit の状態設定・削除・誤った remote の不在と、records の配列同一性・event 追加・replace・取りこぼした revision の復元を検証した。React の描画テストは追加していない。
- `pnpm build`：成功。既存の Vite chunk サイズ警告は残る（JavaScript 約 884 KB、同梱フォント約 4 MB）。
- 既存の 5173 番の Vite が停止していたため、この worktree で `pnpm dev` を起動した。IPv6 の localhost で待ち受けていたので、表示された `http://localhost:5173/m3e/` を使用した。
- 390×664 の Chromium で `?mock` の「一覧 / 検索 / 対応待ち / 設定」の 4 画面を操作した。README の会話でチャット／トレースの切り替え、入力欄の表示切り替え、← による一覧への復帰が成功した。
- `?mock&scenario=approval-demo#/s/readme-review` で「ツールの承認」シートが開いた。`?mock#/s/missing` で「会話が見つかりません。」と「一覧に戻る」が表示され、押すと一覧へ戻った。再試行ボタンと入力欄は表示されない。各操作でブラウザーの実行時エラーはなかった。
- 最初のブラウザー検証は IPv4 宛ての接続失敗、次は Web Component の外側にあると仮定した aria-current の検証が失敗した。Vite の実際の待受とアクセシビリティ情報を確認し、表示された URL とボタン・見出しで再検証した。今回、操作の拒否や禁止事項の回避はない。
- 担当外で必要になった変更：なし。ほかの設計書、main、DSH 本体は変更していない。

#### 段階 3 で確かめること

- 本物の DSH で、会話を開けなかったあとに再試行するための公開された操作があるか、別の会話へ移動して戻ると再読み込みされるかを確かめる。同じ ID の `sessions.open` の呼び直しで復旧できるかは、静的なコードでは見込めないため、実動作の確認を残す。
- 会話画面に入ったときだけ選択中の会話と完了の未読印が更新され、ほかの画面で `useSession` を読むだけでは変わらないことを実物で確かめる。従来の DSH 接続・iOS キーボードの確認も段階 3 に残る。

### 2026-09-25：残ったレビュー 3 件の調査中に読み取りが拒否されたため停止

- 開始時のブランチは `feat/00-foundation`、HEAD は `c619529`。追跡済みファイルに未コミットの変更はなかった。共通・プロジェクトの AGENTS.md、設計書 README、本書の実装メモと関連仕様を読んだ。
- 現行コードの静的確認では、3 件とも指摘の原因が残っている。
  1. `web/src/dsh/services.ts` の `SubagentAddress` には `parentSessionId` と `childSessionId` だけがあり、`mode` がない。実物の型・検証処理との照合および実行による再現は、下記の拒否により未完了。
  2. `web/src/dsh/mock/context.ts` は生成関数の末尾でシナリオを同期実行する。`kit.emit()` はその時点のハンドラを取得する一方、`web/src/main.tsx` の `initializeInteractions()` は ctx の取得後に呼ばれる。遅延なしの初期イベントを受け取れない順序が残っている。Node での再現・回帰テストは未実施。
  3. `ConversationScreen.tsx` は `tab === 'chat'` の条件で `ChatView` と `TraceView` を入れ替えるため、タブ切り替えでアンマウントされる。状態保持方式の実装とブラウザーでの再現は未実施。
- 独立した調査をサブエージェントへ分担したが、次の読み取り検索がそれぞれ PreToolUse フックに拒否された。
  - インストール済み DSH の `dsh-api-session-controller` と、この worktree の `web/src/dsh`・`tests` に対する `SubagentAddress` / `openSubagent` の検索。
  - `tests/00-*.test.ts` と `web/src/features/*/mock.ts` に対するシナリオ・承認・質問・プラン関連の検索。
  - いずれも禁止対象を除外する glob を付けた `rg`。拒否理由は `Blocked: tool input references a protected path or sensitive filename pattern.`。拒否された検索結果は取得できていない。
- ユーザーの「拒否された操作は別の経路で回避せず、実装メモに書く」という指示に従い、両担当とも再試行せず停止した。全担当のソース変更なしを回収した。フック・権限設定は変更せず、DSH は起動していない。main にも触れていない。
- 今回の変更はこの停止記録だけ。共有型、mock、仮の部品の引数・戻り値は変更していない。「段階 2 が使う公開入口」への新しい契約の確定・追記は修正再開後に行う。
- 検証：実装前の停止のため、`pnpm typecheck`、`pnpm test`、`pnpm build` はすべて未実施。3 件とも未修正であり、既存の成功記録を今回の検証結果として扱わない。
- 担当外で必要になったソース変更：なし。再開には、上記の読み取りを許可された形で実行できることの確認が必要。担当外の保護フックをこの実行で変更しない。

### 2026-09-25：範囲を限定して調査を再開し、HTTP 確認の拒否で停止

- ユーザーから、安全なソースディレクトリに検索範囲を絞り、除外 glob を付けずに再開する明示許可を受けた。前節はその時点の記録として維持する。開始時は `feat/00-foundation`、HEAD は `f4a1c4b` で、追跡済みファイルに未コミットの変更はなかった。
- 許可された範囲への読み取り・検索は成功し、指摘 1 の実物との照合が進んだ。参照元はインストール済み DSH の `node_modules/@deepseek-ai/` 以下。実物の変更・起動はしていない。
  - `dsh-subagent/lib/types/control-types.d.ts:76–84` の `SubagentAddress` は、2 つの ID に加えて `mode: 'one-shot' | 'continuable'` を必須とする。
  - `dsh-api-session-controller/lib/types/client/sessions/service.js:159–160` の `openSubagent` は `manager.selectSubagent(address)` に委譲する。同 `manager.js:105–118` は親カタログの entries で子 ID を探し、未存在、`kind !== 'child'`、`entry.mode !== address.mode` で例外を投げ、成功時にアドレスを保持する。
  - 共有型には依然として mode がなく、mock の `openSubagent` も親子モデルの存在だけを確認してカタログ・mode を照合していない。共有型と mock の両方の修正が必要。実行による再現とテスト追加は未実施。
- 指摘 2 は、既存テストがシナリオによる状態の同期準備を前提にしていることを確認した。初期イベントだけを保留する方式を検討したが、まだ実装していない。指摘 3 も現行の条件分岐によるアンマウントを再確認した段階で、保持方式・部品の契約は未変更。
- 親担当による mock 開発画面の HTTP 応答確認 `curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost:5173/m3e/?mock` が PreToolUse フックに拒否された。理由は `Opaque shell wrappers are blocked unless Codex can split them into allowed commands.`。HTTP の結果は取得できず、サーバーが稼働しているかも未確認。これは前節の検索拒否とは別の操作。
- 再度拒否された場合は止めるというユーザー指示に従い、全担当の調査・実装を停止し、ソース変更なしを回収した。同じ HTTP 確認を別コマンド・ツールで再試行していない。保護フック・権限設定は変更していない。
- 今回も変更はこの追記だけ。3 件とも未修正で、「段階 2 が使う公開入口」の新しい契約はまだ確定していない。DSH は起動せず、main には触れていない。
- 検証：`pnpm typecheck`、`pnpm test`、`pnpm build` はすべて未実施。担当外で必要になったソース変更：なし。HTTP 確認の拒否に対する扱いを、次回の再開指示で確定する必要がある。

### 2026-09-25：拒否時の作業範囲を見直した指示を受け、残った 3 件を修正

- ユーザーから、拒否された操作だけを止め、その操作に依存しない修正・検証・コミットは続ける指示を受けた。過去の停止記録はその時点の記録として維持する。今回は開発サーバーの起動、HTTP 確認、ブラウザー操作を実施せず、Node のテストと指定の 3 コマンドで検証した。今回の再開中に拒否された操作はない。

#### 修正前の確認と実装

1. **サブエージェントの共有型と mock**：共有型の mode 欠落と、mock がカタログを照合しない問題は未修正だった。前節に記録した実物の照合結果を使い、`SubagentAddress.mode` を必須の `'one-shot' | 'continuable'` にした。mock は親カタログから子 ID を探し、`kind: 'child'` と mode の一致を要求する。未登録、診断行、mode の欠落・不一致では選択を変えずに例外にする。親が利用不可でも正常なカタログにある子は閲覧できる。
   - `addSession` の parentId だけから mode を推測しない。初期の snapshot.subagent は null とし、`openSubagent` 成功後に完全なアドレスを保存する。`subagentAddress` と、別の会話から `open(childId)` で戻る場合も mode を保持する。
   - 新規の Node テスト 6 件は修正前の mock ですべて失敗し、修正後に成功した。両 mode の正常系、欠落・不一致時の選択保持、未登録・診断行、親モデルを削除してカタログを再登録した場合の閲覧を検証した。既存の削除テストにも mode とカタログを追加した。
2. **初期シナリオの即時イベント**：遅延なしの承認・質問・プランが対応待ち 0 件になることを Node テストで再現した。ctx 構築中に受け手なしで出たイベントだけを保留し、該当イベントの最初のハンドラ登録後に一度だけ配送する方式を選んだ。同じ同期処理中に登録した waterfall 全体を使い、既存シナリオの同期状態設定と起動 API は維持した。
   - 回帰テストでは 3 件すべてが対応待ちへ入り、回答が emit の Promise へ戻ることを確認した。中断、登録解除、ctx 破棄、セッション削除・同じ ID の再作成でも不要な要求が残ったり復活したりしないことを含め、新規 8 件が成功した。
3. **会話内のタブ保持**：条件分岐で部品を入れ替える構造が残っていたため、正常な会話では ChatView / TraceView の両方を描いたまま、非表示側を `hidden` / `inert` にした。共通 main のスクロールを止め、各パネルに独立したスクロール領域を持たせた。非表示にする本文のフォーカス、または消える入力欄から失われたフォーカスは表示先のタブへ移す。
   - 仮の部品の契約変更は `ChatView({ sessionId, active })` と `TraceView({ sessionId, active })` の必須 boolean 追加だけ。返す画面の形や他の仮の部品の引数・戻り値は変更していない。
   - 「段階 2 が使う公開入口」に、方式と保持範囲、02・04 が非表示中の自動移動・寸法測定・フォーカス処理を止めること、初回の末尾移動を最初の可視表示まで待ち再表示時に繰り返さないことを書いた。09 の mode の渡し方と、06 の即時 emit の契約も同じ節に追記した。

#### 今回の検証と引き継ぎ

- `pnpm typecheck`：成功。
- `pnpm test`：69 件すべて成功（既存 55 件と新規 14 件）。起動グラフなどの既存テストも成功。
- `pnpm build`：成功。既存の Vite chunk サイズ警告は残る（JavaScript 約 885 KB、同梱フォント約 4 MB）。依存・ロックファイルは変更していない。
- 画面は未検証。ユーザー指示に従いオーケストレーターへ引き継ぐ。`?mock` で同じ会話のチャット／トレース間を切り替えた際の閲覧位置・表示状態、非表示側のフォーカス除外とスクロール独立性を確認する。02・04 は本実装で `active` の契約を守った上で、初回表示と再表示を確認する。React の描画テストは追加していない。
- 担当外で必要になった変更：なし。変更は 00 の担当ファイルと本書の実装メモ内のみ。main、DSH 本体、保護フック・権限設定は変更せず、DSH も起動していない。

### 2026-09-25：cdce8e7 の二者レビュー指摘 1〜9 を修正

#### 会話の選択と完了の印（1・2・3）

- `ConversationScreen` の選択処理を `dsh/conversation-selection.ts` へ分けた。存在する未削除の会話なら、openState が error でも入場時に `sessions.open(id)` を呼ぶ。mock の `open` は意図したエラーシナリオを上書きしないようにした。Node で取得失敗の A → B → A の選択呼び出しと、mock のエラー保持を確認した。
- 会話画面の layout effect の後片付けで、まだその会話が選択中の場合に `sessions.clear()` を呼ぶ。画面切り替えの commit 中に解除するので、一覧が見えた後の完了イベントを選択中として扱わない。チャット／トレースは同じ枠で、effect の依存に tab を含めないため解除しない。次の会話がすでに選ばれていれば古い後片付けは解除しない。
- 実物の根拠は、インストール済み `dsh-api-session-controller/lib/types/client/sessions/service.js:193` の clear → manager.clearSelection と、`manager.js:121` の selected の解除。clear は保存された選択も解除する API。`service.js:378` の followCurrent は別の会話から選び直すと session.open を呼ぶ。実物は読み取りだけで起動していない。
- mock の選択では内部モデルの summary と一覧の completed をともに false にする。通常・子の両方について、選択後の projection 更新や rename でも印が復活しないことを検証した。実物の select / selectSubagent が完了通知を消す根拠は `manager.js:85–117`。
- 回帰テストの過程で mock の正常完了が未読印を付けないことも分かったため、生成開始時は前回の印を消し、正常完了時は未選択の会話だけ印を付けるようにした。会話を離れてから完了すると印が付き、選択したままの完了では付かず、次の生成開始で以前の印が消えることを Node で確認した。

#### 複数行ダイアログ・失敗表示（4・7・8）

- 03 の順番待ち編集に必要な `TextPromptDialog` の任意の multiline と rows を追加した。既存の呼び方は単行のまま。複数行では textarea を使い、Enter で改行し、字下げ・改行を含む値を onConfirm に渡す。公開入口の引数と扱いを上の「段階 2 が使う公開入口」に更新した。
- 保存失敗は `remoteErrorMessage` で共通のエラーコードに応じた日本語を出す。未知の例外には従来の「保存できませんでした。もう一度お試しください。」を使い、再送信を始めると古いエラーを消す。
- App の最外層に ErrorBoundary を置いた。Provider、テーマ、画面、シートを含む描画中の例外を受け、日本語の案内と「読み直す」のボタンを表示する。ボタンはページを再読み込みする。テーマが壊れた場合も読める色の既定値、safe-area、44px 以上のボタンを用意した。イベントハンドラや非同期処理の失敗は各処理のエラー表示が扱う。

#### mock の契約・重複登録（5・9）

- 待機列項目のエラーを `session/queue-item-not-found` と `{ itemId }`、不正な題名を `session/title-invalid` と `{ sessionId }` に合わせた。根拠はインストール済み controller の `lib/types/types.d.ts:193–200` と `lib/types/commands.js:177,415`。誤った操作で待機列や題名・履歴が変わらないことも確認した。
- 重複する session / workspace ID は例外を投げず、console.error の後にその行だけを無視する。元の履歴・一覧を上書きせず、続く拡張の登録も実行する。既存の重複時例外を期待するテストを更新し、起動継続のテストを追加した。
- mock の選択・エラーコード・重複登録に対する新規 7 テストは、修正前にすべて失敗し、修正後に成功した。

#### スクロール保持（6）と検証範囲

- display:none で位置が失われるというブラウザ差は、今回の環境では未確認。明示的に位置を保存・復元する処理を土台に追加した。`RetainedScrollPanel` の getSnapshotBeforeUpdate で hidden 適用前の位置を読み、再表示後に同じ DOM 要素へ戻す。各機能が内側に作るスクロール領域も対象にし、取り外された要素は除外する。初回の表示では復元を行わない。
- Node の 2 テストで、非表示中に位置が 0 になった状況を模擬し、外側・内側の縦横位置が復元されること、削除された要素と別のパネルに干渉しないことを確認した。これはブラウザでの検証の代わりではない。
- **オーケストレーターがブラウザで確かめる**：チャット／トレースの往復時の実際のスクロール位置と表示状態、非表示側のフォーカス除外、複数行ダイアログの改行と保存失敗表示、描画エラー時の画面と「読み直す」。DSH の A → B → A の再取得と完了通知は段階 3 でも確認する。開発サーバー・DSH の起動、HTTP 確認、ブラウザー操作は行っていない。
- `pnpm typecheck`：成功。`pnpm test`：83 件すべて成功（従来 69 件と新規 14 件）。`pnpm build`：成功。既存の Vite chunk サイズ警告は残る（JavaScript 約 886 KB、同梱フォント約 4 MB）。React の描画テストは追加していない。
- 今回の新しい公開引数は TextPromptDialog の任意の multiline / rows だけ。仮の ChatView / TraceView を含む段階 2 の部品の引数・戻り値に追加変更はない。
- 担当外で必要になった変更：なし。担当ファイルと本書の実装メモだけを変更した。main、依存・ロックファイル、DSH 本体、保護フック・権限設定は変更していない。今回の操作拒否はない。実物の型の最初の読み取り先はファイル不在だったため、許可された同パッケージの lib 内で実際の配置を確認した。

### 2026-09-25：ae2bc3c の最終確認指摘 1〜9 を修正

#### URL による会話選択と再読み込み（1〜5）

- 選択処理を ConversationScreen から App の Frame 内の小さなフックへ移した。`/s/<id>` の先頭 ID をデコードし、その下の任意のパスを同じ会話として扱う。09 のファイル・ジョブ・サブエージェント・ゴールは部品が別でも選択を保ち、チャット／トレースとの往復で clear / open を繰り返さない。
- 選択側の依存は URL の ID と開けるかどうかの boolean にし、face の参照そのものを含めない。実際の open 前にも current を照合する。09 が openSubagent で選択してから URL を変える間は、その選択を元の URL で上書きしない。ConversationScreen の選択 effect と unmount 時の解除は削除した。
- 会話 URL 以外の画面では list.phase と current を監視し、ready 後に残った選択だけ clear する。初期描画より後に選択が復元される場合にも対応する。**実物で起動時に選択が復元されるかは未確認で、段階 3 で確かめる。** Node では pending 中の選択保持、ready 後の解除、初回 ready より後の選択到着を模擬した。
- 実物 controller の `lib/types/client/sessions/service.js:384` 付近では、選択解除中も watched を保持し、同じ ID の選び直しだけでは session.open へ進まない。会話取得エラー画面に「読み直す」を追加してページを再読み込みするようにした。「一覧に戻る」は維持する。公開 API にない再取得操作は追加していない。
- Node で URL の解釈、09 の全補助画面への往復、補助画面への直接アクセス、scope の維持と mock の goal projection 更新、閲覧中の完了印抑制、openSubagent 後の二重 open 防止、同等な face の入れ替えを検証した。A → B → A の選び直し・会話外への移動後の完了印など、前回の回帰も維持した。React の effect の実行や実物の追従はブラウザ・段階 3 の確認対象。

#### mock 拡張の分離・検索上限・エラー文言（6・8・9）

- extendMock の呼び出しだけを各機能ごとの try/catch で囲み、元の mock.ts のパスと例外を console.error に出し、後続の拡張を続ける。Vite の glob 収集がパスを optional な MockExtension.source に付ける。機能側の extendMock の引数・戻り値は維持した。例外までに登録したデータは保持し、選択したシナリオ自体の実行エラーの扱いは変更していない。
- mock の searchResultLimit を 30 から 20 に修正した。根拠はインストール済み `dsh-api-session-controller/lib/types/types.js:3` の SESSION_SEARCH_RESULT_LIMIT と、同 `lib/types/client/sessions/service.js:81` の使用箇所。21 件の一致から 20 件と hasMore=true を返す回帰テストを追加した。実物は読み取りのみ。
- `remoteErrorMessage` に gateway/bad-request（送信内容の確認）と gateway/internal（サーバーのエラー・時間を置いた再試行）の日本語文言を追加した。直接の失敗、rpcError、RemoteResult、unwrapRemoteResult が投げる例外の各経路を検証した。
- 拡張の例外と検索上限の新規テストは修正前に 3 件失敗し、修正後に成功した。gateway 文言の回帰も修正前の失敗から成功へ変わった。

#### スクロール対象の限定（7）と公開入口

- RetainedScrollPanel の全要素走査をやめ、ルートパネルと data-scroll-area 付きの子孫だけを調べるようにした。「段階 2 が使う公開入口」に、02・04 が内部スクロール領域に付ける目印を記載した。
- ChatView / TraceView と 02・04 の実装は変更していない。active の対応は各担当が行う。今回の追加は MockExtension の任意メタデータだけで、既存の仮の部品の引数・戻り値は変更していない。

#### 検証と引き継ぎ

- `pnpm typecheck`：成功。`pnpm test`：93 件すべて成功（前回 83 件を維持・更新し、新規 10 件）。`pnpm build`：成功。既存の Vite chunk サイズ警告は残る（JavaScript 約 887 KB、同梱フォント約 4 MB）。
- オーケストレーターがブラウザで、09 の補助画面との往復時の選択保持、02・04 の active 対応と目印付きの内部スクロール保持、取得失敗画面の「読み直す」を確かめる。段階 3 では起動時の選択復元、補助画面表示中の実物の projection 追従、ページ再読み込みによる取得再開を確認する。
- 担当外で必要になった変更：なし。main、依存・ロックファイル、DSH 本体、保護フック・権限設定は変更していない。DSH・開発サーバーの起動、HTTP 確認、ブラウザー操作は行っていない。今回の操作拒否はない。

### 2026-09-25：段階 2 のレビュー・統合予行演習の指摘 2 件を修正

- 承認を保留すると、従来の判定では応答シートを閉じた時点で Composer が再表示されることを Node テストで再現した。判定を純粋関数 shouldHideComposer に分け、未回答の承認は deferred にかかわらず入力欄を隠すようにした。自動で開くシートを選ぶ条件は維持し、保留した承認のシートを勝手に開き直さない。質問・プランの「あとで」はシートを閉じれば従来どおり入力できる。
- MockKit に既存ワークスペースをその位置で更新する updateWorkspace を追加した。patch と現在値を受け取る関数の両方に対応し、ID・並び・対象外の行・一覧のメタデータを保つ。複数機能が同じワークスペースへ順番に追記しても先の会話 ID を失わない。未登録 ID と更新関数の例外では状態も通知回数も変えず、渡した値や返した配列の後からの変更は保存値へ漏れない。
- 「段階 2 が使う公開入口」に、承認と質問・プランの入力可否、および updateWorkspace の型・追記例・更新時の扱いを記載した。既存の MockKit 関数と仮の部品の引数・戻り値は変更していない。01 が削除・再追加から更新関数へ切り替える作業は 01 側で行う。
- 回帰テストは計 10 件追加した。承認の保留・回答・取消、質問とプランの保留、他の会話・シートとの分離、ワークスペースの順序・通知・ID の固定・複数機能の追記・値の分離・例外時の無変更を検証した。変更前は承認の判定テスト 3 件が失敗し、最初のワークスペース更新テスト 3 件も関数未実装で失敗することを確認してから修正した。
- `pnpm typecheck`：成功。`pnpm test`：103 件すべて成功。`pnpm build`：成功。既存の Vite chunk サイズ警告は残る（JavaScript 約 887 KB、同梱フォント約 4 MB）。オーケストレーターがブラウザで、05 の「トレースで見る」からチャットへ戻ったときの入力欄と、01 の更新関数利用後のワークスペースの並びを確かめる。
- 担当外への引き継ぎ：01 の mock が行っているワークスペースの削除・再追加を updateWorkspace に切り替える。01 のファイルは変更していない。今回変更したのは担当ファイルと本書の実装メモだけで、main には触れていない。DSH・開発サーバーの起動、HTTP 確認、ブラウザー操作は行っていない。今回の操作拒否はない。

### 2026-09-26：main 取り込み後の土台の残りを修正

#### 会話選択の開始時期と購読の分離（1・2）

- `feat/00-foundation-2` のクリーンな状態から開始した。承認などから scope だけが先に存在し、一覧が pending で空の場合にも open が走ることと、open の例外が外へ漏れることを、新規 Node テスト 2 件の失敗で確認してから修正した。
- 選択・解除とも一覧の ready を待つ。会話 URL 内でも list.phase を effect の依存にし、基準データが届いたら有効な会話を一度だけ open する。現在選択中の ID は開き直さず、face の参照変更や同じ会話の補助画面への移動でも再選択しない。ready 後の open が同期例外を投げても、会話 ID と例外を console.error に記録するだけにし、ErrorBoundary へ流さない。
- Frame が直接選択フックを呼ぶ形をやめ、null を返す ConversationSelection 部品を置いた。この部品だけが選択管理用の一覧・face を購読する。URL の所有者は引き続き Frame で、一覧更新による選択部品の描き直しは、画面の render 呼び出しとシートの置き場には波及しない。React の再描画回数そのものは Node の検証対象にせず、オーケストレーターがブラウザで確かめる。

#### 一覧・履歴の失敗を実物から知れる範囲（3）

参照元は、`npm root -g` の下にある `@deepseek-ai/dsh/node_modules/@deepseek-ai/`。以下の controller は `dsh-api-session-controller/lib/types/client/`、Gateway は `dsh-api-gateway/lib/types/client/` を指す。読み取りのみで、実物を起動・変更していない。

- **初期読み込み・背景 follow**：controller の `sessions/session.js:530–563` は初回取得の RemoteFailure を `openState: 'error' / openError` に保存する。同 `534–542,702–713` は follow の failed 通知を同じ状態へ反映する。既存の SessionSnapshot と useSession がそのまま公開済みなので、型と戻り値は追加しない。未知の例外まで必ずこの状態になるという契約ではない。
- **手動の古い履歴取得**：controller の `sessions/session.js:313–333`（loadOlder）、`335–384`（loadThrough）は追加取得の例外を吸収し、loadingOlder を解除して Promise<void> を解決する。Gateway の `journal-stream.js:80–106`（prepend）は取得例外を投げるだけで failed を呼ばないため、この失敗は openError にも出ない。**手動ページ取得の失敗は実物の API では知る手段がない。** 履歴が増えないことは、枯渇・中断・進捗なしでも起きるので失敗に変換しない。
- **背景 follow との違い**：Gateway の `journal-stream.js:127–151` は背景 consume の失敗だけを failed に通知する。同 `186–209,244–257` の欠落補修ページ取得はその背景処理に属し、失敗は controller の openError に伝わる。手動の追加読み込みと同じ扱いにしない。
- **一覧取得・更新（00-foundation-3 で補足）**：controller の `sessions/manager.js:354–431` は通常の RemoteFailure を内部の listState/error に保存し、refreshList の Promise<void> は解決する。しかし `sessions/service.js:200–202,434–505` は refresh を委譲し、公開 sessions.list へ state/error を投影しない。公開型の `sessions/service.d.ts:61–79` にもその項目はない。**初回に限り、`await sessions.refresh()` の完了後も phase が pending なら失敗と判断してよい。ready 後の通常の取得失敗は知る手段がない。** refresh は進行中の取得を返し（manager.js:355–356）、成功時だけ ready に変える（同387）。pending 単独を失敗と扱わず、完了を待って判定する。具体的な失敗理由までは分からない。`sessions.manager` は実行時には通常のプロパティとして読める（service.js:85）が、公開の型では private（service.d.ts:125）なので使わない。未知の例外は reject し得るため catch も必要だが、それだけではすべての取得失敗を検出できない。
- **一覧の購読失敗と Agent の失敗**：controller の `index.js:36–40` の control/watch 終端失敗は console.error のみで、公開の失敗状態・イベントには変換されない。`index.js:33–34`、`sessions/manager.js:670–675`、`sessions/session.js:505–510` の api-session/error は実行中 Agent の失敗を lastAgentError へ反映するもので、一覧・履歴取得の失敗通知として使わない。
- mock の初期取得・follow エラー表示は、既存の setSessionState で openState/openError を設定し、会話の再選択後も保持できる。refresh/loadOlder/loadThrough は従来の成功経路を維持し、実物にない失敗欄・失敗戻り値を追加しない。01・02・04 にはこの区別を「段階 2 が使う公開入口」から引き継ぐ。各担当の実装メモはこの checkout では未記入のため、他ブランチの待ち記録は書き換えていない。ready 後の一覧更新と手動ページ取得の確実なエラー表示には DSH 側の公開 API 追加が必要。

#### テーマの色生成の統一（4）

- html に設定する旧 Scheme の applyTheme と、内側の M3eTheme の DynamicScheme が異なる値を生成していた。M3e 2.8.2 の `dist/theme.js` を読み、html 側を内側と同じ方式へそろえた。色種・variant・contrast は共通の定数から渡し、themeFromSourceColor の 6 パレットを DynamicScheme（TONAL_SPOT、contrast 0、specVersion 2021、platform phone）へ指定する。既存の外観設定と強調フォーカス・モーションの指定は保った。
- 単純な SchemeTonalSpot の既定パレットへの置換ではなく、M3e の生成方法と同じパレットを使う。通常の全色に加え surfaceVariant / shadow / scrim / surfaceTint を含む 53 色を html へ設定する。明暗の切り替えでは全色と color-scheme を更新し、ほかの html のスタイルを変更しない。
- Node テストは同梱 M3e の純粋な色生成部分を読み取って隔離実行し、html 用関数の全 53 色とライト・ダークそれぞれで比較する。旧方式では 3 件失敗し、統一後はすべて一致した。React や DOM の描画は行っていない。
- **10 への引き継ぎ**：surface / background の新しい値はライト `#fdf8fd`（旧 `#fffbff`）、ダーク `#141316`（旧 `#1c1b1e`）。manifest の background_color / theme_color は新ライト値へ、index.html の明暗 theme-color はそれぞれの新値へ、10 側で変更する。対応する tests/10-pwa.test.ts の期待値も 10 側で更新する。今回 10 のファイルには触れず、起動前のメタデータの色との差はこの引き継ぎまで残る。

#### 検証と担当外への引き継ぎ

- `pnpm typecheck`：成功。`pnpm test`：245 件すべて成功。`pnpm build`：成功。既存の Vite chunk サイズ警告は残る（今回の本番 JavaScript 約 1,283 KB、同梱フォント約 4 MB）。
- 新規回帰は会話選択 2 件、06・07・09 の統合 1 件、テーマ 3 件。統合テストでは 3 機能の本物の mock 拡張を同時登録し、基準データ前の承認要求、ready 後の選択、完了の未読件数、検索、子の会話の mode と選択、ゴールの projection 更新を検証した。06・07・09 各機能の既存テストと 10 の PWA・キャッシュ・登録処理の既存テストも変更せず成功した。
- 担当外で必要な変更は、上記の 10 の色メタデータ・テスト期待値の更新。ready 後の一覧更新と手動履歴取得の失敗通知を実現するには DSH の公開 API の変更が必要で、土台側では追加していない。01・02・04 には既存 openError で分かる失敗と、公開されない失敗の範囲を引き継ぐ。仮の部品の引数・戻り値、共有の services 型、MockKit の既存契約は変更していない。
- オーケストレーターがブラウザで、基準データが遅れる起動時の会話選択、一覧更新時に Frame・シートの置き場が描き直されないこと、明暗の画面とスナックバーの色の一致を確かめる。DSH・開発サーバーの起動、HTTP 確認、ブラウザー操作はしていない。main への変更、merge、rebase、担当外ファイルの変更、操作拒否はない。

### 2026-09-26：00-foundation-2 のレビューの軽微指摘 2〜4 を修正

- `feat/00-foundation-3` のクリーンな状態から開始し、指定された Claude Opus のレビュー全文を読んだ。10 の色の修正は main へ取り込み済みのため、今回の対象に含めていない。
- **指摘 2**：一覧の phase だけで open を止める条件をやめ、公開 `list.byId[id]` または `sessions.subagentAddress(id)` があることを条件にした。削除済みでない face と現在選択中 ID の確認も維持する。共通の canSelectConversation で判定し、その真偽値を effect の依存へ追加したため、同じ URL・face・pending のまま一覧へ会話が追加されても選択を開始できる。一覧・アドレスにない ID は ready 後でも開かず、open の例外のログ記録と会話外での ready 後の clear は保つ。仮の部品の形は変更していない。
- 実物の根拠は `dsh-api-session-controller/lib/types/client/sessions/manager.js:85–99,136–145`。select は phase を見ず、summaries または navigationAddress を照合する。create と追加通知は同 `459–469,520–529,599–600` で summaries を更新し、phase を変更しない。`service.js:270–275` は create の一覧への投影後に返る。インストール済み DSH は読み取りだけで、起動・変更していない。
- 回帰テストを 5 件追加した。pending 中に作った会話、phase・face が同じままでの一覧追加、一覧にない子へのアドレス追加、pending / ready のそれぞれで scope しかない ID を開かないことを確かめた。修正前は 4 件失敗し、修正後は会話選択の既存分を含む 17 件すべて成功した。子の会話を先に選んでから移動する場合の二重 open 防止や、09 の補助画面での選択保持も維持した。
- **指摘 3**：「段階 2 が使う公開入口」と前回調査の一覧取得の説明を補足した。初回に限り、sessions.refresh() の完了後も phase が pending なら失敗と判断してよい。根拠は manager.js:355–356 の進行中の取得の再利用と同387の成功時だけの ready 更新。pending 単独での失敗判定や具体的原因の推測はしない。ready 後の通常の取得失敗は依然として判別できない。sessions.manager は実行時には読める（service.js:85）が、公開の型では private（service.d.ts:125）なので使わないことも明記した。
- **指摘 4・段階 3 でのテスト保守**：`tests/00-integrated-features.test.ts` と `tests/00-theme-colors.test.ts` は、他の機能の内部や M3E の配布コードに依存しているので、段階 3 で更新してよい。機能内の関数名や M3E の版を変えた場合は、同じ振る舞い・色の一致を検証できるようこの 2 ファイルも合わせて更新する。今回、この 2 ファイルの実装は変更していない。
- `pnpm typecheck`：成功。`pnpm test`：main に入っている全機能を含む 455 件すべて成功。`pnpm build`：成功。既存の Vite chunk サイズ警告は残る（本番 JavaScript 約 1,494 KB、同梱フォント約 4 MB）。
- 担当外で必要になった変更：なし。担当ファイルと本書の実装メモだけを変更した。main への変更、merge、rebase、DSH・開発サーバーの起動、HTTP 確認、ブラウザー操作、操作拒否はない。実物で初回一覧取得に失敗したあと会話を作って開く動作は、段階 3 で確かめる。

### 2026-09-26：統合後の画面仕様・横断レビューの土台 12 件を修正

#### 再開と作業範囲

- `feat/00-foundation-4` の作業を利用上限で中断したあと、未コミットの status と diff を確認して再開した。指定の spec-list / spec-conv / spec-tools、cross、user-decisions を照合し、ユーザーの決定を優先した。再開時のモデル・推論強度は gpt-6-astra / high。コミットの所要時間は、上限解除後の今回の再開から完了までを記録し、利用上限による待機時間を含めない。
- 既存の部品・関数の引数と戻り値を維持し、任意の options と共通関数だけを追加した。変更は 00 の担当とこの実装メモに限る。main、merge、rebase、DSH・開発サーバー起動、HTTP 確認、ブラウザー操作は行っていない。
- 中断前、子の選択・保留に関する複数のテストパスの検索と、projection・scenario・workspace エラーに関する複数のテストパスの検索が、`Opaque shell wrappers are blocked unless Codex can split them into allowed commands.` で拒否された。どちらもテストパスにワイルドカードを使った rg 操作で、その操作は中止した。拒否された検索の別経路での再試行はせず、取得済みの契約と独立した新規テストで作業を続けた。保護フック・権限設定は変更していない。

#### 会話の選択・編集可否・保留（1・5・9）

- 子の会話は URL 直開きでも、親のカタログを取得・検証する `openConversationSession` を経由して openSubagent する。カタログの同時取得を共有し、待機中に別の画面へ移った場合は選択を行わない。既に同じ子アドレスを選択している場合は重ねて選択しない。カタログの異常、親の変更、取得失敗は握りつぶさず、呼び出し元で扱える例外にする。Frame はログと日本語スナックバーに表示する。
- 実物の読み取り根拠：インストール済み `dsh-api-session-controller/lib/types/client/sessions/service.js:322–323,397–429` は scope から resolve を通り、一覧または保持済み子アドレスの対象なら scope と face を生成する。選択前に削除済みでない face を要求する既存条件は維持できる。DSH は起動せず、この契約だけを読み取った。
- `sessionAccess` は origin と検証済みアドレスを使い、continuable の子だけ入力可能とする。one-shot と mode 未確認は読むだけにし、通常の fork は parentId だけで子にしない。ConversationScreen はこの入口を利用する。開けない画面の文言は「もう一度開く」（ページ再読み込み）と「戻る」（back）にそろえた。
- deferred の解除を ConversationScreen のマウントから Frame の会話訪問 tracker へ移した。質問・プランの「あとで」は同じ会話の補助画面、チャット／トレース、一覧だけを経由した往復で維持し、別の会話を訪れて元の会話へ戻った場合だけ解除する。承認を未回答のまま入力欄を隠す既存条件は維持した。

#### シートと表示の共通基盤（2・3・4・6・7・8・12）

- シートに任意の owner を追加し、省略時も現在 URL から持ち主を決める。会話の補助画面間では同じ持ち主を保ち、会話外や別会話へ移ると閉じる。ルート所有ではクエリーも区別する。要求先を表す既存 sessionId と持ち主を混同せず、対応待ち画面から開く応答シートを維持する。
- 下のシートの部品とキーを保ち、割り込み中もフォーム・処理中・結果の状態を失わない構造にした。表示するネイティブ面は一度に 1 枚とし、閉鎖完了を待って次を開く。同梱 M3E の `bottom-sheet.js:339–351` は closed をロック解除より前に通知するため、単に closed を待たず、popover の toggle で閉鎖したことを確かめる。通常シートの handle は HTML 属性も設定し、M3E のヘッダー非表示条件を解除する。応答必須シートのキャンセル禁止は維持した。
- 画面の入場アニメーションは transform / opacity のみとし、下タブはフェード、詳細へ進むと右から、戻ると左から入る。動きを減らす設定では動かさない。チャットとトレースの部品保持・スクロール保持は従来どおりで、画面にアニメーション用の key を付けない。
- 切断バナーを tertiary 系の色へ変更し、TextPromptDialog に confirmLabel を追加した。既定は OK のまま。余白・角丸の派生トークンを公開し、参照されていない placeholder-list と composer-placeholder の CSS を削除した。現用の placeholder は残した。

#### mock の共有状態とエラー正規化（10・11）

- `normalizeWorkspaceError / workspaceOperation` を 01 の契約と同じ形で土台へ追加した。文字列化された workspace エラーのコード・メッセージを復元し、構造化済みや未知の例外は保持する。01・09 の呼び出し元はこのブランチでは変更しない。
- MockKit の設定 reader は 08 の最新の値を参照し、別の設定 Map を土台に作らない。03 は新規会話の初期化時に読む。projection の get / update は共有の最新値を使い、モデル変更で他機能の lastUsed を失わずに更新できる。受け渡す値を複製し、更新関数の例外は保存済みの状態へ漏らさない。
- `isScenario` は拡張登録中にも使えるため、01・06・09 はデモ要求・完了印をシナリオに応じて登録できる。API を使う側の変更は各担当のブランチで行う。現時点の各機能の独自 Map・無条件デモ登録まで土台から書き換えていない。
- ユーザーの決定 8 は確認した。今回は所要時間の共通表示関数を追加していないため、各機能の時間表示は変更していない。フォントの字形削減・画面ごとの遅延読み込みも今回の対象外。

#### 検証と引き継ぎ

- Node で、子の初回カタログ取得・継続可否・同時選択・離脱・失敗、保留の訪問条件、シート所有範囲とネイティブ面の切り替え順、画面遷移の方向と reduced-motion、設定・projection の共有と分離、シナリオ照合、workspace エラー正規化を検証した。シートの React 状態が実画面で保たれることや実際のスワイプ・フォーカスは Node だけで実証したとは扱わない。
- 「段階 2 が使う公開入口」にすべての追加 API と既存呼び出しへの互換性を記載した。担当外への引き継ぎは、01・05・06・09 の共通選択、03・09 の共通編集可否、01・09 の workspace エラー、01 の確定文言、03・08 の設定 reader、03 の共有 projection、01・06・09 のシナリオ出し分けの採用。各機能の実装ファイルは変更していない。とくに 03 内部の子の入力制限は、continuable を許す共通判定へ担当側で切り替える必要がある。
- オーケストレーターがブラウザで、子の URL 直開き、同会話補助画面での保留維持、シート割り込み中の入力・分岐結果保持、離脱時の後片付け、下払いと応答必須シート、フォーカス・スクロール復帰、遷移方向と reduced-motion、バナーの色を確かめる。
- 最終検証：`pnpm typecheck` 成功、`pnpm test` は main にある全機能を含め **568 件すべて成功**（失敗・スキップなし）、`pnpm build` 成功。`git diff --check` も成功。既存の Vite chunk サイズ警告は残る（本番 JavaScript 1,584.76 kB、gzip 399.30 kB、フォント 4,001.61 kB）。今回の容量最適化は対象外のため変更しない。

### 2026-09-26：シートを重ねると最上位の操作が押せない問題を修正

- `feat/00-overlay-pointer` のクリーンな状態から開始した。統合 worktree の Playwright の 02c・03b・03d の試験、失敗時の写真、エラー記録、トレースを読み取り専用で調べた。3 件とも、画面で見えている最上位の `m3e-bottom-sheet` は `open` で `:popover-open` にも入っているが、ホスト自身に `inert` 属性が付いていた。Playwright は対象ボタンを可視・有効と判定したあと、外側の `.app-viewport` にポインターを遮られて時間切れになった。写真だけから下のシートが前面にあるとは判断しなかった。
- 同梱 M3E 2.8.2 の `core.js:962–991` の InertController は modal 面の兄弟を inert にし、閉じる際に解除する。`bottom-sheet.js:314–351` は閉鎖時の inert 化、ロック解除、popover の終了を別の時点で行う。これらと保持された複数の面の切り替え中に、最上位へ inert が残ったことが直接の原因。どの非同期代入が最後に付けたかまではトレースだけでは特定しない。
- 土台では、まだ表示していない面を最初から `hidden` と `inert` にし、表示中の面には inert 属性の変更だけを監視する。最上位に後から inert が付いたらすぐ解除し、隠す前またはアンマウント時に監視を止める。StrictMode の effect 再登録でも、表示中の面だけ監視を戻す。既存のネイティブ close 完了待ちと React 部品の保持を維持し、隠れた面の入力状態や処理結果を失わない。応答必須の `dismissible: false` と、利用者の cancel を拒否する扱いも維持する。公開の関数・仮の部品の引数と戻り値は変更していない。
- Node の回帰では、上面に後から inert が付いた場合の復旧、監視を止めた下の面の inert 維持、応答必須シートの設定と割り込み後の保持を追加した。既存のネイティブ閉鎖順と状態保持の試験も通した。開発サーバーも HTTP も使わず、ローカルのコードをメモリ内で束ねた Chromium の小さな画面でも、上面に inert を付け直したあと解除され、見えている「閉じる」をクリックできた。ただし、統合側の 02c・03b・03d 自体はこの worktree から再実行していない。オーケストレーターが統合画面で 3 件を再確認する。
- 変更したのは `web/src/app/overlay/`、`tests/00-overlay.test.ts`、本実装メモだけ。機能 02・03 のファイルや統合側の試験・写真は変更していない。DSH・開発サーバーは起動していない。main、merge、rebase に触れていない。担当外で必要な変更はなし。
- 最終検証：`pnpm typecheck` 成功、`pnpm test` は全機能を含む 647 件が成功（失敗・スキップなし）、`pnpm build` 成功。既存の 500 kB 超チャンク警告は残る。今回の 00 の差分で他の警告や失敗は生じていない。

### 2026-09-27：Issue #5 シート切り替え中の初回 close 競合を修正

- 新しいシートを前のネイティブ閉鎖完了までマウントしないようにした。すでに描画済みの下層シートは同じ key で残し、入力状態を保持する。M3E の private フィールドや同梱コードは変更していない。
- `?mock` のモデル一覧に、Playwright が読み込み前に設定した場合だけ 120 ミリ秒の遅延を加えられる試験用入口を置いた。通常の `?mock` は変えない。修正前は新規 e2e でモデルシートが `open=true` のまま非表示となり失敗し、修正後は選択と入力補助の再表示まで成功した。
- `pnpm typecheck`、`pnpm build` は成功。`pnpm test` は 702 件、Playwright は 65 件が成功した。DSH は起動していない。実物の DSH と iPhone 実機での確認は段階 3 に残る。

### Issue #25: 横向きの本文 safe area

- 共通 `.screen-content` が左右の safe area を確保する。独自の本文余白を持つ会話・ホーム・フォルダー選択では共通余白を外し、各本文の既存余白と `env(safe-area-inset-left/right)` の大きい方を使う。トレース検索フッターや入力欄へ二重適用しない。
- ドロワーは独立して左右を保護し、チャットの「最新へ」も右 inset を考慮する。inset がゼロなら既存の余白を保つ。
- `e2e/landscape-insets.spec.ts` で Chromium CDP の safe area override を利用し、実際の `env()` と描画座標を測定する。縦向き、狭い横向きのゼロ inset、左右44/20pxと20/44px、長い改行なしテキスト、一覧・ツール・フォルダー・検索・最新へ操作を確認する。
- 変更前は横向き8件が失敗し縦向き4件が通過。修正後の最終検証では、狭い横向きのゼロ inset を加えた新規16件と既存の操作5件が通過し、全単体テスト1107件もスキップ0件で通過した。CDPによる合成検証であり、実際のiOS Safariとノッチ端末の回転操作は未検証。
