# 09 会話の ⋮ メニューと補助の画面

## 目的

会話の右上の ⋮ から開く機能をまとめて担当します。会話そのものの操作（題名、アーカイブ）と、会話の周りの情報（統計、ファイル、ジョブ、サブエージェント、ゴール）です。

## 担当する画面

| Canvas の画面 id | 名前 |
|---|---|
| `convMenu` | 会話の ⋮ メニュー |
| `renameDialog` | 題名を変える（会話から開くとき） |
| `stats` | 統計 |
| `files` | ファイル |
| `fileView` | ファイルの中身 |
| `jobs` | ジョブ |
| `subagents` | サブエージェント |
| `goal` | ゴール |

仕様は `docs/ui-spec.md` の「会話の ⋮ メニュー」の節です。

## 担当するファイル

- `web/src/features/session-tools/` の全部（`SessionMenu.tsx` と `routes.tsx` は 00 の仮の部品を置き換える）
- `tests/09-*.test.ts`
- この設計書の「実装メモ」

## 入口

- `SessionMenuButton({ sessionId })`：00 の会話画面の上のバーの右端に置く ⋮ ボタン。押すとメニューを開きます。
- `routes`：`#/s/<id>/files`、`#/s/<id>/file`、`#/s/<id>/jobs`、`#/s/<id>/subagents`、`#/s/<id>/goal`。どれも 00 の PageScaffold（← の付いた画面）を使います。

## 画面の中身

### ⋮ メニュー

M3 のメニュー（ボタンの下に出る一覧）で、次の 7 項目を出します。

| 項目 | 動き |
|---|---|
| 題名を変える | 00 の `TextPromptDialog` に今の題名を入れて開き、`face.rename(title)` |
| 統計 | 統計のシート |
| ファイル | `#/s/<id>/files` |
| ジョブ | `#/s/<id>/jobs`。動いているジョブがあれば、項目の右に件数を出す |
| サブエージェント | `#/s/<id>/subagents`。子がいなければ項目を出さない |
| ゴール | `#/s/<id>/goal`。ゴールがなければ項目を出さない |
| アーカイブ | `workspace.archiveSession(id)` のあと、一覧へ `replace` で戻り、スナックバーで「アーカイブしました」 |

### 統計

- シートで出します。値はすべて projection から読み、DSH に問い合わせません。
- コンテキストの使用率：`contextPressure` の `pressureTokens`（なければ `projectedTokens`）を `contextWindow` で割った割合。進捗バーと「62%」のような数字で出します。値がなければこの行を出しません。
- トークン：`tokenUsage` の入力（`uncachedInputTokens`）、出力、キャッシュ（読み・書き）。1 万以上は「1.2 万」の形にします。
- ターン：`records` の `turn/start` の最大の番号。
- モデル：`modelSelection` のモデル名と考える深さ。
- クォータは出しません（2026-09-25 の決定。第 1 弾では出さない方針）。

### ファイル

- 作業フォルダの中を読み取り専用でたどります（`ctx.remote.workspaceFiles.list(sessionId, path, signal)`）。書き込みの操作は作りません。
- 上にパンくずのチップ、その下にフォルダとファイルの行。フォルダが先、それぞれ名前の順です。ファイルの 2 行目は大きさ（`size`）。
- フォルダをタップすると、同じ画面の中で 1 階層下に入ります（`path` の引数を `replace` で変える）。ファイルをタップすると `#/s/<id>/file?path=<パス>` へ移ります。
- `changes(sessionId, signal)` を購読し、今見ているフォルダが変わったら読み直します。

### ファイルの中身

- 上のバーはファイル名。
- テキストは `read(sessionId, path, { offset, limit: 5000 }, signal)` で読み、等幅で出します。`eof` でなければ、最後に「続きを読み込む」を出します。
- 拡張子が `.md` のファイルは、上に「表示 / 元の文字」の切り替えを置き、「表示」では 00 の `Markdown` 部品で描きます。
- 画像（png、jpg、jpeg、gif、webp、svg）は `readBytes` で読んで表示します。
- それ以外のバイナリは、名前と大きさだけを出し、「このファイルは表示できません」と添えます。
- ファイルが変わったら（`changes`）、上に「ファイルが更新されました」と「読み直す」を出します。

### ジョブ

- `sessions.list` の `jobsBySession[sessionId]` を並べます。実行中が上、そのあとは新しい順です。
- 1 行目は `label`、2 行目は「種類 ・ 状態 ・ 経過時間」。種類は bash なら「bash」、subagent なら「サブエージェント」。状態は実行中、停止中、完了、停止済み、失敗です。
- 実行中の行の右に停止ボタンを置きます。止める窓口は「未確認のこと」を見てください。
- 完了はイベントで届くので、画面を開いている間は自動で更新されます。

