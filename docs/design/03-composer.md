# 03 入力欄と新しいセッション

## 目的

会話にメッセージを送る部分をまとめて担当します。AI の実行中に送るとき、順番待ちにするか割り込ませるかを選べることが、この機能の中心です。

## 担当する画面

| Canvas の画面 id | 名前 |
|---|---|
| `h0vanepn` | 入力画面（待機中）のうち、入力欄 |
| `running` | 会話（AI 実行中）のうち、入力欄と順番待ちのチップ |
| `plus` | ＋ のシート |
| `slashSuggest` | コマンドの候補 |
| `atSuggest` | ファイルの候補 |
| `queueEdit` | 順番待ちの編集 |
| `modelSheet` | モデルの選択 |
| `permissionSheet` | 権限の選び直し |
| `attachPreview` | 画像の添付 |
| `newSession` | 新しいセッション |

仕様は `docs/ui-spec.md` の「入力欄」「入力の補助」「返事が必要なシートと選び直し」のうちモデルと権限、「新しいセッション」の節です。

## 担当するファイル

- `web/src/features/composer/` の全部（`Composer.tsx` と `routes.tsx` は 00 の仮の部品を置き換える）
- `tests/03-*.test.ts`
- この設計書の「実装メモ」

## 入口

- `Composer({ target })`。`target` は `{ kind: 'session'; sessionId }` か `{ kind: 'new'; workspaceId }`。00 の会話画面と、この機能の新しいセッションの画面が使います。
- `routes`：`#/new?ws=<ワークスペース id>` の新しいセッションの画面。

## 画面の中身

### 入力欄

- 角丸 28px の枠 1 つに、上に入力欄、下にボタンの行をまとめます。1 行のときの高さは約 110px です。
- 入力欄は `@m3e/react` の `M3eTextareaAutosize`（最大 6 行、それ以上はスクロール）を使います。
- **Enter は改行です。送信は送信ボタンだけです。**
- 下の行：左に ＋（＋ のシート）、その隣に権限のチップ（今のプリセット名。タップで権限の選び直し）、右に送信ボタン。
- 入力中の文は、セッションごとにこの端末へ保存し（`localStorage`）、会話を開き直しても残します。送ったら消します。
- 接続が切れている間は、送信ボタンを押せなくします。
- サブエージェントの会話（`snapshot.subagent` が null でない）では、入力欄の代わりに「サブエージェントの会話は読むだけです」の 1 行を出します（2026-09-25 の決定。続けて頼む機能は後回し）。

### 送る

- 待機中：送信ボタンで `face.beginSubmission({ mode: 'queue', text, attachments })` を呼びます。送った直後の表示は、02 が `pendingSubmissions` から出します。
- **AI の実行中**（`snapshot.running`）
  - 送信ボタンをスプリットボタンにします。主ボタンは「順番待ち」（`mode: 'queue'`）、▾ から「割り込み」（`mode: 'steer'`）を選べます。
  - 送信ボタンの左に停止ボタンを出します（`face.cancel()`）。
- 行の先頭が `/` で、コマンドの一覧にある名前なら、`face.command(line)` で実行します。一覧にない名前なら、ふつうのメッセージとして送ります。
- 送信に失敗したら（`promptError`）、入力欄の上に「送れませんでした」と理由、「もう一度送る」を出します。入力した文は消しません。

### 順番待ち

- `snapshot.queue` のうち `placement` が `queued` か `steering` のものを、入力欄の上にチップで出します（「順番待ち 1 件」）。
- チップをタップすると「順番待ちの編集」のシートを開きます。1 件ならその操作を、2 件以上なら一覧を出し、選んだものの操作に進みます。
- 操作は `face.updateQueue(itemId, action)` です。
  - 「編集」：`TextPromptDialog`（複数行）で文を直し、`{ kind: 'edit', content: [{ type: 'text', text }] }`。
  - 「今すぐ割り込ませる」：`{ kind: 'steer' }`。
  - 「取り消す」：`{ kind: 'remove' }`。

### ＋ のシート

- 「画像を添付」：写真の選択を開きます（`<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple>`）。
- 「ファイルを参照」：入力欄に `@` を足して、ファイルの候補を出します。
- 「コマンド」：入力欄の先頭に `/` を足して、コマンドの候補を出します。
- 「計画モード」：スイッチ。今の状態は projection の `plan`（`active`）から読み、切り替えは `face.command('/plan')` と `face.command('/plan off')` です。
- 「モデル」：今のモデル名を添え、タップでモデルの選択を開きます。

### 候補（/ と @）

- 入力欄の上に浮いた一覧を出します。キーボードが出ている前提です。
- `/`：入力の先頭が `/` のとき、`ctx.remote.commands.list(sessionId)` の結果を前方一致で絞ります。一覧はイベント `commands/change` で取り直します。選ぶと `/名前 ` を入れ、引数のヒント（`input.hint`）があれば入力欄の中に薄く出します。
- `@`：カーソルの直前が「先頭か空白のあとの `@` で始まる語」のとき、`ctx.remote.fileReferences.list(agent, query, signal)` で候補を取ります。入力が止まって 150ms 待ってから取り、前の問い合わせは中断します。選ぶと `@パス ` に置き換えます。空白を含むパスは `@"パス"` にします。ファイルの中身は読みません。
- 候補の外をタップするか、該当がなくなったら閉じます。

