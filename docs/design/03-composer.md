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

### 2026-09-25：着手時の停止事項

- 実行環境を `workspace-write` に変更後、作業を再開した。現在のブランチは `feat/03-composer`、着手時の作業ツリーに変更はなかった。
- 入口として置き換える予定の `web/src/features/composer/Composer.tsx` と `web/src/features/composer/routes.tsx` は、読み取り時に `No such file or directory` となった。段階 1 の土台がこの worktree に揃っているかは未確認。共有の土台や依存を担当範囲外で追加せず、統合担当による確認が必要。
- `docs/ui-spec.md` の見出し確認、`web/src` と `tests` のファイル一覧取得、グローバル npm ルート確認をまとめた読み取りコマンドが、PreToolUse フックにより拒否された。理由は `tool input references a protected path or sensitive filename pattern`。ファイル一覧の検索には禁止パスを除外する glob を指定していたが、その除外指定もフックの検出対象になった。別コマンドや別ツールで同じ調査を迂回せず停止した。
- 既存 DSH プラグインの画像送信、モデル選択、権限設定、ファイル参照の引数は未調査。実装上の方式はまだ決めていない。
- 機能実装、`pnpm typecheck`、`pnpm test`、`pnpm build`、`?mock` の画面操作は未実施。DSH は起動していない。
- 再開には、保護フックが禁止パスの除外指定をどう扱うかの解決と、段階 1 の土台がこの worktree に揃っていることの確認が必要。担当外の変更は行っていない。

### 2026-09-25：今回の再調査許可後

- ユーザーの「今回では許可」を受け、読み取り調査を再開した。`docs/ui-spec.md` と担当 Canvas の `note` を確認した。
- 現在の `web/src/main.tsx` は `bootDsh()` を直接呼び、`web/src/App.tsx` は通信確認用の最小画面のまま。段階 1 の `?mock` 起動経路がこのブランチには未反映であることを確認した。
- 段階 1 の実装は `feat/00-foundation` のコミット `1d37b67` に存在する。このコミットには、03 の仮部品、共通のセッション API、シート、偽データと依存追加が含まれる。
- `1d37b67` の取り込みは03担当外ファイルも変更するため、`main` を変更せず `feat/03-composer` に取り込む例外許可を確認中。回答前に取り込みは行わない。

#### 既存プラグインで確認した送信とファイル参照

