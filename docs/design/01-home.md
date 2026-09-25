# 01 一覧とワークスペース

## 目的

アプリを開いて最初に見る画面です。今いるワークスペースのセッションを並べ、ワークスペースを切り替え、新しいワークスペースを足せるようにします。

## 担当する画面

| Canvas の画面 id | 名前 |
|---|---|
| `seedF1` | セッション一覧 |
| `drawer` | ワークスペースの切り替え |
| `picker` | フォルダの選択 |
| `listMenu` | 一覧の ⋮ メニュー |
| `rowActions` | セッションの操作 |
| `emptyList` | セッションがないとき |
| `offline` | 接続が切れたとき（バナー自体は 00 が作る。この画面では ＋ を押せなくすることだけ） |

仕様は `docs/ui-spec.md` の「セッション一覧（ホーム）」「ワークスペースの切り替え」「フォルダの選択」「一覧の ⋮ メニュー」「接続が切れたとき」「そのほかの一覧と設定の画面」の節です。

## 担当するファイル

- `web/src/features/home/` の全部
- `tests/01-*.test.ts`
- この設計書の「実装メモ」

## 画面の中身

### 一覧

- 上のバー：左に ≡（ドロワーを開く）、中央に今のワークスペースの名前、右に ⋮。
- 今のワークスペースは、この端末の `localStorage` に覚えます。覚えたものがないか、消えていたら、並び順の先頭のワークスペースにします。
- 行の並びは、ワークスペースの `sessionIds`（手動の順）に従います。`sessionIds` にないセッションは出しません。アーカイブ済み（`archivedSessionIds`）は出しません。
- 行の中身
  - 左：モデルのアイコン。`projectionValues.modelSelection.lastUsed` の提供元とモデル名から、同梱の SVG を選びます。合うものがなければモデル名の頭文字を丸の中に出し、値がなければ汎用のアイコンにします。SVG は `features/home/model-icons/` に置きます（DeepSeek と、汎用の 2 つがあれば足ります）。
  - アイコンの右下に状態の印：実行中（`running`）、完了して未読（`completed`）、返事待ち（`usePendingInteractions(sessionId)` が空でない）。
  - 1 行目：`displayTitle`。2 行目：「作業フォルダ名 ・ 最終更新日時」。作業フォルダ名は `cwd` の最後の部分です。日時は、今日なら時刻、それ以外は日付にします。
  - タップで `#/s/<id>` へ移ります。
  - 長押しで「セッションの操作」のシート（題名を変える、アーカイブ）。横スワイプでアーカイブ。アーカイブのあとは、スナックバーで「アーカイブしました」と出します。
- 右下の FAB（＋）：`#/new?ws=<今のワークスペース id>` へ移ります。接続が切れている間は押せなくします。
- 一覧を下に引っぱると、`sessions.refresh()` で読み直します。
- 一覧の最後の行が、FAB、ナビゲーションバー、ホームバーに隠れないよう、下に余白を取ります。
- セッションが 1 件もないときは「まだセッションがありません」と「右下の ＋ から始められます」を中央に出します。
- 一覧を読み込み中（`phase: 'pending'`）は、行の形の仮の表示（スケルトン）を出します。

### ワークスペースの切り替え（ドロワー）

- M3 のモーダルのナビゲーションドロワーです。左から出し、右側を暗くします。外側をタップするか、左へ払うと閉じます。
- ワークスペースを並べ、今のものを選択中にします。1 行は名前（`title`）とフォルダの場所（`path`。ホームは `~` に縮める）です。
- 選ぶと、今のワークスペースを切り替えてドロワーを閉じます。
- 長押しで、名前の変更（`TextPromptDialog`、`workspace.rename`）、並べ替え（`insertBefore`）、登録の解除（`workspace.delete`）を選べます。登録の解除は確認のダイアログを挟み、「フォルダの中身は消えません」と書きます。
- 最後の行「ワークスペースを追加」で `#/workspaces/add` へ移ります。`directoryPicker.capability()` が使えないときは、この行を出しません。

### フォルダの選択

