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

### 2026-09-25：段階 2 の実装

#### 実装したものと判断

- 会話の ⋮ は M3E のアンカー付きメニューに置き換えた。子とゴールがある場合の 7 項目、題名変更、統計シート、各補助画面への移動、実行中ジョブの件数、アーカイブ後の一覧への replace と通知を実装した。
- 統計は projection と読み込み済み records だけを使う。pressureTokens の 0 も有効値とし、欠けた場合だけ projectedTokens に戻す。欠損・負数・非有限値・0 除算では使用率を表示しない。100% 超の数字はそのまま表示し、バーだけ 100% までにする。トークンの未取得と 0 を分ける。モデルは実物の modelSelection の next、なければ lastUsed を使い、考える深さは日本語にする。クォータは追加していない。
- アーカイブは本文の raw RPC ではなく、土台の公開入口 `useDsh().workspaces.archiveSession(id)` を使用した。土台と実物の controller の契約に合わせるため。共有ファイルは変えていない。
- 子の一覧はカタログの開閉と読み直しを行い、子の会話へは mode を含むアドレスを渡す。子の会話は読むだけという今回の決定を優先し、継続送信の機能は追加しない。子の題名変更・アーカイブも無効にした。入力欄の非表示は 03 の担当のまま。
- ファイルとジョブ・ゴールは PageScaffold の画面として登録した。ファイルは読み取り専用。ゴールの変更は表示中の GoalRef を送り、失敗したら get で読み直す。新しい revision で同じ変更を自動再送しない。

#### 未確認事項を既存プラグインで照合した結果