参照先は `/Users/user/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。DSH 本体は `0.1.5-rc.1`、調査したクライアントプラグインは `0.1.5-rc.2`。すべて読み取りのみで、起動していない。

- `dsh-client-ui-conversation/lib/client.js:2908–2959`：`beginSubmission({ mode, text, attachments, onRetire })` は表示用投稿の登録。その戻り値の `requestId` を `prompt(content, mode, signal, requestId)` に渡して実際に送る。画像の表示用添付は `{ type: 'image', value: { previewUrl, name?, width?, height? } }`、送信用は `{ type: 'image', mediaType, data, name? }`。したがって `beginSubmission` だけで送信完了とはしない。
- 同ファイル `2811–2821`、`3213–3232`：画像の `data` は Data URL の先頭からカンマまでを除いた base64。対応形式は PNG/JPEG/WebP/GIF。一般ファイルと違い、画像は事前の file-upload を使わず投稿に含める。
- 同ファイル `3188–3209`：失敗時は下書きを保持する。プレビュー URL は送信中表示にも使われるため、`onRetire` の `observed` を待って解放・引き継ぎを行う。送信準備失敗時は `submission.abandon()` を使う。
- `dsh-client-ui-reference/lib/client.js:109`：Web UI の `fileReferences.list` 第一引数は **sessionId**。Host 型の `Agent` をそのまま UI から渡すわけではない。候補は `{ path, kind: 'file' | 'directory' }`（`dsh-file-reference/lib/types/types.d.ts:7–11`）。
- `dsh-client-ui-reference/lib/client.js:17–22`：通常は `@path`、空白を含む場合は `@"path"`、ディレクトリ末尾には `/`。引用符や制御文字を含むパスは候補から除く。
- 新規画面には初回送信まで sessionId がない。確認した参照 API だけでは作成前のファイル候補を取得できないため、実装時は作成前の候補検索を無効にし、その理由を画面に示す方針。画像はブラウザ内で準備し、初回送信でセッションを作ってから送れる。

#### 既存プラグインで確認したモデル、権限、計画モード

- モデル一覧は `ctx.remote.session.modelCatalog()`（`dsh-client-ui-model-selection/lib/client.js:46`）。sessionId は不要で、新規作成前にも取得できる。返り値は `{ default, routableProviders, groups, failures }`。`groups` は `{ id, name, models: [{ id, name, description?, reasoning? }] }[]`。
- 会話ごとのモデル変更は `ctx.remote.session.selectModel({ sessionId, provider, model, reasoningEffort? })`（同 `152–180`）。成功値は `{ selected }`。projection は `{ lastUsed, next }` で、現在の選択は `next ?? catalog.default`（同 `225`）。新規画面では選択をローカル保持し、作成後・初回送信前に適用する方針。
- 深さ選択はモデルに `reasoning` がある場合のみ。型は `{ efforts: [{ id, name, description? }], defaultEffort? }`（`dsh-api-session-controller/lib/types/types.d.ts:96–112`）。UIでは対応する値だけを日本語で示し、非対応値を固定で送らない。深さを変える場合も provider/model を含めて selectModel を呼ぶ。
- 会話の権限は `face.command('/permission ' + preset)`。`ok` と `value.matched` を確認する（`dsh-client-ui-permission-presets/lib/client.js:488–493`）。表示元は permissions projection の `{ currentValue, options: [{ value, name, description? }] }`。`custom` は選択肢から外す（同 `402–420`）。
- `remote.settings.mutate('permission', [{ op: 'set', path: ['defaultPreset'], value: preset }], revision)` は今後作る会話の全体既定値の変更（同 `300–332`）。入力欄の権限チップでは使用しない。作成前に権限を選んだ場合もローカルに保持し、作成後の会話へコマンドで適用する方針。
- 既存UIにはフルアクセスの確認操作があるが、03の設計で明示された2026-09-25の決定に従い、このUIには追加確認を入れない。
- 計画モードは `/plan` と `/plan off`。`/plan on` は使わない。現行 handler は `off` 以外の引数をユーザーのメッセージとして扱う（`dsh-plan-mode/lib/index.js:178–225`）。projection の `pending` は次の処理段階で反映する変更も表し、既存UIの表示値は `pending ? !active : active`（`dsh-client-ui-plan/lib/client.js:29–45`）。
- 実DSHへのRPC成功、稼働ホスト固有のモデルと権限候補は未確認。段階2ではDSHを起動せず、実物確認は段階3へ残す。

### 2026-09-25：土台 25e3b2d 反映後の 03 実装

前の停止記録と調査記録は、その時点の記録として残した。今回は `feat/03-composer` 上の土台を使い、マージ・rebase・main の変更は行っていない。変更先は本節、`web/src/features/composer/`、`tests/03-*.test.ts` のみ。

#### 実装したこと

- `Composer({ target })` と `routes` の公開入口を維持し、M3E の自動高さ調整（最大 6 行）、送信ボタン、実行中のスプリットボタン・停止、順番待ちの操作を実装した。Enter は改行のままで、切断時は送信を無効にする。サブエージェントは読み取り専用の文言だけを表示し、送信処理側でも再確認する。
- 下書きの本文はセッション／新規ワークスペースごとの localStorage に保存する。画像、選択した設定、失敗時の送り方はタブのメモリに保持する。送信に失敗しても本文・画像を消さず、「もう一度送る」では元の queue / steer を維持する。保存領域が利用できない場合はメモリ内の下書きを維持する。
- ＋、ファイル・コマンド候補、画像添付、モデル・深さ、権限、計画モードを実装した。ファイル検索は 150ms 待機と AbortController で古い問い合わせを止める。ファイル内容は読まない。候補の外のタップと Escape で閉じる。
- 新規画面はワークスペース名を表示し、初回送信時だけ作成する。作成成功後に送信・設定適用が失敗した場合も、作成済みの会話へ下書きを移して replace で移動する。同じ下書きの処理中の呼び出しは合流させ、画面を開き直した場合の二重作成を防ぐ。
- 共通 2 セッションと追加・新規セッションへ偽の projection を設定し、モデル一覧、権限の既定値、コマンド、ファイル候補を登録した。後から追加する偽セッションに明示された projection は維持する。

#### 未確認事項を既存プラグインで確かめた結果

参照元は今回 `npm root -g` で確認した `/Users/user/.npm-global/lib/node_modules` の DSH 配下。既存プラグインは読み取りだけで、変更・起動はしていない。

1. **画像送信**：`dsh-client-ui-conversation/lib/client.js:2908–2959` を再確認した。`beginSubmission` は表示用の添付と本文を登録し、実送信は `prompt(content, mode, undefined, requestId)` で行う。`2811–2821`、`3213–3232` の画像形式に合わせ、Data URL の先頭を除いた base64 を `{ type: 'image', mediaType, data, name }` として送る。画像には file-upload を使わない。失敗時は仮表示を abandon し、下書きは保持する。
2. **モデル**：`dsh-client-ui-model-selection/lib/client.js:46`、`152–180` の `session.modelCatalog()`／`session.selectModel({ sessionId, provider, model, reasoningEffort? })` を採用した。現在値は `modelSelection.next ?? catalog.default`。`dsh-api-session-controller/lib/types/types.d.ts:96–136` のモデルごとの efforts だけを選択肢にする。会話へのモデル・深さの適用に加え、Host は `agentDefaultModel.saveSelection` で全体の既定値の保存も試みる。既定値の保存だけに失敗しても警告を記録して会話への選択は成功する（2026-09-26 訂正。以前の「全体の既定値は変えない」という記述は誤り）。
3. **権限**：`dsh-client-ui-permission-presets/lib/client.js:488–493` の `/permission <preset>` を使い、`ok` と `matched` を確かめる。新規画面の候補は、同 `230–258` が読む `settings.describe()` の permission 名前空間にある defaultPreset の列挙スキーマから取得できた。03 では公開された object / union / const の形だけを読む。全体設定への mutate は呼ばない。
4. **ファイル参照**：`dsh-client-ui-reference/lib/client.js:109` の第一引数は sessionId。`17–22` の規則どおり、空白のあるパスを引用し、ディレクトリには `/` を付け、引用符や制御文字のある候補は除く。
5. **計画モードとコマンド**：前回の `/plan`／`/plan off`、`pending ? !active : active` の調査結果を採用した。再送では projection の実効状態と希望値が違う場合だけ切り替える。`dsh-client-ui-commands/lib/client.js:537–539` の `commands/change` で一覧を取り直す。イベント API の解除関数がない場合も、閉じた画面へ更新を渡さない。

#### 実装時に決めたこと

- 新規作成前は sessionId がないため、ファイル・コマンド候補の検索を始めず、画面で理由を伝える。モデルと権限の一覧は作成前に読める。選択した設定はローカルに保持し、初回作成後の会話へ適用する。
- 既存 UI の `/model` は `dsh-client-ui-model-selection/lib/client.js:919–942` にあるクライアント側のコマンド登録で、Host のコマンド一覧にあるとは限らない。03 では画像を伴わない `/model` の送信をモデルシートとして扱い、新規画面でもセッションを作らない。実際にモデルを選べたときだけ、このコマンド文字列を消す。その他の既知コマンドは command で実行し、未知または一覧取得後に消えたコマンドは通常の本文として送る。
- 既知コマンドと画像の同時送信は、画像の黙った破棄を防ぐためエラーとして下書きを保持する。
- 共通 `TextPromptDialog` は 1 行の input 専用だったため、共有ファイルは変更せず、03 内の `QueueEditDialog` で複数行編集を提供した。queue の edit は実物の契約でも text-only なので、添付がある場合は編集時に外れる旨を表示する。
- 画像プレビューには Data URL を使い、送信中表示が参照している URL の早すぎる解放を避ける。対応 4 形式の 2,048px 以下の画像は元の形式を保持する。長辺超過・非対応形式は白背景の JPEG（品質 0.9、最大 2,048px）にする。ブラウザが HEIC 等をデコードできない場合は日本語エラーを出し、PNG/JPEG の選び直しを案内する。変換するアニメーション画像は静止画になる。
- `mock.ts` の `/plan off` は、実物どおりコマンド名 plan と引数で表す。新規権限候補のために登録した偽の `settings.describe` は permission 名前空間だけを返す。08 が settings の偽データを実装するときは、この項目も同じ describe の返り値へまとめる必要がある（共通 addRemote は重複した名前空間の後登録を受け付けない）。今回、他担当のファイルは変更していない。

#### 検証結果と残る確認

- `pnpm typecheck`：成功。途中で Node 側の型チェックがブラウザ画像処理まで参照する問題を検出し、03 内の `types.ts` に画像の型を分離して解消した。共通の TypeScript 設定は変更していない。
- `pnpm test`：81 件すべて成功（03 の追加分 26 件）。参照・コマンド・queue・画像変換の純粋処理、RPC 引数と失敗、偽の projection、localStorage 復元、初回作成・再送・二重作成防止・画像 wire・送り方保持・読み取り専用化を検証した。
- `pnpm build`：成功。JavaScript のチャンクサイズ警告は残る（約 966 KB、同梱フォント約 4 MB）。
- `?mock` で操作した画面：なし。今回の明示指示に従い、開発サーバー、HTTP 確認、ブラウザ操作、DSH 起動は行っていない。待機中／実行中の会話、新規画面、＋、候補、queue、画像、モデル・権限シートの操作確認はオーケストレーターへ引き継ぐ。
- 実 DSH での RPC、ホスト固有のモデル・権限候補、iPhone の画像選択・HEIC デコード、キーボードと 390px 幅の見た目は未確認。段階 3 およびオーケストレーターの画面検証に残す。
- 今回、保護フック・実行方針で拒否された操作はない。担当外で必要になった変更はなし。土台で進行中の変更は取り込まず、オーケストレーターへ任せた。

### 2026-09-25：レビュー指摘 1〜3 の修正と 4 の引き継ぎ

開始時は `feat/03-composer`、作業ツリーはクリーンだった。前節までの記録を残し、03 の担当ファイルだけを変更した。00・08、依存、main は変更せず、土台の取り込みも行っていない。

#### 1. 画像準備中に入力欄を開き直した場合

- 下書きをセッションごとに購読できるようにし、Composer は `useSyncExternalStore` で本文・画像・準備件数・読み込みエラーを同じスナップショットから読む。画像の非同期準備も下書き単位で管理し、古い部品だけが結果を受け取る状態をなくした。
- 再表示した入力欄にも準備中の状態を表示して送信を無効にする。送信処理側でも準備中を拒否し、準備完了後は新しい入力欄にプレビューと送信可能な状態が通知される。画像だけの下書きも同じ経路を使う。
- 並行した準備の残り件数、途中の本文編集、別の会話の下書きを保持する。下書きを消した後に完了した古い準備は無効にし、後の下書きへ画像を追加しない。

#### 2. 作成後のワークスペース登録だけに失敗した場合

- インストール済み DSH の `dsh-api-session-controller/lib/types/commands.js`、`client/sessions/manager.js`、`client/sessions/service.js` を読み取り確認した。`session/workspace-attach-failed` の details は作成済みの sessionId と workspaceId を含み、クライアントの `SessionCreateError` は元の失敗を rpcError に持つ。
- この失敗だけから ID を回収し、本文・画像・モデル等の選択を `session:<作成済み ID>` の下書きへ移す。既存 ID とワークスペースの組は localStorage にも保存し、ページを再読み込みしても新しい ID を割り当て直さない。未知のエラー、ID 欠損、異なる workspaceId からは回収しない。
- 部分失敗時は成功時と違って一覧への同期反映が保証されないため、scope がなければ `sessions.refresh()` を試す。それでも会話を開けなければ新規画面にも回収済み ID を残し、操作不能な会話画面へ遷移しない。次回送信はその ID を使い、セッションを新しく作らない。
- 「ワークスペースへ登録し直す」を通常の送信とは別の操作にした。実物の公開された登録再試行経路は `sessions.create({ workspaceId, sessionId: 作成済み ID })` で、指定した既存会話の再利用（adopt）となり、新規 ID は割り当てない。`workspaces.insertSessionBefore` は所属済みの会話の並べ替えなので、この用途では使わない。
- 登録だけが再び失敗しても ID・下書きを保持し、同じ ID で再試行する。登録成功でも本文は送信しない。通常の本文送信が成功しても、未完了の登録操作は残す。処理中の再表示は同じ Promise に合流する。

#### 3. 偽の settings 名前空間の所有

- `composer/mock.ts` の settings 登録を削除した。03 が登録するのは commands・fileReferences・session と各 projection だけで、設定の偽データは 08 が所有する。
- API テストは必要な settings をテスト内で用意し、03 の登録前後どちらでも設定の読取・保存を妨げないことを確かめた。08 のファイルは読み込んでいない。
- この単独ブランチには新規会話の既定権限を返す settings の偽データはない。統合時に 08 の `settings.describe()` が permission 名前空間の defaultPreset と列挙スキーマを返すことを前提とする。代わりの settings 登録は追加していない。

#### 4. 共通の複数行ダイアログ

- **土台の取り込み後に TextPromptDialog の multiline へ置き換える。**
- `feat/00-foundation` の `ae2bc3c` 以降はこのブランチに未反映なので、今回 `Sheets.tsx` の自前の QueueEditDialog は変更しない。取り込み・共通部品の変更はオーケストレーターへ任せる。

#### 今回の検証と残る確認

- `pnpm typecheck`：成功。
- `pnpm test`：96 件すべて成功。今回追加の 15 件に加え、既存の端末保存テストへ復旧 ID の保存・復元・消去・不正値の扱いを追加した。入力欄の購読し直し（本文あり／画像だけ）、画像準備中の送信防止、作成の部分失敗、一覧反映の遅れ、同じ ID の登録再試行、設定の所有を検証した。
- `pnpm build`：成功。既存と同種のチャンクサイズ警告は残る（JavaScript 約 971 KB）。
- `?mock` の画面操作、DSH・開発サーバー起動、HTTP 確認は今回も行っていない。ブラウザの実操作はオーケストレーターへ引き継ぐ。
- 拒否された操作はなし。今回の担当外の変更はなし。残る作業は、00 の取り込み後の項目 4 と、08 側での permission の既定値の偽データ提供。

### 2026-09-26：土台取り込み後の順番待ち編集ダイアログの共通化

- オーケストレーターによる土台の取り込みを確認し、前節の項目 4 を実施した。開始時は `feat/03-composer`、作業ツリーはクリーンだった。自分で merge・rebase は行っていない。
- `00-foundation.md` の公開入口と実装を読み、`TextPromptDialog` の `multiline`・`rows`、本文の空白保持、保存失敗の表示、成功時に呼び出し元が閉じる契約を確認した。`Sheets.tsx` の自前の `QueueEditDialog` を共通部品に置き換えた。
- 自分で決めたこと：`rows: 3` は従来どおりとし、改行・字下げ・末尾の空白をそのまま送る。画像が外れる注意書きは、共通部品の入力ラベルに含めて残した。保存の処理と入力設定を `queue-edit.ts` に分け、React を描画しない Node テストで契約を確かめる。
- `updateQueue` の失敗結果は `unwrapRemoteResult` で例外にし、通信の例外も捕まえずに `onConfirm` から返す。共通ダイアログがエラーを表示し、編集中の本文を保持する。閉じるのは成功後だけで、再試行でも同じ項目 ID を使う。
- 自前の textarea・自動伸縮部品・保存中やエラーの状態管理、および不要な import を削除した。`composer.css` を確認したが、編集ダイアログだけが使うルールはなかった。残る textarea・シート・プレビューのスタイルは使用中なので維持した。
- `tests/03-queue-edit.test.ts` に 4 件を追加した。複数行設定と本文保持、応答前に閉じないこと、失敗の伝播と再試行、通信例外、画像だけの場合の注意表示とキャンセル時の未保存を検証した。
- 初回の型検査で、テスト側の設定では TSX の型 import と `Promise.withResolvers` が利用できないことが分かった。03 内で型推論と通常の Promise に変更し、共通部品・型検査設定・依存は変更していない。
- 最終検証：`pnpm typecheck` 成功、`pnpm test` 148 件すべて成功、`pnpm build` 成功。ビルドには既存と同種の 500 KB 超のチャンク警告がある（JavaScript 約 974 KB）。
- 未確認のこと：指示に従い、`?mock` のブラウザ操作、DSH・開発サーバー起動、HTTP 確認は行っていない。実画面での複数行入力・失敗表示の操作確認はオーケストレーターへ引き継ぐ。今回 DSH の送信 API は変更せず、前節までのプラグイン調査結果を変更する判断はない。
- 拒否された操作はなし。担当外で必要になった変更はなし。03 のファイルとこの実装メモだけを変更した。

### 2026-09-26：Claude（Opus 5.5）の指摘 1〜4 の修正

開始時は `feat/03-composer`、作業ツリーはクリーンだった。オーケストレーターが取り込んだ土台と各機能を使い、03 の担当内だけを変更した。自分で merge・rebase は行っていない。

#### 1. HTTP でも画像を添付できる ID

- `crypto.randomUUID` を廃止し、モジュール内の連番 `composer-image-<番号>` にした。画像はタブのメモリ内だけに保持するため、下書きの画像を見分けるこの ID に暗号 API や永続的な一意性は不要と判断した。
- 画像デコード・変換後に送信内容とプレビューを組み立てる処理を `image-content.ts` へ分離した。送信形式・Data URL の検証は維持し、ブラウザの画像処理を Node テストへ持ち込まない。
- 暗号 API がない状態で、同じ画像の複数添付・削除後の再添付でも ID が重ならず、base64 とプレビュー情報を保持することを検証した。HTTP の実画面、写真選択や HEIC のデコードは今回も未確認。

#### 2. 考える深さの表示と偽データ

- インストール済み `dsh-llm-deepseek/lib/index.js:1413–1443` と `1578–1597` を読み取り確認した。実物の候補は `off / low / high / max`、thinking 無効時は `off` だけ。通常の既定値は接続設定を反映し、指定がなければ `high` になる。
- `off` を「オフ（考えない）」と表示する。未知の候補は「追加の深さ <一覧での番号>」とし、日本語表示を保ったまま複数の候補を区別する。送信する ID は変えない。
- 03 の偽モデルも同じ 4 候補とし、既定は `high` にした。全候補の選択と非対応の `medium` の拒否を Node テストで検証した。

#### 3. 先行拡張の偽セッションとコマンド一覧の失敗

- `extendMock` の開始時に `kit.updateList` から既存の全セッションを取得し、03 の補助機能へ登録する。projection の書き込みも一覧を更新するため、初期化は一覧取得のコールバックの外で行う。
- 他機能が指定した権限・計画・モデルの projection を保持し、不足分だけ補う。共通会話に土台が指定した権限の 1 候補も維持する。03 が候補を補う会話では従来の 2 候補を使う。後続の追加・削除・同じ ID の再追加も扱い、古いモデル選択を引き継がない。
- テスト内で先行・後続の拡張を用意し、権限等の取得、コマンド一覧、ファイル候補、モデル選択、明示値の保持を検証した。他機能の偽データを読み込むテストや、他機能のファイル変更は追加していない。
- **判断**：実物でコマンド一覧の取得に失敗した場合、`/` で始まる入力は送信せず、本文・画像・送り方を下書きに保持する。取得不能と「一覧に存在しない」を区別し、コマンドのつもりの入力を勝手に通常文として送らない。再送では一覧を取り直し、既知のコマンドなら実行、未知なら通常文として送る。既存の挙動を維持し、取得失敗と復旧後の両経路の回帰テストを追加した。

#### 4. モデル選択の既定値保存の訂正

- インストール済み `dsh-api-session-controller/lib/types/commands.js:126–158` を読み、会話へモデルを適用したあと `agentDefaultModel.saveSelection` で全体の既定値も保存することを確認した。既定値だけ保存できない場合は警告を残して、会話の選択成功を返す。
- 本メモの以前の「全体の既定値は変えない」を訂正した。03 の API の呼び方は変更していない。新規画面でまだ送信していない選択はローカル保持のまま。モデルシートに既定値保存の説明を添えるかは、依頼どおり段階 3 の判断に残す。
- 調査元は前節までに記録した `/Users/user/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` の上記パッケージ。必要なファイルを読むだけで、プラグインの変更・起動はしていない。

#### 検証結果と残る確認

- `pnpm typecheck`：成功。
- `pnpm test`：428 件すべて成功。今回追加した回帰テストは 6 件。
- `pnpm build`：成功。既存と同種の 500 KB 超のチャンク警告あり（JavaScript 約 1,479 KB、同梱フォント約 4 MB）。
- `?mock` の画面操作はなし。DSH・開発サーバー起動、HTTP 確認、ブラウザ操作は行っていない。統合画面、iPhone の画像選択・キーボード、実 DSH の通信はオーケストレーターおよび段階 3 の確認に残す。
- 今回、拒否された操作はなし。担当外で必要になった変更はなし。

### 2026-09-26：統合後の仕様照合と横断レビュー（feat/03-composer-spec）

レビュー対象は `dec19bd`。今回の作業開始時は、オーケストレーターが切り替えた `feat/03-composer-spec`、HEAD は `c3a9099`、作業ツリーはクリーンだった。指定された `spec-conv.out.md`、`cross.out.md`、`user-decisions.md` を読み、ユーザー決定を優先した。main の変更、merge・rebase、未到着の土台の新入口の使用は行っていない。

#### 入力欄と補助シートの表示

- シートの本文だけに `composer-sheet-copy` を付けて伸縮させ、左右のアイコンは `composer-sheet-icon` で幅 24px・伸縮なしにした。計画モードの行にも同じ指定を使い、アイコンの span が本文と同じ幅を取る問題を解消した。
- 送信は `arrow_upward`、権限は `shield` 付き outlined の `M3eAssistChip` にした。順番待ちは `schedule` 付き chip を右寄せする。M3E の chip の公開型・slot・CSS 変数をローカル依存で確認し、順番待ちは elevated variant の色と影を公開変数で調整した。
- ＋シートを `image`・`checklist`・`smart_toy` に合わせ、ファイル・コマンドの補足文、モデル末尾の `chevron_right` を追加した。ファイル候補は folder / description、コマンドは plan→checklist・permission→shield・model→smart_toy・その他→terminal、モデルは ollama→dns・その他→smart_toy、権限は danger-full-access→warning・その他→shield とする。識別には変更可能な表示名を使わない。
- 余白と角丸は既存の `--app-space`・`--app-radius` から計算した。ボタン行は折り返せるようにし、実行中も権限を表示して送信グループを右寄せする。今回指定されていないフォントサイズ・アイコン幅・操作領域の高さは独立した値として維持した。実際の 390px 幅での収まりは未確認。

#### 新しい会話の @ と / の候補の調査結果

- **調べた公開 API では、会話を作る前に候補を取得できない。** ユーザー決定 3 に従い、候補を開くときの会話作成は今回は実装しない。現在の初回送信時の作成を維持する。
- インストール済み `dsh-client-ui-reference/lib/client.js:108–109` は `fileReferences.list(session.sessionId, query, signal)` を呼ぶ。`dsh-api-session-controller/lib/types/file-references.js:55–63` と `dsh-file-reference/lib/types/index.d.ts:22–29` は、第一引数を対象会話の Agent としている。workspaceId や cwd で作成前の候補を取る引数はない。
- `/` も `dsh-client-ui-commands/lib/client.js:518–522` の `commands.list(sessionId)` を使う。`dsh-commands/lib/types/index.js:252–261` の一覧は Agent ごとの有効なコマンド構成を返す。全体の固定一覧や別会話の一覧を代用すると、対象会話の候補と一致する保証がない。
- 両 API の Agent 引数は `dsh-api-session-controller/lib/types/agent.js:173–190` の Typert lookup で sessionId から解決する。既存の Agent がなければ保存済み会話を再開し、会話がなければ `session/not-found` になる（同 `211–227`、`403–423`）。ID を仮に用意するだけでは取得できない。
- `dsh-client-ui-conversation/lib/client.js:13408–13427` の InputHub は会話の scope / binding を必要とする。新規表示に対応する `session-maybe` の枠（同 `16630–16648`）があっても、作成前の候補取得 API は提供していない。
- **候補を初めて開く時点で会話を作る案の利点**：対象ワークスペースと Agent の実際の候補を既存 API で取得できる。作成済み ID を下書きに保持すれば、初回送信にも同じ会話を使える。
- **同案の欠点**：候補を見るだけで永続的な空の会話が増え、「何も送らずに戻ったら作らない」という現在の動作が変わる。作成・ワークスペース登録の失敗を候補表示でも扱う必要がある。作成待ちの二重操作、再表示、ワークスペース切替、放置した空の会話の扱いも決める必要がある。自動削除は送信や別画面の操作と競合し得るため、この回では追加しない。
- 調査は `/Users/user/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 配下の上記パッケージの lib を読むだけで行った。DSH の起動・通信確認はしていない。