### サブエージェント

- 開いたら `sessions.setSubagentCatalogOpen(sessionId, true)` と `refreshSubagents(sessionId)` を呼び、閉じたら `false` にします。
- `subagentsByParent[sessionId]` の `child` を並べます。1 行目は `label`、2 行目は「実行中 / 終了 ・ 続けて頼める / 1 回限り」。`diagnostic` の行は「読み込めない記録があります」と 1 行だけ出します。
- タップで `sessions.openSubagent(address)` を呼び、子の会話を `#/s/<子の id>` で開きます。
- **子の会話は読むだけにします**（2026-09-25 の決定）。続けて頼む機能（`SubagentPromptRequest`）は後回しです。子の会話で入力欄を出さないのは 03 の担当です。

### ゴール

- projection の `goal` を読みます。ゴールがなければ「ゴールはありません」とだけ出します。
- カードに、目標の文（`objective`）、状態（進行中、一時停止、行き詰まり、完了）、ラウンド数（`roundsStarted` / `maxGoalRounds`）を出します。行き詰まり（`blocked`）なら理由（`blockedReason`）も出します。
- ボタン：「一時停止」（一時停止中は「再開」）、「完了にする」、「ゴールを消す」（確認を挟む）。操作には `GoalRef`（`id` と `revision`）を渡し、古い `revision` で拒否されたら読み直します。
- ゴールの作成と編集は後回しです。

## 使う DSH の窓口

- 00 の `useSession(sessionId)`：`face.rename`、`records`、`projection('tokenUsage')`、`projection('contextPressure')`、`projection('modelSelection')`、`projection('goal')`
- `sessions.list`（`jobsBySession`、`subagentsByParent`）、`sessions.setSubagentCatalogOpen`、`refreshSubagents`、`openSubagent`
- `ctx.remote.workspace.archiveSession`
- `ctx.remote.workspaceFiles`：`list`、`read`、`readBytes`、`changes`（API の調査メモ §4）
- `ctx.remote.goal`（§9.8）
- 00 の `openSheet`、`openDialog`、`TextPromptDialog`、`Markdown`、`showSnackbar`、`navigate`、PageScaffold

参考の実装：今の画面の `dsh-client-ui-session`、`dsh-client-ui-sidebar-files`、`dsh-client-ui-sidebar-documentpreview`、`dsh-client-ui-jobs`、`dsh-client-ui-subagent`、`dsh-client-ui-goal`。

## 偽データ（mock.ts）

- 「承認シートの実装」：`kit.setProjection` で `tokenUsage` と `contextPressure`（使用率 62%）と進行中の `goal`、`kit.updateList` でジョブ 3 件（実行中の bash、完了のサブエージェント、失敗の bash）と子のサブエージェント 2 件（子のセッションも `kit.addSession` で足す）。
- `kit.addRemote('workspaceFiles', …)` と `kit.addRemote('goal', …)` の偽物。作業フォルダ：`docs/`（`canvas/`、`handoff.md`、`ui-spec.md`）、`README.md`、画像 1 つ、バイナリ 1 つ。`ui-spec.md` の中身は 6,000 行にして「続きを読み込む」を試せるようにします。
- `?mock&scenario=goal-blocked`：行き詰まりのゴール。

## テスト

`tests/09-session-tools.test.ts` で、次の純粋な処理を確かめます。

- コンテキストの使用率の計算（値の欠け、0 除算）と、トークン数の表示（「1.2 万」など）
- ファイルの一覧の並べ替え（フォルダが先）と、拡張子による表示の種類の判定
- ジョブの並べ替えと、状態の表示の文
- メニューに出す項目の判定（子やゴールの有無）

## 完了条件

- `?mock` で、⋮ メニューの 7 項目、題名の変更、統計、ファイルの行き来と各種の表示、ジョブ、サブエージェントから子の会話への移動、ゴールの操作、アーカイブが動きます。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。

## 未確認のこと

- ジョブを止める窓口（`kill` の形は README にしかなく、型ファイルにない）。見つからなければ停止ボタンは出さず、実装メモに書いてください。
- `ctx.remote.goal` のメソッド名（一時停止、完了、消去）。
- `workspaceFiles` の `path` が作業フォルダからの相対パスか絶対パスか。

## 実装メモ

（実装した担当が書き足します）