- 上のバー：× と「フォルダを選ぶ」。× で `back()`。
- 最初はホーム（`list()` の引数なし）を開きます。
- パンくず（`crumbs`）をチップで並べ、タップでその階層を開きます。
- フォルダの行（`entries` のうち `hidden` でないもの）をタップすると 1 階層下に入ります。この移動は画面を積まず、同じ画面の中で中身を入れ替えます。
- `truncated` が true なら「1,000 件を超えるフォルダは一部だけ表示します」と出します。
- 下のボタン：「新しいフォルダ」（`TextPromptDialog` で名前を聞き、`createDirectory`）、「ここを追加」（`workspace.create({ path })`）。追加したら、そのワークスペースを今のものにして一覧に戻ります。
- `capability().kind` が `native` のときも、この画面では `browse` の形を使います（iPhone から OS のフォルダ選択は使えないため）。`browse` が使えないときの扱いは「未確認のこと」を見てください。

### 一覧の ⋮ メニュー

- 「並べ替え」：行の右端につまみを出し、ドラッグで並べ替えるモードに入ります。上のバーを「完了」ボタンに切り替えます。並べ替えは `workspace.insertSessionBefore` で 1 件ずつ反映します。
- 「選んでアーカイブ」：行の左にチェックボックスを出すモードに入ります。上のバーに「n 件をアーカイブ」ボタンを出し、`archiveSession` を 1 件ずつ呼びます。
- 「名前を変える」：今のワークスペースの名前を `TextPromptDialog` で変えます。
- 「サブエージェントも表示」：切り替えスイッチ。既定はオフで、オフのときは `origin: 'subagent'` の行を隠します。値はこの端末に保存します。

## 使う DSH の窓口

- `sessions.list`、`sessions.refresh()`
- `ctx.remote.workspace`：`list`、`create`、`rename`、`delete`、`insertBefore`、`archiveSession`、`insertSessionBefore`（API の調査メモ §3）
- `ctx.remote.directoryPicker`：`capability`、`list`、`createDirectory`（§5）
- 00 の `usePendingInteractions`、`useConnection`、`TextPromptDialog`、`openSheet`、`showSnackbar`

参考の実装：今の画面の `dsh-client-ui-workspace`、`dsh-client-ui-sidebar`、`dsh-client-ui-directory-picker-browse`。

## 状態と例外

- `workspace/invalid-path`、`workspace/name-conflict`、`directory-picker/unreadable`、`directory-picker/exists`、`directory-picker/create-failed` は、内容の分かる文言でスナックバーに出します（例：「同じ名前のワークスペースがあります」）。
- ワークスペースが 1 つもないときは、一覧の代わりに「ワークスペースを追加」への案内を出します。
- 再接続すると一覧は丸ごと差し替わります（§3）。今のワークスペースの id は保ったまま読み直します。

## 偽データ（mock.ts）

- ワークスペース 3 つ、セッション 6 件以上（実行中、完了して未読、返事待ち、サブエージェント由来を 1 件ずつ含む）
- `directoryPicker` の `browse`：`~`、`~/dev`、`~/dev/dsh-webui-m3e` くらいの階層
- `?mock&scenario=empty`：セッションなし、`scenario=no-workspace`：ワークスペースなし

## テスト

`tests/01-home.test.ts` で、次の純粋な処理を確かめます。

- ワークスペースの `sessionIds` と一覧の `byId` から、表示する行を作る処理（並び順、アーカイブ済みとサブエージェントを除く、存在しない id を飛ばす）
- 最終更新日時の表示の文字（今日、昨日以前）
- モデル名からアイコンを選ぶ処理と、頭文字の取り出し
- ホームのパスを `~` に縮める処理

## 完了条件

- `?mock` で、一覧の表示、ドロワーでの切り替え、フォルダの選択からの追加、⋮ メニューの 4 項目、長押しとスワイプでのアーカイブ、セッションがないときの表示が動きます。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。

## 未確認のこと

- `directoryPicker.capability()` が `native` を返すとき（DSH を Mac で動かし、Mac のブラウザで開くとき）に、`list` も使えるかは未確認です。使えなければ、iPhone からはワークスペースを追加できない旨を出します。
- アーカイブを戻す API はありません（DSH 0.1.5-rc.1）。戻す手段は作りません。
- 一覧に `origin: 'subagent'` の行が実際に来るかは未確認です。

## 実装メモ

### 2026-09-25：01-home の実装

#### 実装したもの