参照元は `/Users/user/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 以下。ソースと型を読むだけにし、DSH 本体を起動・変更していない。

- **ジョブ停止**：`dsh-client-ui-jobs/lib/client.js` は表示のみ。ホスト内部の jobs サービスには停止のメソッドがあるが、確認したブラウザ向け RPC 契約にはない。公開窓口を確認できないため、停止ボタンも架空の偽 RPC も作らなかった。実物の DSH での窓口追加・再調査は段階 3 の判断に残す。
- **ゴール**：名前空間は設計本文の単数形ではなく `remote.goals`。`get(sessionId)`、`pause(sessionId, ref)`、`resume(sessionId, ref)`、`complete(sessionId, ref)`、`clear(sessionId, ref)` を確認した。根拠は `dsh-client-ui-goal/lib/client.js` と `dsh-goal/lib/typert.remote-client.d.ts`。projection はゴールの直値ではなく `{ goal, roundsStarted, createdAt, updatedAt }`。RPC の GoalView は goal の各属性と集計値が同じ階層にあるので変換する。clear は更新された GoalRef を返す。
- **ゴールの状態**：phase は active / paused / blocked / complete。blocked は pause の対象外なので「再開」にし、ラウンド上限に達した場合は再開できない表示にした。完了後は消去のみ。blockedReason は文字列ではなく code と message を持つオブジェクト。
- **ファイルのパス**：入力は作業フォルダ相対・絶対の両方に対応。list の path は相対でルートは空文字、read / readBytes / stat と変更通知の absolutePath は絶対。URL は相対パスに統一する。テキストの offset は **1 始まりの行番号**、バイト読み込みは **0 始まり**。根拠は `dsh-api-workspace-files/lib/types/types.d.ts`、同 `typert.remote-client.d.ts` と `dsh-client-ui-sidebar-documentpreview` の型。stat はバイナリの大きさ表示に使う。
- **変更通知**：changes は ready / change を流す AsyncIterable で、AbortSignal で解除する。変更は DSH が観測したファイル操作に基づき、OS 全体のファイル監視を保証するものではない。DSH 外で編集した場合の通知は未確認のまま。
- **子のアドレス**：`dsh-subagent/lib/types/control-types.d.ts` の SubagentAddress は親 ID・子 ID に加えて mode が必須。ローカル helper で mode を保持し、共有型は変更しなかった。オーケストレーターが予定する土台の修正と互換になる形にした。

#### 操作上の記録と確認範囲

- 開発サーバー、HTTP 確認、DSH 起動は行っていない。ブラウザの `?mock` 操作確認は、今回の追加指示に従ってオーケストレーターへ引き継ぐ。ブラウザで操作済みとは扱わない。
- ファイル担当の M3E 型の位置検索で、誤ってパイプを含むコマンドを 1 回実行した。終了コード 1、出力なし。単純な 1 コマンドずつという指示からの逸脱として記録し、その検索は停止した。同じ検索の別経路での再実行はしていない。保護対象へのアクセスや自動承認の拒否は発生していない。
- 中間の型検査は並行作業中の FilesScreen / FileScreen がまだ存在しないため失敗した。最終の 3 コマンドの結果は下に追記する。

#### 最終検証と引き継ぎ

- `pnpm typecheck`：成功。
- `pnpm test`：86 件すべて成功。今回追加は 31 件（表示判定 6、ファイル処理 8、ジョブ・ゴール処理 7、偽 API 10）。使用率の欠損・ゼロ除算、各一覧の並べ替え、5000 行＋1000 行の復元、画像の分割読み込み、途中の版変更、変更通知と購読中断、各ゴール操作、古い GoalRef の拒否・再読込、子のアドレス、ジョブ一覧の更新通知、共有履歴の不変を確認した。React の描画テストは追加していない。
- `pnpm build`：成功。Vite の 500 KB 超の chunk 警告は残る（JavaScript 約 1,189 KB、gzip 約 297 KB）。分割設定は担当外なので変更していない。
- 偽データは「承認シートの実装」に統計 62%、進行中ゴール、ジョブ 3 件、子 2 件とそれぞれの履歴を追加。画像・バイナリと docs/ui-spec.md 6000 行、変更通知を持つ読み取り専用 workspaceFiles、実物の名前に合わせた goals を登録した。既存の 2 会話の履歴は変更しない。
- ブラウザで操作した画面：**なし（今回の指示で実施しない）**。オーケストレーターは `?mock#/s/approval-sheet` から、⋮ の 7 項目、題名変更、統計、ファイルのパンくず、docs/ui-spec.md の表示切替と追加読み込み、preview.png、sample.bin、ジョブ、子の会話への移動、ゴール操作と消去確認、アーカイブを確認する。行き詰まりは `?mock&scenario=goal-blocked#/s/approval-sheet/goal`。ジョブの停止ボタンは出さない仕様。
- 担当外で必要になった追加変更：**なし**。共有型への mode 追加と子の入力欄非表示は、依頼で示された土台・03 の担当のまま。main への変更、merge、rebase はしていない。
- 変更範囲の確認：開始時の HEAD は既存の `b69559c`。`25e3b2d` との差分にある docs/design/05-interactions.md の 1 行は開始前のコミットに含まれており、今回変更・ステージしていない。今回のコミットは 09 の担当ファイル 20 個だけ。

### 2026-09-25：2 本のレビューで指摘された 3 件の修正

#### 修正内容と実物の確認

1. **作業フォルダの最上位**：FilesScreen が RPC に渡す直前だけ空文字を `.` に変換する。URL・パンくず・list の返却 path は空文字のまま。前節で確認した「ルートは空文字」は返却値の契約であり、要求の契約と区別できていなかった。実物の `dsh-api-workspace-files/lib/index.js:553–554` は空文字を `gateway/bad-request` で拒否することを再確認した。mock の list / stat / read / readBytes も同じ拒否に合わせ、初回ルートとパンくずからの帰還を偽 API で検証した。
2. **ゴールの activation**：`phase=active` でも `activation=disarmed` の場合は「停止中」と「再開」を表示する。`dsh-goal/lib/types/types.d.ts` では activation はプロセス内の状態で、永続 projection には含まれない。`dsh-client-ui-goal/lib/client.js` の既存画面同様、goals.get と goal/activation-changed から取得し、同じ ID・revision のゴールにだけ適用する。画面の開始・ゴールの版変更・実行状態の変化・再接続時に読み直す。購読は画面の終了時に解除し、取得開始後に届いたイベントを遅い RPC 応答で上書きしない。取得不能時は「状態未確認」とし、進行中と決めつけない。
   - RPC の変換結果には activation を別の表示属性として保持する。mock の永続 projection には混ぜず、変更イベントも実物と同じ sessionId と GoalRef 付きで流す。
   - `?mock&scenario=goal-disarmed#/s/approval-sheet/goal` を追加した。active のまま停止したゴールから、一度の「再開」で armed に戻せる。既存の子会話の読み取り専用、消去確認、古い revision の拒否後の読み直しは維持する。
