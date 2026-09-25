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

（実装した担当が書き足します）