- 一覧は `useDsh().workspaces.list` と `sessions.list` を購読し、選択したワークスペースの `sessionIds` 順に表示する。アーカイブ済み・存在しない ID を除き、サブエージェントは既定で隠す。選択中 ID と表示設定は端末の `localStorage` に保存する。保存不能時もメモリ上で操作でき、再接続で一覧が差し替わっても ID が存在する限り選択を保つ。
- モデルの `lastUsed`、作業フォルダ名、更新日時、返事待ち・実行中・未読完了の印を表示する。今日の日時は `HH:mm`、それ以外は `YYYY/MM/DD`。モデルが不明なら頭文字、値がなければ汎用アイコン。DeepSeek 用の簡略化した魚と汎用の SVG を担当フォルダに同梱した。外部アセットは使わない。
- ドロワーは `M3eDrawerContainer` の `startMode="over"` と `M3eNavMenu` を使う。左から開き、暗い背景のタップ・左スワイプ・閉じるボタン・Escape で閉じる。M3E 部品によるフォーカストラップと背景の操作抑止を利用する。ワークスペースの切り替え、長押しから名前変更・移動先を選ぶ並べ替え・確認後の登録解除を実装した。
- 一覧のメニューに並べ替え・選択アーカイブ・名前変更・サブエージェント表示スイッチを実装した。並べ替えはつまみの Pointer Events により、確定時に `insertSessionBefore` を 1 回呼ぶ。キーボードの上下キーでも移動できる。アーカイブは長押しシート、横スワイプ、複数選択に対応し、逐次適用する。途中で失敗した場合は成功件数を通知し、未処理の選択を残す。長押し・スワイプ後のクリックによる意図しない画面遷移を抑止する。
- 行末にも操作ボタンを置き、長押しが難しい場合に同じシートへ到達できるようにした。ドロワーでは選択・追加の Enter / Space と操作の Shift+F10 を扱う。
- 下への引っぱりで `sessions.refresh()` を呼ぶ。空一覧、ワークスペースなし、読み込み中のスケルトン、接続切れ時の FAB 無効化を実装した。下部余白と安全領域は土台の枠を利用する。
- フォルダ選択は × で `back()`、パンくずとフォルダで同じ画面内を移動し、隠しフォルダを除外する。作成後はその親の一覧を再取得する。「ここを追加」は返ったワークスペースを選択して一覧へ戻る。古い一覧応答を AbortSignal で破棄し、読み込み中や接続切れ時には追加を無効にする。
- 仮の部品の入口 `HomeScreen()` と `routes` の形は維持した。他担当の部品、共有型・公開入口、依存は変更していない。

#### 未確認事項を現行 DSH のソースで照合した結果

参照元はインストール済み DSH の `node_modules/@deepseek-ai/` 以下。以下はその配下からの相対パス。読むだけで、DSH の変更・起動・通信は行っていない。