3. **追加読み込みの再試行**：読み込み要求を `{ offset, requestId }` にした。「続きを読み込む」の操作ごとに requestId が変わるため、5001 行目の読み込みに失敗した後も同じ行から再要求できる。成功するまで既存の 5000 行は維持し、再試行の成功後に残り 1000 行を一度だけつなぐ。要求状態と偽 API を使う Node の回帰テストで、要求行 `[1, 5001, 5001]` と全 6000 行の順序・欠落なし・重複なしを確かめた。

#### 検証と残る確認

- `pnpm typecheck`：成功。
- `pnpm test`：92 件すべて成功。空の要求パスの拒否、追加ページの失敗後の再試行、初回の active/disarmed、同じ revision の activation 変更、別会話・別 revision の分離、イベントと RPC の順序、購読解除と終了後の応答破棄を確認した。
- `pnpm build`：成功。既存の 500 KB 超の chunk 警告は残る（JavaScript 約 1,190 KB、gzip 約 298 KB）。
- 途中の追加読み込みテストは、共通エラー変換後の文言をそのまま期待したため 1 回失敗した。元の RPC エラーコードを確かめる形に直し、専用テストと全体テストが成功した。
- ブラウザで操作した画面：なし。今回も DSH・開発サーバー・HTTP 確認は起動・実行していない。オーケストレーターへはファイル最上位とパンくず帰還、新しい goal-disarmed シナリオ、追加読み込み失敗後の再試行の画面操作を引き継ぐ。
- 担当外で必要になった変更：なし。00 の土台、main、その他の機能には触れていない。拒否された操作・禁止操作の実行は今回なし。

### 2026-09-25：Opus 5.5 の追加レビュー対応

#### 修正内容と判断

- **ファイルのエラーコード（指摘 1）**：実物の `dsh-api-workspace-files/lib/types/types.d.ts:135–148` と `lib/types/index.js` のエラー生成を再確認した。正しい接頭辞は単数形の `workspace-file/`。画面にあった `workspace-file/not-text` と `workspace-file/too-large` は正しく、偽データの `workspace-files/not-found` が誤っていた。画面と偽データで同じ確認済みコードの定数を使うようにした。拡張子のない `unknown-format` と未知の拡張子の `undecodable.data`、`too-large.txt`、`too-large.png` を偽の一覧に追加した。大きすぎる偽ファイルはサイズの情報だけを持ち、大容量の配列を常駐させない。
- **ターンごとのゴール表示（指摘 2）**：再取得の開始時に activation を消す処理を外した。読み直し中も表示中の ID・revision に対応する直前の値を保ち、同じ ID・revision の新しい観測で置き換える。別 ID・古い revision の応答で、その値を消さない。表示中のゴール自体の ID・revision が変わった場合は、従来どおり不一致の値を表示に使わない。
- **ジョブの件数（指摘 3）**：メニューもジョブ画面と同じ `isLiveJob` を使い、running と stopping を数える。件数の読み上げも「実行中・停止中」に合わせる。
- **読み直しの文言（指摘 4）**：エラー欄から先頭に戻る操作は「最初から読み直す」とし、同じページから再試行できる「続きを読み込む」と区別する。
- **画像の上限（指摘 5）**：最初に stat でサイズを読み、10 MiB（10 × 1024 × 1024 バイト、画面表記は「10 MB」）を超える場合は readBytes を呼ばず理由を表示する。上限内またはサイズが不明の場合も 256 KiB ずつ読み、途中で返るサイズ・累積したバイト数・次の応答の長さで上限を守る。上限までに eof にならなければ止める。内容の版が変わった場合や中断時の扱いは維持する。
- **診断の行（指摘 6）**：読めない記録を件数に集約し、「読み込めない記録があります（N 件）」という 1 行だけを出す。子の会話の順序と移動操作は維持する。