### 画像の添付

- 選んだ画像は入力欄の中に小さく並べ、それぞれに × を付けます。
- 長い辺が 2,048px を超える画像と、PNG・JPEG・WebP・GIF 以外（iPhone の HEIC など）は、送る前に canvas で JPEG にします。
- 送るときに `attachments` に入れます。

### モデルの選択

- モデルの一覧と、今のモデル（projection の `modelSelection`）を出し、選んだら閉じます。
- 考える深さ（`reasoningEffort`）の「低・中・高」は、選んだモデルが対応しているときだけ出します。
- 一覧の出どころと、会話ごとに切り替える方法は「未確認のこと」を見てください。

### 権限の選び直し

- projection の `permissions`（`{ options, currentValue }`）から、プリセットを並べます。名前と説明（`description`）をそのまま出し、今のものにチェックを付けます。
- 選んだら閉じ、チップの名前を変えます。確認のダイアログは挟みません（2026-09-25 の決定。あとでフィードバックで見直す）。
- `currentValue` がどの選択肢にも合わないときは、チップに「カスタム」と出します。「カスタム」は選べません。

### 新しいセッション

- 上のバーは ← と「新しいセッション」。中央に「何をしますか」と「<ワークスペース名> で始めます」。下に `Composer({ target: { kind: 'new', workspaceId } })`。
- **最初のメッセージを送った時点で、セッションを作ります**（2026-09-25 の決定）。`sessions.create({ workspaceId })` で id を得て、そのセッションに送り、`#/s/<id>` へ `replace` で移ります。
- 何も送らずに戻ったら、何も作りません。
- 作成に失敗したら、この画面のまま入力欄の上に理由を出します。作成できて送信に失敗したときは、会話へ移ってから会話の中で失敗を出します。

## 使う DSH の窓口

- 00 の `useSession(sessionId)`：`face.beginSubmission`、`face.command`、`face.cancel`、`face.updateQueue`、`snapshot`、`projection('plan')`、`projection('permissions')`、`projection('modelSelection')`
- `sessions.create()`
- `ctx.remote.commands.list()`、イベント `commands/change`
- `ctx.remote.fileReferences.list()`
- 00 の `openSheet`、`TextPromptDialog`、`useConnection`、`navigate`

参考の実装：今の画面の `dsh-client-ui-conversation`、`dsh-client-ui-input-trigger`、`dsh-client-ui-commands`、`dsh-client-ui-reference`、`dsh-client-ui-attachment`、`dsh-client-ui-plan`、`dsh-client-ui-model-selection`、`dsh-client-ui-permission-presets`。

## 偽データ（mock.ts）

- `kit.addRemote('commands', …)`：`/plan`、`/plan off`、`/permission`、`/model` と説明
- `kit.addRemote('fileReferences', …)`：`docs/`、`docs/handoff.md`、`docs/ui-spec.md`、`README.md`
- `kit.setProjection` で、共通の 2 つのセッションに `permissions`（`workspace-write` のワークスペース書込と、`danger-full-access` のフル アクセス）、`plan`、`modelSelection` を置きます。
- モデルの一覧の出どころの偽物：「DeepSeek V4」「ローカル（ollama）」
- 送ったメッセージが履歴や順番待ちに入る動きは、00 の偽の `ISession` が持っています。

## テスト

`tests/03-composer.test.ts` で、次の純粋な処理を確かめます。

- カーソル位置の `@` の語の取り出しと、選んだ候補での置き換え（空白を含むパスの引用符を含む）
- `/` のコマンドの前方一致の絞り込みと、送るときにコマンドとして扱うかの判定
- 順番待ちの表示の対象（`placement` による絞り込み）
- 画像を JPEG にするかの判定（形式と大きさ）

## 完了条件

- `?mock` で、待機中と実行中の送り分け、停止、順番待ちの編集・割り込み・取り消し、2 種類の候補、画像の添付、計画モードの切り替え、モデルと権限の選び直し、新しいセッションの作成が動きます。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。

## 未確認のこと

- `beginSubmission` の `attachments` に、画像の中身をどう渡すか（`PendingSubmissionAttachment` は表示用の形に見える）。先に `dsh-client-ui-attachment` と `dsh-client-file-upload` の実装を読み、`prompt()` の `image` 部分（base64）で送る方が確実ならそちらを使ってください。
- モデルの一覧の出どころ（`ctx.remote.llm` か設定か）と、会話ごとにモデルを切り替える方法（コマンドか API か）。`dsh-client-ui-model-selection` を読んで決めてください。
- 権限のプリセットを切り替える方法。今の画面の `dsh-client-ui-permission-presets` は `remote.settings` を使っています。会話ごとの切り替えか、全体の設定かを確かめてください。
- `fileReferences.list` の最初の引数 `agent` に何を渡すか（セッションの ctx か id か）。

## 実装メモ

（実装した担当が書き足します）