1. **native のとき list は使えない。** `dsh-api-workspace-controller/lib/types/directory-picker.js:98-101,126-132` は `requireCapability('browse', 'list')` で種別を検査し、native なら `directory-picker/unavailable`、`details.capability: 'native'` を返す。フォルダ作成も同じ制約（同113-120）。M3E は native の `pick` を呼ばず、一覧を取得できなければブラウザから追加できない理由を表示する。
2. **`capability()` は公開 RPC ではない。** `dsh-api-workspace-controller/lib/typert.remote-client.d.ts:10-14` の directoryPicker は `list`・`createDirectory`・`pick` のみ。現行 UI は `dsh-client-ui-workspace/lib/client.js:2740-2744` の directoryFlow 登録有無で判定するが、M3E では現行 UI を読み込まない。そこで `list(undefined)` の読み取りプローブを使うと決めた。成功なら追加可能、native の構造化失敗なら説明画面への追加行を残し、それ以外の利用不可では追加行を隠す。ホームが読み取れない場合は画面内で再試行できるよう追加行を残す。
3. **フォルダの型は `home` を持つ。** `dsh-host-directory-picker/lib/types/types.d.ts:10-37` は `{path, home, crumbs, entries, truncated}`、各項目は `{name,path,hidden}`。ホームの短縮はこの `home` とパス境界を照合する。判明しない場合はパスを推測せず、そのまま出す。`list(path, signal?)` と `createDirectory(path,name)` は RemoteResult、作成結果は絶対パス（前記 remote-client.d.ts:11-13）。
4. **ワークスペース操作は土台の facade を使う。** `ctx.remote.workspace` はオブジェクト引数の RPC、一覧購読と位置引数を持つのは `ctx.workspaces`。根拠は `dsh-api-workspace-controller/lib/types/types.d.ts:60-106`、`lib/types/client/service.d.ts:27-69`。00 の公開入口に合わせ、担当内では `useDsh().workspaces` を使うと決めた。
5. **専用のアーカイブ解除 API はない。** 前記 remote-client.d.ts:15-23 と client/service.d.ts:27-69 で確認。解除操作は作っていない。
6. **サブエージェント行が一覧に到達する経路はある。** `dsh-session-query/lib/index.js:94-114` は origin で除外しない。`dsh-api-session-controller/lib/types/list.js:104-124,287-291` が一覧に origin を渡し、`types/client/sessions/service.js:434-454` が byId に引き継ぐ。現行 UI 側が `dsh-client-ui-workspace/lib/client.js:339` で非表示にする。実物での到達確認は段階 3 に残す。
7. モデルは `lastUsed: null | {provider,model,reasoningEffort?}`（`dsh-api-session-controller/lib/types/types.d.ts:76-94`）。状態の印は現行 UI と同じ **返事待ち → 実行中 → 未読完了** の優先順位（`dsh-client-ui-workspace/lib/client.js:780-824`）にした。

現行 sidebar は `primitives.FishLogo` を参照しているが、指定された `dsh-client-ui-primitives/lib` は存在しなかった。ロゴの探索は広げず、同梱 SVG は本実装の簡略アイコンとした。

#### 偽データと検証

- 標準は 3 ワークスペース・7 セッション。主ワークスペースは共通の 2 件と追加 4 件、別ワークスペースは 1 件、残りは空。共通セッションの履歴は変更していない。質問待ちの偽イベントは土台の起動時保留修正前でも受信できるよう 500ms 後に発火する。
- `?mock&scenario=empty`、`no-workspace`、`home-pending`、`native-browse`、`native-unavailable`、`picker-unavailable`、`picker-truncated` を用意した。`native-browse` は将来 list が使える場合の応答を想定した成功例で、現行 DSH が native で browse できることを意味しない。土台の `disconnected` と `reconnecting` も使える。
- フォルダの偽データは `/mock` から `dev/dsh-webui-m3e` をたどれる。隠し属性、作成、重複、読み取り失敗、書き込み失敗、1,000 件での省略をメモリ内で再現する。
- `tests/01-home.test.ts` は表示順・除外、選択維持、日時、モデル、ホームの短縮、保存・復元と保存失敗を検証。`tests/01-directory.test.ts` は公開 RPC のプローブ、native / 利用不可 / 読み取り失敗 / 通信失敗 / 取消を検証。`tests/01-mock.test.ts` はフィクスチャ、質問受信、フォルダ作成と異常系、各シナリオを検証する。
- `pnpm typecheck`：成功。Node 側の型検査でブラウザ用設定フックへ到達する問題は、担当内の純粋な `preferences-store.ts` へ保存処理を分離して解消した。
- `pnpm test`：79 件すべて成功（今回追加 24 件）。
- `pnpm build`：成功。Vite の既存の大きいチャンクに関する警告は残る。
- **ブラウザで操作した画面はなし。** 今回のオーケストレーター指示に従い、開発サーバーの起動・HTTP 確認・ブラウザ操作は実施していない。上記シナリオでの一覧、ドロワー、フォルダ選択、メニュー、長押し・スワイプ・ドラッグ、空表示の目視とスマートフォン実機操作はオーケストレーターに引き継ぐ。Node テストを画面操作の成功とは扱わない。

#### 担当外の変更・停止事項

- 担当外で必要になった変更：なし。
- 拒否された操作：なし。パッチの構文検証で同じファイルの削除・追加を同時指定できないエラーが 1 回出たため、通常の更新パッチに修正した。権限拒否ではなく、別経路による回避はしていない。
- `main`、他 worktree、DSH 本体、共有ファイルは変更せず、merge / rebase も行っていない。土台の後続修正の取り込みはオーケストレーターに委ねる。