#### 段階 3 に残す確認（指摘 7）

- 実物 DSH で子を持つ会話の ⋮ に「サブエージェント」が出るかを確認する。特に、まだ子カタログ画面を開いていないときに `subagentsByParent` が未取得で、`byId` にも子の summary がない場合、現在の有無判定で項目を出せない可能性がある。これはレビュー時点の推測であり、今回は実動作を確認していない。指示どおり記録だけとし、hasChildren の判定・カタログ取得方法・共有の土台は変更しない。

#### 検証と引き継ぎ

- `pnpm typecheck`：成功。途中で、画像のテスト用 API に stat を追加した際の不完全な型定義が検出された。既存の完全な偽 API を基にした定義へ直し、再実行で成功した。
- `pnpm test`：102 件すべて成功。追加した 10 件で、未知のバイナリと正しいエラーコード、画像の事前拒否・上限ちょうど・サイズ不明・途中増大・版変更・中断・大きすぎる応答、ゴールの再取得中の値保持、診断の集約を確認した。既存のジョブ件数テストも running / stopping / 終了状態を混ぜて確認した。
- `pnpm build`：成功。既存の 500 KB 超の chunk 警告は残る（JavaScript 約 1,191 KB、gzip 約 298 KB）。ビルド設定は変更していない。`git diff --check` も成功した。
- ブラウザで操作した画面：なし。DSH・開発サーバー・HTTP 確認は行っていない。オーケストレーターへは `?mock#/s/approval-sheet/files` の追加した 4 ファイル、追加読み込み失敗時の 2 つの操作文言、ゴールのターン前後の状態保持、停止中ジョブを含む件数、複数の診断がある場合の 1 行表示を引き継ぐ。今回は Node でロジックと偽 API を検証し、React の描画は未確認。
- 担当外で必要になった変更：なし。00 の土台・main・その他の機能には触れていない。今回、拒否された操作・禁止操作の実行はなし。

### 2026-09-26：段階 3 のセキュリティ指摘 1（SVG）

- `fix/security-1` で、SVG を画像の MIME 型一覧から外した。本文の画像一覧にある SVG は今回の指示でテキスト表示へ変更する。大小文字を問わず `fileKind` がテキストを返すため、既存の `FileScreen` は `readTextFilePage` で読み、React の `<pre><code>` 内に元の文字として表示する。SVG のバイト読み込み・同一オリジン Blob の作成・画像表示には進まない。`FileScreen.tsx` 自体の変更は不要だった。
- PNG・JPEG・GIF・WebP の分類と MIME 型、既存の画像読み込み処理は維持した。SVG をサニタイズして描画する機能や、画像へ変換する機能は追加していない。
- `tests/09-files.test.ts` に、大小文字・親フォルダの拡張子・二重拡張子を含む SVG のテキスト分類、スクリプトとイベント属性を含む SVG の文字列保持、従来の画像形式と MIME 型の維持を追加した。修正前は SVG の分類テストが失敗し、修正後はファイル関連 3 ファイルの 29 件すべて成功した。
- DSH の起動、実ブラウザや Safari での操作は行っていない。確認したのは Node での分類・読み込み処理と、既存の React の表示分岐である。実機の表示確認は残る。
- 指摘 2 の修正と合わせた最終検証：`pnpm typecheck` 成功、`pnpm test` 534 件すべて成功、`pnpm build` 成功。ビルドの 500 kB 超の chunk 警告は残る（JavaScript 1,578.50 kB、gzip 397.02 kB）。今回の拒否操作・担当外の変更はない。

### 2026-09-26：統合後の画面仕様照合・横断レビューへの対応

#### 実装したことと判断