#### 偽データの共有状態と結果の展開

- モデル選択用の独自 Map を削除した。選択のたびに `kit.updateList` の公開コールバックから現在の `modelSelection` を読み、他機能や完了した処理が書いた `lastUsed` を保持して `next` を更新する。後登録の拡張、後続の更新、明示的な null の回帰テストを追加した。
- `api.ts` の独自 `unwrapResult` を削除し、既存の土台の `unwrapRemoteResult` を使う。`requireMatched` と各 RPC の成功値・元のエラー情報の扱いを維持した。モデル選択が Host の全体既定値の保存も伴うことに合わせて、API の説明コメントも訂正した。

#### 担当外で必要になった変更

- **既定権限の引き継ぎは未実装。** 現行 `MockKit` には、登録済みの 08 の settings を読む公開入口がない。`addSession` は同期 void で、既存の `sessions.create` を取得してラップする入口もなく、設定の非同期取得を会話の作成完了前に待てない。08 の `settings.describe()` に `permission.defaultPreset` があることは確認したが、03 から読める形ではない。
- 00 に必要なのは、拡張の登録順に依存せず既存 Remote の設定を参照する入口と、`sessions.create` が待つ非同期の初期化処理（または同等の共有既定値の仕組み）。その土台を使って 03 が作成時の permission projection を設定できるようにする必要がある。既存会話・明示された projection は変更しない。08 のファイル変更、settings の二重登録、登録の傍受による独自の設定複製、土台の内部構造へのアクセスは行っていない。
- 会話を作らずに候補を出す方針を維持する場合は、DSH 側にワークスペースや適用するプリセットを指定できる候補 API が必要。これは 03 の担当外。代案の早期作成も上記の判断事項を伴うため、今回は実装せず報告する。
- 子の会話の選択・編集可否（ユーザー決定 5 の continuable 対応を含む）、所有画面からの離脱時のシート閉鎖、TextPromptDialog の確定文言は、作業中の土台の新入口を使えるようになった後の対応が必要。この回では既存の入口と動作を維持した。

