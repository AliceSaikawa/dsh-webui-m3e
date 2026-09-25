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
- `app/overlay/index.ts`：`openSheet / openFullSheet / openDialog` は `ReactNode` または `(close) => ReactNode` と任意の options を受け、何度呼んでも安全な `close(): void` を返す。options は `dismissible / label / interactionKey / sessionId`。応答シートは後の 2 項目も指定する。
- OverlayHost はいちばん上の 1 枚だけを描く。シートから別のシートやダイアログを開くと、下のシートは閉じて開き直し、中の状態は保たれない。別のシートやダイアログを開く前に、下のシートを閉じる。
- `TextPromptDialog({ title, initialValue?, label?, onConfirm, onCancel })` の `onConfirm(value)` は `void` または `Promise<void>`。保存成功後に閉じる責任は呼び出し元が持つ。`Markdown({ children, className? })` の children は Markdown 文字列。
- `app/theme/index.ts`：`useAppearance()` は `system | light | dark`、`setAppearance(value)` と `backToClassic()`。`app/icons/Icon.tsx`：`Icon({ name, slot?, filled?, className? })`。
- `dsh/services.ts`：`DshProvider / useDsh` と共有型。`dsh/session.ts`：`useSession(id)` は `face / snapshot / records / stream / projection / ctx`。開けない ID の `face` は undefined。`projection<T>(key)` はフックなので、最上位で無条件に呼ぶ。別名の `useSessionProjection(face, key)` も用意した。
- `useSession(id)` は読むだけで、`sessions.open` を呼ばない。会話の選択は `ConversationScreen` が行う。会話画面以外で状態や履歴を読んでも、選択中の会話と完了の未読印を変えない。
- `stream` は `{ attemptId, turn, step, chunks, content, usage?, finishReason? } | null`。`content` は復元済みの ContentBlock 配列。`finishReason` は文字列でなく `{ kind: ... }`。
- `dsh/interactions.ts`：`initializeInteractions(ctx)` を描画前に一度呼ぶ。`usePendingInteractions / defer / resetDeferred / isPlanReview` を公開。pending の `deferred` は boolean、`answer()` は `Promise<void>`。`presentInteraction(pending, { from })` の戻り値は `close(): void`。会話に再入場したときだけ deferred を解除し、チャット／トレース切り替えでは解除しない。
- `dsh/mock/kit.ts`：MockKit の型入口。すべての指定関数を実装した。`emit` と `streamAssistant` は Promise を返す。`emit` の宛先は payload の `agent`（セッション ID）または `sessionId` で指定する。`addWorkspace` は WorkspaceView、`addSession` は SessionSummary と履歴を受け取る。`updateList` は新しい一覧を返す形と渡された一覧を変更する形の両方に対応する。`scenario` は名前に合う URL のときだけ実行する。
- MockKit に `setSessionState(sessionId, patch: Partial<SessionSnapshot>): void`、`removeSession(sessionId): void`、`removeWorkspace(workspaceId): void` を追加した。`lastAgentError`、`openState: 'error'` と `openError`、`promptError` は `setSessionState` で設定できる。共通データを消すシナリオには後の 2 関数を使う。既存の 9 関数の引数と戻り値は維持した。偽データに `ctx.remote.workspace` は置かない。

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