- 指定された `spec-tools.out.md`、`cross.out.md`、`user-decisions.md`、09 の仕様と Canvas の note・部品構成を確認した。作業ブランチは `feat/09-session-tools-spec`、開始時の HEAD は `c3a9099`。レビュー対象の `dec19bd` からさらに統合された状態をそのまま使い、main の変更・merge・rebase は行っていない。
- **ゴール**：カードを目標文、その下に「状態 ・ N / 上限 ラウンド」の順にし、背景を secondaryContainer、文字色を onSecondaryContainer にした。操作は同幅の 2 列で、一時停止／再開は outlined、完了は filled。その下の左に「ゴールを消す」を置いた。状態による操作可否、上限、消去確認、activation の保持は維持した。
- **統計**：使用率の下を M3E の「トークン・ターン・モデル」の 3 行にした。アイコンは data_usage・replay・smart_toy。入力・出力・キャッシュ読み込み・書き込みの全内訳をトークン行の補足へ、考える深さをモデル行の補足へまとめた。狭い幅では補足を折り返し、情報を省略しない。使用率がない場合の非表示、0 と未取得の区別、DSH へ追加要求しない扱いは維持した。
- **アイコン**：会話メニューの統計を monitoring、ジョブを pending_actions、アーカイブを inventory_2 に変更。子のジョブを account_tree、失敗したジョブの右を error、子エージェントの左を smart_toy にした。ジョブの失敗は既存の状態文言と併記する。
- **余白・角丸**：09 の CSS の margin・padding・gap・border-radius は、既存の `--app-space`（16px）と `--app-radius`（28px）から指定・計算するようにした。20px 相当の角丸は radius × 5 / 7、16px 相当は radius × 4 / 7 とした。文字サイズ、タップ領域の最小高さ、罫線などは別の用途なので維持した。まだない土台の派生トークンは参照していない。
- **カタログ未取得の子**：`?mock&scenario=subagents-unloaded` を追加。標準の偽データは維持し、この場面では continuable と one-shot の子 2 件の origin・parentId・履歴を残したまま `snapshot.subagent=null`、親カタログなしで開始する。既存 MockKit の入口だけを使い、親の refreshSubagents 後にカタログを届ける。アドレスを最初から設定して問題を隠すことはない。
- **ユーザー決定の反映**：前日の「子はすべて読むだけ」という決定より、今回の「continuable だけ追加の入力を許可」が優先される。一律に読むだけとするサブエージェント画面の説明を外した。既存の mode 別の補足は維持し、入力機能自体は 03 の担当に残す。題名変更・アーカイブ・ゴール変更の可否を、追加の入力の許可から推定して緩和していない。

#### 担当外で必要になった変更

- **00 のアーカイブエラー正規化**：01 と 09 で文字列化された失敗の扱いが異なる。土台の関数が追加された後、09 の SessionMenu の catch でも同じ正規化を使う必要がある。今回の指示に従い、既存処理は変更せず、01 の処理の複製や未公開の入口の先行使用もしていない。
- **00 の子の選択共通化・03 の入力可否**：未取得の子を直接 URL・対応待ちなどから開いても、親カタログから mode 付きのアドレスを解決して選択し、由来を含めて操作可否を判断する必要がある。今回追加したシナリオで統合後に再確認する。09 のシナリオ追加だけで実物の選択問題を修正したとは扱わない。土台の新しい入口は使用していない。
- 共有ファイル・他機能の実装・仕様本文は変更していない。余白と角丸の今回の修正には、土台への追加変更は不要だった。

#### 検証と残る確認

