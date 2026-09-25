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

### 2026-09-25：チャットタブの実装

#### 実装したこと

- `ChatView({ sessionId })` の公開入口を維持し、本文のスクロール領域を実装した。変更は `web/src/features/chat/`、`tests/02-*.test.ts`、本書の実装メモだけ。`feat/02-chat` で作業し、main、共有の土台、依存、DSH 本体は変更していない。merge / rebase もしていない。
- `model.ts` に records / stream / pendingSubmissions から表示行を作る純粋関数を分離した。4 種類の表示イベントに加え、設計で例外として指定された `command/done` を表示する。`command/run` と `tool/call` は名前・時刻の対応付けにだけ使用し、独立した行にしない。未知のイベント、ignorable、assistant/attempt は表示しない。
- 自分の吹き出し、AI の Markdown、開閉する「考えた内容」、ツール行、システム文、コマンド結果、送信前表示、初回応答待ち、処理エラーのカードを実装した。ツール結果だけが読み込み範囲にある場合も結果を残し、名前が分からなければ「ツール」とする。
- stream は block index ごとに復元し、並行する reasoning / text / tool-call を別々に追記する。block-end はそのブロックの確定内容で置き換える。元の index を描画キーに含め、後から小さい index のブロックが現れても別の行の状態を流用しない。復元済み content と chunks を二重に足さない。
- 初回は末尾を表示し、上向きのスクロール操作で追従を止める。「最新へ」で再開し、自分で末尾へ戻った場合も再開する。ResizeObserver で本文と表示領域を監視し、画像の読込・高さ変更・非表示タブからの復帰を扱う。古い履歴は上端またはボタンから読み、表示中の行と画面内の位置を保存して復元する。画像が後から届く場合もその行を基準に保つ。
- ツール詳細は引数の整形、結果、既知の所要時間、失敗表示を出す。開いたまま結果が届けば更新する。入れ子全体のテキストを合計 200 行で切り、「続きを表示」で展開する。画像は添付の窓口から読み、それ以外の結果ブロックは種類を表示する。
- 添付画像は `readAttachment` の bytes / mediaType から Blob URL を作り、不要時に解放する。全画面の画像は独立して読み込むため、元の詳細シートを閉じても参照先が失効しない。ファイルは名前とサイズを表示する。
- 本文の 550ms の長押し、コンテキストメニュー、操作ボタンから「コピー」「ここから分岐」を開く。10px を超える移動や pointer cancel は長押しを取り消す。分岐には元イベントの seq を渡し、成功後に新しい会話へ移る。クリップボード・分岐・履歴読込の失敗は日本語で通知する。

#### 未確認事項を既存 DSH で照合した結果

以下はインストール済み `@deepseek-ai/dsh/node_modules/@deepseek-ai/` 以下を読み取りだけで調べた結果。DSH は起動していない。

- **所要時間**：`dsh-client-ui-chat/lib/client.js:3883,6290-6322` は同 callId の tool/call と tool/result の時刻差を使う。`dsh-client-ui-conversation/lib/types/client/contract/records.d.ts:154-172` も callTime と meta を別に持つ。本実装も `max(0, result.time - call.time)` とし、開始イベントが読み込み範囲になければ不明とする。assistant/message の時刻から推測せず、実行中の時間も数えない。
- **meta**：`dsh-client-ui-tool/lib/client.js:134-149,283-307,370-400` では read の範囲情報、編集の diffs、検索の truncated / total / shape など、ツールごとに形が異なる。共通の duration として使える根拠はなかった。今回の汎用表示では meta を解釈しない。
- **イベントの形**：`dsh-api-session-controller/lib/typert.host.js:1717,2021,2037-2041` と `dsh-client-ui-chat/lib/client.js:4266-4289,6304-6322` で確認。user/message は data 自体、assistant/system は data.message がメッセージ。tool/result は data.message.content 内の tool-result ブロックに toolCallId / content / isError が入り、error / meta は data の直下にある。isError と error の双方で失敗と判定する。
- **複数ブロック**：`dsh-client-ui-chat/lib/client.js:4395-4447` も chunk.index ごとに蓄積し、block-end で確定内容へ置き換える。
- **コマンド名**：同 `client.js:5715-5744` の command/done には name がなく、commandId で command/run と対応付ける。名前が読み込み範囲にない場合は架空の名前を付けず「コマンドを実行しました」とする。
- **添付**：`dsh-api-session-controller/lib/types/client/contract/session.d.ts:84-92`、同 `sessions/session.js:235-244`、`dsh-client-ui-conversation/lib/client.js:2389-2412` で readAttachment の戻り値と Blob URL の解放を確認した。
- **分岐**：`dsh-client-ui-chat/lib/client.js:8338-8345` はメッセージの seq を atSeq に渡す。ただし `dsh-api-session-controller/lib/types/commands.js:184-227` の実処理は、その seq 以上の最初の turn/end を境界にする。未完了ターンは session/fork-unavailable。画面側で成功を仮定せず、失敗を表示する。共通 mock の分岐は指定 seq までを複製するため、この境界の違いは実接続での確認が必要。