#### 今回の検証と引き継ぎ

- `pnpm typecheck`：成功。
- `pnpm test`：529 件すべて成功。共有モデル projection を後から更新しても `lastUsed` を保つ回帰テストを追加し、既存の API エラーテストを共通関数利用に合わせた。
- `pnpm build`：成功。既存と同種の 500 KB 超のチャンク警告あり（JavaScript 約 1,579 KB、同梱フォント約 4 MB）。
- `?mock` で操作した画面：なし。指示に従い、DSH・開発サーバー起動、HTTP 確認、ブラウザ操作は行っていない。アイコン・chip・候補の配置、折り返し、iPhone のキーボードはオーケストレーターの画面検証に残す。
- 新規候補の取得と偽データの既定権限の引き継ぎは上記の理由で未実装。担当外のファイルは変更せず、必要な変更と選択肢をこの節へ記録した。今回、拒否された操作はない。

### 2026-09-27：モデル選択のドロップダウン化

- 遅い `modelCatalog()` 応答を `openModels` が待ってから別シートを開く旧実装では、待機中の再操作でシートを重ねられる。旧 `ModelSheet` は開いた時点の `selected` を保持し、反映後に一枚だけ閉じるため、古い選択と inert のままの画面が残る。
- ＋ の「入力の補助」内に M3E の `M3eSelect` / `M3eOption` を置き、`/model` は同じ選択部品を持つ単独シートにした。M3E に optgroup 相当を使わず、候補を「提供元 / モデル名」で表した。考える深さは選択中のモデルに `reasoning` がある場合だけ表示する。先読みの Promise をシートと共有し、取得中・失敗・再試行・反映中・反映失敗をシート内で扱う。成功後もシートを閉じず、最新の値を表示する。
- 390px の `?mock` Playwright で M3E のメニューがボトムシート内から開き、選択できることを確認した。M3E の深さ選択欄は新規会話で値変更後に空表示になる場合があったため、描画の次のフレームで現在値を同期した。旧一覧形式を前提にした `e2e/mock.spec.ts` の 03b・03d も更新した。
- アニメーション有効・一覧応答 200ms 遅延のもとで、読み込み中に Escape で閉じてすぐ開き直す操作を 2 回繰り返す試験を追加した。ネイティブのシートが閉じ終わるまでは背景へのクリックを遮るため、試験では各 Escape のあとシートの DOM が消えた時点で次の「＋」を押す。シート 1 枚、選択値、閉じたあとの overflow と inert を確認した。
- 最終検証：`pnpm typecheck` 成功、`pnpm test` 704 件成功、`pnpm build` 成功、Playwright 全件 71 件成功。追加した反復操作試験は `--repeat-each 5` で 5 回成功（専用ファイル全体の 5 回反復でも 30 件成功）。実物の DSH での応答速度・モデル一覧と反映は段階 3 に残る。
- 修正前の `main` で新しい試験を実行する準備として、変更した 3 ファイルのコピーを `/Users/user/AI/tmp/dsh-model-baseline/` に置いた。その後、`git show main:web/src/features/composer/Composer.tsx > web/src/features/composer/Composer.tsx` が保護フックから `Opaque shell wrappers are blocked unless Codex can split them into allowed commands.` と拒否されたため、差し替えをせずに停止した。オーケストレーターの追加指示で修正前の試験は取りやめた。旧実装の固まり方はオーケストレーターがブラウザで再現済みであり、新試験の旧実装での失敗はドロップダウンを前提とするため自明。コピーは残し、`main` のファイル差し替えは行わない。