- `pnpm typecheck`：成功。
- `pnpm test`：529 件すべて成功。追加した 1 件で、子 2 件の未取得状態・由来・履歴、別の親の取得で状態が変わらないこと、親カタログ取得後の mode 付き openSubagent を確認した。標準シナリオの事前設定は既存テストでも確認した。
- `pnpm build`：成功。既存の 500 kB 超の chunk 警告は残る（JavaScript 1,578.40 kB、gzip 397.11 kB）。`git diff --check` も成功した。
- ブラウザで操作した画面：なし。DSH・開発サーバー・HTTP 確認は実行していない。仕様との照合は TSX/CSS と Canvas の確認までで、390px 前後の描画・操作は統合担当へ引き継ぐ。
- 画面確認の対象：`?mock#/s/approval-sheet` のメニュー・統計、同会話の `/goal`・`/jobs`・`/subagents`・`/files` とファイル本文。未取得の子は `?mock&scenario=subagents-unloaded#/s/session-tools-review`（continuable）、`?mock&scenario=subagents-unloaded#/s/session-tools-tests`（one-shot）で確認する。土台・03 の修正後に、入口によらない選択と入力可否も確認する。
- 今回、拒否された操作・禁止操作の実行はなし。M3E 型の最初の参照先にファイルがなく読取エラーになったが、パッケージの公開 exports で実際の型の場所を確認して参照した。型検査・テスト・ビルドの失敗はなし。

### 2026-10-08：Issue #36・#37、ジョブの停止と一覧購読の失敗

- DSH 0.2.0-rc.2 の公開配布物 `dsh-api-job-controller/lib/types/client/service.d.ts` と `lib/typert.remote-client.d.ts`、`lib/types/types.d.ts` を確認した。`jobs.kill(sessionId, jobId)` は `job.kill({ sessionId, jobId })` を呼び、`requested / already-finished` を返す。0.1.5 時点の「停止 API がない」という制限は現行版には適用しない。
- 実行中の行に名前付きの停止ボタンを追加した。応答待ちは同じ行の連打を防ぎ、失敗は日本語で案内して再試行できる。受理後・終了済みの応答では案内を出して再要求を抑え、ジョブ状態そのものは購読の通知に任せる。行の終了・画面移動後の遅い応答は世代で除外する。
- SDK の `ClientJobsModel` は空配列でも購読失敗でも rows のキーを削除し、公開状態に失敗情報を持たない。このため単に hook の `[]` フォールバックを変えても区別できない。M3E の `job-rows.ts` で公開 `job.list({ sessionId }, signal)` の全件ストリームを購読し、読み込み中・成功・失敗を別の状態として保持する。画面とメニューで共有し、最後の解除でストリームを破棄する。失敗時は最後の行を保持し、再試行・再接続で再購読する。中断前の遅いフレームや失敗で新しい状態を上書きしない。
- 一覧は成功した空配列のときだけ「ジョブはありません」と表示する。失敗時は案内と「もう一度読み込む」を表示し、保持した古い行の停止操作を無効にする。メニューも未知の件数を 0 とせず、確認中／更新失敗を示す。
- 既存の DSH jobs controller は停止操作・観測に引き続き使用し、SDK 自体を変更していない。偽データには同じホストの行・失敗通知から動く `job.list` を追加し、既存の controller 試験は維持した。boot 契約検査には新たに使用する `jobs.kill` を追加した。利用者の今回の不具合修正・試験指示に基づき、旧段階 2 の担当一覧外の dsh helper/mock と e2e も必要範囲で変更した。
- 修正前のブラウザ試験 2 件は、購読失敗の案内がないことと停止ボタンがないことで失敗した。修正後は新規 8 件、既存のジョブ購読解放・表示順の 2 件がすべて成功した。停止の連打・失敗再試行・すでに終了・遅い応答、一覧の失敗・再接続・メニュー表示を確認した。
- `pnpm test` は 1111 件成功、skip 0（一覧 store の追加 4 件を含む）。`pnpm typecheck`、`pnpm build`、`pnpm check:pack`（19 ファイル）、`git diff --check` も成功。既存のビルド chunk サイズ警告は残る。
- `e2e-dsh/jobs-kill.spec.ts` は隔離した DSH 0.2.0-rc.2、偽モデル、合成の `sleep 30` バックグラウンドジョブだけを使い、画面から停止して購読で「停止済み」になることを確認した（1 件成功）。個人の DSH・認証情報・外部の有料 API は使っていない。ブラウザの偽データ試験は専用 localhost:5194、実 DSH は隔離した動的ポートを使用し、動画は記録していない。
