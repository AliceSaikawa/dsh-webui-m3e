# 02 チャットタブ

## 目的

会話の中身を読みやすく出します。AI の返事を生成中から少しずつ出し、ツールの呼び出しや考えた内容は畳んで、会話の流れを追いやすくします。

## 担当する画面

| Canvas の画面 id | 名前 |
|---|---|
| `h0vanepn` | 入力画面（待機中）のうち、本文の部分 |
| `running` | 会話（AI 実行中）のうち、本文の部分 |
| `chatDetail` | チャット（メッセージの種類） |
| `toolDetail` | ツール呼び出しの詳細 |
| `messageActions` | メッセージの操作 |
| `convError` | 会話のエラー |

上のバー、タブ、入力欄は担当しません（00 と 03）。仕様は `docs/ui-spec.md` の「会話画面」「チャットタブ」の節です。

## 担当するファイル

- `web/src/features/chat/` の全部（`ChatView.tsx` は 00 の仮の部品を置き換える）
- `tests/02-*.test.ts`
- この設計書の「実装メモ」

## 入口

`ChatView({ sessionId })`。00 の会話画面がタブ「チャット」のときに描きます。高さは会話画面が決め、`ChatView` は中身をスクロールさせます。

## 画面の中身

### 並べるもの

`useSession(sessionId)` の `records` と `stream` から、表示する項目の列を作ります。画面に出すのは `user/message`、`assistant/message`、`tool/result`、`system/message` の 4 種類だけです（`SurfaceEventType`）。`ignorable: true` のイベントと、知らない種類は読み飛ばします。

| 元のもの | 出し方 |
|---|---|
| `user/message` の `text` | 右寄せの吹き出し（`primaryContainer` の色） |
| `user/message` の `image` | 吹き出しの下に小さな画像。`readAttachment` で読み、タップで全画面に広げる |
| `user/message` の `file` | ファイル名と大きさのチップ |
| `assistant/message` の `reasoning` | 「考えた内容」の行。ふだんは畳み、タップで開く。生成中は「考えています…」 |
| `assistant/message` の `text` | 左寄せ、背景なしの本文。00 の `Markdown` 部品で描く |
| `assistant/message` の `tool-call` と、対応する `tool/result` | 1 本の行にまとめる（下の「ツールの行」） |
| `system/message` | 中央寄せの小さな文字 |
| `command/done` | 「/名前 を実行しました」の小さな行。結果の文（`text`）があれば、タップで開く |
| `pendingSubmissions` | 送ったばかりの自分のメッセージを、薄い色で先に出す（`previewUrl` で画像も） |
| `lastAgentError` | 会話の最後に「AI の処理が止まりました」のカード |

`assistant/attempt`（画面に残らなかった試行）は出しません。

### ツールの行

- 1 行目：ツール名。2 行目：引数の主な値と所要時間。失敗（`tool/result` の `isError` か `error`）なら「失敗」と添えて、色で分かるようにします。
- 引数の主な値：`arguments`（生の JSON 文字列）を読み、`command`、`path`、`file_path`、`pattern`、`query`、`url` のうち最初にあるものを 1 つ出します。JSON が壊れているか、どれもなければツール名だけにします。
- 結果がまだ来ていないツールは「実行中」の印を出します。経過時間は数えません。
- タップで「ツール呼び出しの詳細」のシートを開きます。中身は、引数（JSON を整形して等幅で）、結果、所要時間です。結果は入れ子の `ContentBlock[]` なので、`text` は本文、`image` は画像、それ以外は種類名だけを出します。長い結果は 200 行で切り、「続きを表示」で開きます。

### スクロール

- 開いたときは最新の位置（一番下）から出します。
- 生成中は、ユーザーが一番下にいる間だけ末尾を追いかけます。上にスクロールしたら追いかけるのをやめ、右下に「最新へ」のボタンを出します。
- 一番上まで来たら、`hasMore` が true のとき `loadOlder()` を呼びます。読み込み中（`loadingOlder`）は上に進捗の印を出し、読み込んだあとも見ていた位置を保ちます。

### メッセージの操作

- 吹き出しか本文を長押しすると、シートを開きます。
- 「コピー」：その項目の文字をクリップボードへ。
- 「ここから分岐」：`sessions.fork({ sessionId, atSeq })` で新しいセッションを作り、`#/s/<新しい id>` へ移ります。`atSeq` はその項目のイベントの `seq` です。

### 状態と例外

- `openState` が `loading` のとき：本文の中央に読み込み中の印。
- `openState` が `error` のとき：中央に理由（`openError`）と「もう一度開く」ボタン。
- `awaitingFirstTurn` のとき（送ったが AI がまだ応えていない）：末尾に読み込み中の印。
- 再接続したとき：生成中の応答は、00 の `session.ts` が途中から続けます。この画面は `stream` を描き直すだけです。

## 使う DSH の窓口

- 00 の `useSession(sessionId)`：`records`、`stream`、`snapshot`、`face.loadOlder()`、`face.readAttachment()`
- `sessions.fork()`
- 00 の `openSheet`、`showSnackbar`、`navigate`

参考の実装：今の画面の `dsh-client-ui-chat`、`dsh-client-ui-conversation`、`dsh-client-ui-tool`、`dsh-client-ui-renderer`。

## 偽データ（mock.ts）

- 「README の見直し」の履歴（`chatDetail` の中身）は 00 が用意済みです。この機能では書き換えません。
- `?mock&scenario=streaming`：「承認シートの実装」に、`kit.streamAssistant` で返事を少しずつ流します。
- `?mock&scenario=chat-error`：`lastAgentError` があるセッションを足します。`scenario=open-error`：開けないセッションを足します。
- 古い履歴を `loadOlder` で 2 回読める長い会話のセッション「長い会話」を足します。

## テスト

`tests/02-chat.test.ts` で、次の純粋な処理を確かめます。

- `records` から表示する項目の列を作る処理（4 種類だけを残す、`ignorable` を飛ばす、`tool-call` と `tool/result` を `callId` でまとめる、`pendingSubmissions` を末尾に足す）
- 引数の JSON から主な値を取り出す処理（壊れた JSON、該当なし、長すぎる値の切り詰め）
- `stream` の途中の中身（複数のブロックが同時に進む、`block-end` で確定する）から、今の表示を作る処理

## 完了条件

- `?mock` で、`chatDetail` の中身がすべて出て、ツールの詳細とメッセージの操作のシートが開き、分岐で新しい会話に移れます。
- 偽の生成で、末尾の追いかけと「最新へ」ボタンが動きます。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。

## 未確認のこと

- `tool/result` の `meta` の中身と、所要時間の出どころ（イベントの `time` の差で出すか）は未確認です。

## 実装メモ

（実装した担当が書き足します）