#### 自分で決めたこと・土台との境界

- 送信前表示は placement が transcript のものを会話末尾に追加する。queued / steering の未確定表示は入力欄側の領域として重複させない。生成途中には確定 seq がないため分岐を無効にし、コピーはできるようにした。
- 古い履歴の自動読込に加え、ボタンでも読めるようにした。画面内に収まる短いページでも次の履歴に進める。reasoning / command を展開したときも追従を止め、開いた内容を読み続けられるようにした。
- **「もう一度開く」は未実装**。00 の実装メモと現在の ConversationScreen は、同じ ID の sessions.open では再読込できる保証がないため、読込エラー時に ChatView を描かず「一覧に戻る」を出す。ChatView 単独のエラー表示もこれに合わせた。仕様通りの再試行を実現するには、00 側で有効な再試行 API を確認し、共通画面の導線を変更する必要がある。担当外のため変更せず、この項目だけ保留した。
- タブ切替時に ChatView を描いたまま隠す変更は、オーケストレーターが 00 から取り込む予定との指示に従った。本担当では共有画面を変更していない。取込前の土台ではタブ切替がアンマウントになるため、展開状態・スクロール状態の保持はその変更の取込後に確認する。
- 拒否された操作はなし。最初のパッチの形式エラーと実装途中の型エラーは修正済み。保護フック・権限・禁止操作の回避はしていない。

#### 偽データと検証

- 共通の「README の見直し」は変更せず、その履歴を使うテストを追加した。「チャットの確認」ワークスペースに「長い会話」（300 records、75 ターン、既定の窓から 2 回の loadOlder）と「添付と長い結果」（ファイル、システム文、210 行の結果、入れ子、画像）を追加した。
- 最終 `pnpm typecheck`：成功。
- 最終 `pnpm test`：75 件すべて成功（本担当の追加 20 件）。表示行の絞込み、callId 対応、引数概要、並行ブロック、block-end、再接続の置換、送信前表示、スクロールの距離判定と追加高さの計算、200 行制限、共有履歴の保持、2 回のページング、エラーと生成シナリオを確認した。React の描画テストは追加していない。
- 最終 `pnpm build`：成功。既存の Vite chunk サイズ警告は残る（本番 JavaScript 約 1,063 KB、gzip 約 268 KB）。`git diff --check` も成功。
- **ブラウザーで操作した画面はなし**。今回の指示に従い、開発サーバー、HTTP 確認、DSH を起動せず、ブラウザー確認はオーケストレーターに残した。以下は起動済み環境で使う確認用パスであり、この実行ではアクセスしていない。

| 確認用パス | 操作・期待すること |
|---|---|
| `/m3e/?mock#/s/readme-review` | reasoning の開閉、成功・失敗のツール詳細、画像拡大、コマンド結果、本文長押し・コピー・分岐 |
| `/m3e/?mock&scenario=streaming#/s/approval-sheet` | 末尾追従、上へ移動して停止、「最新へ」で復帰、生成が確定しても本文が重複しない |
| `/m3e/?mock#/s/chat-long` | 上端から 2 回の古い履歴の追加と、表示中の行の位置の保持 |
| `/m3e/?mock#/s/chat-samples` | ファイル・システム文、ツール結果 200 行からの展開、結果内の画像拡大 |
| `/m3e/?mock&scenario=chat-error#/s/chat-error` | 会話末尾の「AI の処理が止まりました」 |
| `/m3e/?mock&scenario=open-error#/s/chat-open-error` | 共通画面の読込エラーと「一覧に戻る」 |

#### 担当外で必要な対応

- 新たな担当外のソース変更は行っていない。再試行導線は上記の 00 側の API 確認・共通画面対応が必要で、保留した。タブ保持の土台変更は予定されている取込待ち。
- 実接続での添付・分岐・再接続、390px 幅の表示、長押し、実際のスクロール位置、クリップボード、シート操作は未確認。Node の純粋関数テストだけでこれらの操作を成功扱いしていない。