### 2026-09-27：モデル選択の状態更新と二重送信の修正

- `openSheet` の描画関数は開いた時点の Composer の値を閉じ込めるため、シート内の `disabled` と会話選択を `useConnection`・`useSession`・下書きの購読から計算するようにした。既存会話の選択は `modelSelection.next` の更新に追従し、適用関数は呼ばれた時点の API・会話 face・接続状態を Composer の ref から読む。
- モデルの反映要求は Composer ごとに共有する controller に移した。シートを閉じて開き直しても反映中の表示と無効状態を引き継ぎ、二重の `selectModel` を拒む。成功時の選択と失敗理由も開いているシートへ伝え、失敗時はモデルと深さを元の値へ戻す。
- 深さの選択値とモデルの `defaultEffort` がともにないときは、先頭の候補を選択済みにせず「既定」を表示する。純粋関数の単体試験を追加した。`?mock` の失敗・遅延は試験から明示した場合だけ有効で、通常の挙動は変えない。
- アニメーションを有効にした Playwright で、失敗時の復元、反映中の閉じ直し、順番待ちシートから編集ダイアログへの切り替えを追加した。後者は Issue #5 のシート切り替え競合に対する別の入口での回帰試験。
- 接続回復の e2e は省いた。`scenario=disconnected` で開いたシートから再接続を試すと、偽接続の再構成に伴い会話画面とシートが閉じるため、同じシートの再有効化を検証できなかった。実 DSH の再接続でシートが維持される場合の動作も未確認。
- 検証：`pnpm typecheck` 成功、`pnpm test` 705 件成功、`pnpm build` 成功、Playwright 全件 74 件成功。新規の失敗・反映中・シート切り替えの 3 件はそれぞれ 5 回連続で成功（15 件）。`?mock` の幅は Playwright 設定の 390px。実 DSH は起動していない。

