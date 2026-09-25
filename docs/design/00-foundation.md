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
- `workspaces`：`ctx.remote.workspace` の `list` と各操作
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
- 実物の DSH（`docs/handoff.md` の「検証用の DSH」）で開いても、今の最小画面と同じく接続し、一覧の件数が出ます。これができない環境なら、実装メモにそう書き、段階 3 で確かめます。
- `README.md` の「今の状態」と「コマンド」を、`?mock` の使い方を含めて更新します。

## 実装メモ

（実装した担当が書き足します）
