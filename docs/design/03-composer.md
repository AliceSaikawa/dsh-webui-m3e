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
2. **モデル**：`dsh-client-ui-model-selection/lib/client.js:46`、`152–180` の `session.modelCatalog()`／`session.selectModel({ sessionId, provider, model, reasoningEffort? })` を採用した。現在値は `modelSelection.next ?? catalog.default`。`dsh-api-session-controller/lib/types/types.d.ts:96–136` のモデルごとの efforts だけを選択肢にする。モデル・深さの選択は会話単位であり、全体の既定値は変えない。
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