### 2026-10-08：Issue #41 モデル反映と送信・本文編集の競合

- controller を session service と draft key 単位で共有し、シートを閉じたり Composer を再表示しても反映待ちを保持する。Composer は状態を購読して送信を無効化し、送信入口でも同期確認する。送信開始時はモデル変更を拒否し、完了・失敗時に解除する。
- `/model` の消去は本文の編集世代が変わっていない場合に限る。別文へ変えた後に `/model` を書き直す場合も保持し、画像準備など本文以外の更新は消去の妨げにしない。
- 修正前にブラウザ回帰 4 件すべて失敗、送信中の選択拒否の単体も失敗。修正後は新規 5 件＋既存 9 件の Chromium 試験成功。別会話の独立性、失敗解除、再表示、編集の ABA、現在の既定値での新規下書き再利用を含む。
- Node 22.23.3／TZ=Asia/Tokyo の全単体 1,112 件成功、skip 0。型検査・ビルド・梱包検査も実施。公開 DSH 0.2.0-rc.2 の native 2 件を含む。独立レビューの 39 件成功、最終的な残存指摘なし。
- 隔離公開 DSH と localhost 偽 LLM に対する I41 試験で、既存会話で変更した provider/model/reasoningEffort が次回 `request/header` に記録され、偽 LLM に選択モデルで要求が届くことを確認。実データ・有料 API・実機は使用しない。
