# DSH との互換性

この文書は、M3E の画面が DSH（DeepSeek Harness）のどこに依存しているか、どの版で何を確かめたか、版が変わったときに何を直すかをまとめたものです。2026-10-03 に、main `95ea9a0`（0.0.7）を起点として調べました。

対応する版は [src/shared/dsh-compat.ts](../src/shared/dsh-compat.ts) の 1 か所で決めています。

## 結論

- **動く版**：DSH 0.1.5-rc.3 と 0.1.5-rc.2。実物の DSH（偽の LLM）で、下の「実 DSH の統合試験」がすべて通りました。
- **動かない版**：0.1.6-alpha.2、0.1.7-rc.2、0.2.0-rc.2。どれも起動の段階で止まります。npm の `latest` は 0.2.0-rc.2 なので、**今 DSH を新しく入れた人は M3E を使えません**。
- 新しい版に合わせるには、下の「新しい版で壊れる境界」の 1〜4 をすべて直す必要があります。1 つずつの小さな修正では足りないことを、実物で確かめました。依存の版を上げる作業（`package.json` の変更）を含むので、今回は行っていません。

## 版ごとの確認結果

すべて、このリポジトリの `e2e-dsh/` で、本番から切り離した DSH を起動して確かめました。LLM は偽物です（下の「実 DSH の統合試験」）。

| DSH の版 | 結果 | 止まる場所 |
|---|---|---|
| 0.1.5-rc.2 | 15 項目すべて通過※ | ― |
| 0.1.5-rc.3 | 15 項目すべて通過※（iframe の項目を足す前の 14 項目を 3 回続けて実行し、毎回通過） | ― |
| 0.1.6-alpha.2 | 起動で停止 | `sessions.open`・`openSubagent`・`clear` がない（境界 3） |
| 0.1.7-rc.2 | 起動で停止 | プラグインの URL が相対になり、`/m3e/plugins/…` が 404（境界 1） |
| 0.2.0-rc.2 | 起動で停止 | 0.1.7-rc.2 と同じ |

※ 15 項目のうち 1 項目は、仕様との既知の差（下の「仕様と実物の差」）が残っていることを確かめる試験です。Playwright は「失敗するはずの試験が失敗した」ことを通過として数えます。正しく動いた経路は 14 項目です。

起動で止まったときは、「この DSH の版に M3E の画面が対応していない可能性があります」という案内と「今の画面に戻す」リンクを出します（0.1.6-alpha.2 と 0.2.0-rc.2 の実物で表示を確かめました）。以前は「ページを読み直してください」とだけ出ていて、読み直しても直らないうえに、今の画面へ戻る方法も出ていませんでした。

## 依存の境界

### 一覧

「壊れやすさ」は、DSH の版が変わったときに壊れる見込みです。「高」は実際に新しい版で壊れたもの、「中」は DSH の内部の形に頼っているもの、「低」は DSH が利用者向けに出している入口だけを使うものです。

| 区分 | 境界 | このリポジトリの場所 | 壊れやすさ |
|---|---|---|---|
| 起動 | `__DSH_BOOT__` の起動グラフ、`__ModuleLoader__.create()`、プラグインの URL の形 | `web/src/dsh/boot.ts`、`boot-graph.ts` | 高（0.1.7 で URL が相対に変わった） |
| 起動 | 通信用の 8 プラグインの id（`TRANSPORT_PLUGINS`） | `web/src/dsh/boot.ts` | 中（0.2.0 まで同じ id が残っている） |
| 共有ライブラリ | `@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-loader`、`@deepseek-ai/dsh-client-store` の同梱 | `package.json`、`src/shared/dsh-compat.ts`、`web/src/dsh/boot.ts` の `STATIC_MODULES` | 高（版ごとに変わる。0.2.0 は cordis 4.0.4、client-store 0.2.0-rc.2） |
| 内部の形 | cordis のプラグインが動いている状態の値（`FiberState.ACTIVE = 2`）、`loader.internal` への代入 | `web/src/dsh/boot.ts` | 中（cordis の内部） |
| controller | `ctx.sessions`、`ctx.workspaces`、`ctx.connection` のメソッドと、状態の形（`SessionListState`、`SessionSnapshot` など） | `web/src/dsh/services.ts`（形の書き写し）、`web/src/dsh/contract.ts`（起動時の確認） | 高（0.1.6 で `open` などが消えた） |
| RPC | `ctx.remote` の名前空間（`commands`、`fileReferences`、`session`、`settings`、`credentials`、`llm`、`directoryPicker`、`goals`、`workspaceFiles`） | 各機能の 1 ファイルずつ（`composer/api.ts`、`home/directory.ts`、`session-tools/files.ts`・`operations.ts`、`settings/providers.ts`・`store.ts`） | 中（どれも、無いときは機能を止めるだけで、画面全体は落ちない） |
| 通知 | `ctx.remote.$on` の放送（`commands/change`、`settings/document-updated` など 5 種） | `web/src/dsh/remote-events.ts` | 中 |
| 通知 | 返事を返す通知（`approval/request`、`user-questions/request`） | `web/src/dsh/interactions-store.ts` | 中 |
| 記録の形 | 会話の記録の種類（`user/message`、`assistant/message`、`tool/call`、`turn/start` など）と中身の形 | `features/chat/model.ts`、`features/trace/model.ts` | 中（2 か所で別々に読んでいる） |
| 記録の形 | 投影の名前（`plan`、`permissions`、`modelSelection`、`goal`、`tokenUsage`、`contextPressure`） | 各機能 | 中 |
| 記録の形 | 子の会話のカタログ行（`kind: 'child'`、`mode`） | `web/src/dsh/session-navigation.ts`（遷移用）、`features/session-tools/presentation.ts`（表示用） | 中 |
| エラーの形 | `RemoteResult`、エラーコード（`session/not-found`、`gateway/internal` など） | `web/src/dsh/remote-result.ts`、`features/composer/delivery-status.ts` | 中 |
| Host | `ctx.webServer.register`・`renderIndex`・`tapIndex`、`ctx.connection.authorizeIndex` | `src/host/index.ts`、`src/host/services.d.ts` | 低（0.2.0 でも動いた） |
| Host | 今の画面の preload の書き方（`<link rel="preload" href="/plugins/…">`） | `src/host/index.ts` の `stripApplicationPreloads` | 高（0.1.7 から相対 URL になり、取り除けない） |
| 今の画面 | 設定の一般の欄（`settings.general.item`）への行の追加、`package.json` の `dsh.client.inject` | `src/client/index.tsx`、`package.json` | 中 |
| 今の画面 | Cookie `dsh-webui` と、`/` と `/index.html` だけの切り替え | `src/shared/ui-choice.ts` | 低（M3E 側で決めたもの） |
| LLM | なし。M3E は LLM に直接つながない | ― | ― |

「public API」と呼べるものは、Host 側の `webServer` と `connection.authorizeIndex`、ブラウザ側の `ctx.remote` の RPC と通知くらいです。controller の形、起動グラフ、cordis の内部、記録の形は、DSH が外向けに約束しているものではありません。今の画面の実装を読んで書き写したもので、版が変わると予告なく変わり得ます。

### 新しい版で壊れる境界

0.1.7-rc.2 で、境界を 1 つずつ外しながら、どこまで進むかを実物で確かめました。試した修正はすべて元に戻してあり、コミットしていません。

1. **プラグインの URL が相対になった**（0.1.7 から）。起動グラフと `<script src>` が `plugins/??…` になり、`/m3e/` の下では `/m3e/plugins/…` を読みに行って 404 になります。`client-modules: HTML did not preload …` で止まります。試しに Host 側で `/plugins/` に書き換えると、起動グラフの読み込みは通りました。
2. **通信の宛先が `document.baseURI` 基準になった**（0.1.7 から）。1 を直すと、次は `ws://…/m3e/api/remote.mux` に接続しようとして失敗します。0.1.7 の `dsh-api-gateway` は `__DSH_TRANSPORT__.streamBaseUrl ?? document.baseURI` を使い、画像の送信も `document.baseURI` を使います。試しに index に `<base href="/">` を入れると、接続・一覧・ワークスペースの追加まで通りました。ただし M3E のルーターは `pushState(…, '#' + hash)` を使っているので、`<base>` を入れると URL が `/#/…` に変わります。ルーターも合わせて直す必要があります。
3. **セッションの開き方が変わった**（0.1.6-alpha.2 から）。`sessions.open`、`openSubagent`、`clear`（0.1.7-rc.2 と 0.2.0-rc.2 では `setSubagentCatalogOpen` と `refreshSubagents` も）がなくなり、参照を数える `retain` / `using` に変わりました。2 まで直した 0.1.7-rc.2 では、会話を開いたところで `Cannot read properties of undefined (reading 'session-…')` が出て落ちました。M3E では `web/src/dsh/conversation-selection.ts`、`session-navigation.ts`、`features/session-tools/SubagentsScreen.tsx`、`features/home/session-navigation.ts`、`features/inbox/session-navigation.ts` が使っています。
4. **共有ライブラリの版**。0.2.0-rc.2 は cordis 4.0.4、cordis-plugin-loader 1.0.5、dsh-client-store 0.2.0-rc.2 を使います。M3E は 4.0.2 / 1.0.3 / 0.1.5-rc.3 を同梱して渡すので、版を合わせないと、読み込めても中で食い違う恐れがあります。

1 と 2 は Host 側か起動処理だけで直せる見込みです。3 は会話を開く処理の作り直しで、4 は依存の更新です。4 つを合わせて、別の作業として行うのがよいと考えます。

### 仕様と実物の差

- **接続が切れたときのバナーが出ない**。`docs/ui-spec.md` の「接続が切れたとき」では、再接続に失敗したら進捗バーからバナー（「DSH との接続が切れました」、何分前のデータか、「再接続」ボタン）に切り替えることになっています。実物の DSH 0.1.5-rc.3 では、Host を止めても接続の状態が `connecting` のまま再試行を続けるので、90 秒待ってもバナーに切り替わりませんでした。細い進捗バーが出続けるだけで、古いデータを見ていることも、手で再接続する方法も分かりません。Host が戻れば、約 1 秒で自動で再接続します。直すには、一定時間 `connecting` が続いたらバナーを出すなどの画面の決まりが必要です。仕様を決める必要があるので直していません。統合試験では「既知の差」として、失敗することを確かめる試験（`test.fail`）にしてあります。
- 偽データの `scenario=disconnected` は `disconnected` の状態を直接作っています。実物で `disconnected` になる条件（認証の失効など）は確かめていません。

## 今回変えたこと

- **版の決まりを 1 か所に**：`src/shared/dsh-compat.ts` に、対応する DSH の版と、同梱ライブラリの固定版を置きました。`tests/dsh-compat.test.ts` が `package.json` と食い違っていないかを確かめます。
- **起動時の確認**：`web/src/dsh/contract.ts` に、M3E が呼ぶ controller のメソッドを並べ、起動の直後に 1 回だけ揃っているかを確かめます。足りなければ、起動の失敗として版の案内を出します。偽データの ctx がこの一覧を満たしていることも単体試験で確かめます。
- **起動に失敗したときの案内**：`web/src/main.tsx`。失敗の理由を分け、起動の決まりで止まったときだけ「版が合っていない可能性」を出します。通信の一時的な失敗まで版のせいにはしません。Host が描いたページなら、どちらの場合も「今の画面に戻す」（`/?ui=classic`）を出します。
- **放送の購読を 1 か所に**：`ctx.remote.$on` を機能ごとに型を書き換えて呼んでいた 5 か所を、`web/src/dsh/remote-events.ts` の `onRemoteEvent` に寄せました。イベントの名前と中身の形はこのファイルだけに書きます。動きは前と同じです（`$on` がない Host では何もしない）。
- **子の会話のカタログ行の読み取りを 1 か所に**：同じ読み取りが `web/src/dsh/session-navigation.ts`、`features/home/session-navigation.ts`、`features/inbox/session-navigation.ts` の 3 か所にありました。`subagentCatalogAddress` に寄せ、残りの 2 か所はそれを呼ぶだけにしました。開く手順そのものは変えていません。
- **実 DSH の統合試験**：`e2e-dsh/`（下の節）。
- `e2e/playwright.config.ts` と `e2e-dsh/playwright.config.ts` は、環境変数 `M3E_CHROMIUM_PATH` でブラウザの場所を指定できます。

## 変えなかったことと理由

- **新しい DSH への対応**：上の 1〜4 が必要で、依存の更新（`package.json`）とセッションの開き方の作り直しを含みます。大きな書き直しなので、必要性と範囲を確かめたうえで、別の作業にしました。
- **各機能の RPC の型をまとめて `web/src/dsh/` に移すこと**：今は機能ごとに 1 ファイルにまとまっていて、RPC が無い Host では機能だけを止める作りです。移しても直す場所の数は変わらず、各機能の設計書の担当範囲を大きく動かすことになるので、見送りました。
- **会話の記録を読む処理の統一**（`chat/model.ts` と `trace/model.ts`）：表示の目的が違い、統一には両方の作り直しが要ります。
- **接続が切れたときのバナー**：上の「仕様と実物の差」のとおり、画面の決まりを先に決める必要があります。
- `src/host/services.d.ts` の「DSH 0.1.5-rc.2 から書き写した」という注記：0.1.5-rc.3 と 0.2.0-rc.2 の実物で同じ入口が動くことは確かめましたが、型の定義を全部照らし合わせてはいないので、注記はそのままにしました。

## 実 DSH の統合試験

`e2e-dsh/` は、実物の DSH の Host を起動し、M3E のプラグインを入れて、ブラウザで操作する試験です。LLM だけは偽物で、外のネットワークにはつなぎません。

- `fake-llm.ts`：DeepSeek の chat completions の形で答える偽の LLM です。DSH には `DEEPSEEK_BASE_URL` で向けます。プロンプトに入れた印（`[[slow]]`、`[[medium]]`、`[[approval]]`、`[[question]]`）で、遅い返答、bash の呼び出し（承認が要る）、`ask_user_question` を返します。
- `dsh-host.ts`：DSH を `tmp/dsh-integration/` に入れ（初回だけ npm から入れます）、`pnpm build` と `pnpm pack` で作ったプラグインを、毎回新しい `DSH_HOME` と `HOME` に入れて、`127.0.0.1` だけで起動します。利用者の DSH と設定には触れません。
- 実行方法：

```bash
pnpm exec playwright test -c e2e-dsh/playwright.config.ts
# 別の版を試す
M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts
```

環境変数は `M3E_DSH_VERSION`（試す版）、`M3E_DSH_DIR`（入れ済みの DSH を使う）、`M3E_SKIP_BUILD=1`（ビルドを省く）、`M3E_CHROMIUM_PATH`（ブラウザの場所）です。`pnpm test` には含めていません。DSH を npm から入れるためと、1 回に 1〜2 分かかるためです。

### 実 DSH で確かめた経路（DSH 0.1.5-rc.3）

| 経路 | 試験で確かめたこと |
|---|---|
| 接続 | `/m3e/` が起動して一覧が出る。index に埋め込み拒否のヘッダーが付く |
| 埋め込みの拒否 | 同じ Host のページに iframe で入れても、ブラウザが表示を拒否する |
| ワークスペース | フォルダの選択から追加できる |
| セッションの作成と送信 | 最初の送信でセッションができ、LLM に本文が届き、返答が出る |
| セッションの取得 | 読み込み直しで履歴が戻り、一覧に題名が出る |
| 逐次表示 | 返答が少しずつ出る（途中の節が見えて、最後の節はまだ無い） |
| 停止 | 停止ボタンで実行が止まり、LLM への接続が切られ、表示がそれ以上増えない |
| 承認 | 許可すると bash が動き、結果が LLM に返る。拒否すると実行されない |
| 質問 | 選んだ答えが LLM に返る |
| 順番待ち | 実行中の送信が順番待ちに入り、前の返答が終わってから LLM に届く |
| 割り込み | 実行中に割り込みで送った本文が、同じ会話の LLM に届く |
| 画像 | 添付した画像が `image_url` として LLM に届く |
| 会話の切り替え | 切り替えシートで検索し、別のセッションへ移る |
| 再接続 | Host を止めると再接続中になり送信できない。Host が戻ると自動で戻り、送信できる |
| 既知の差 | Host が止まったままでもバナーに切り替わらない（失敗することを確かめる試験） |

ここでの「通過」は、実物の Host と通信の部品、M3E の画面がこの版で正しくつながることだけを意味します。本物の LLM の返答の形（長い考えた内容、並んだツールの呼び出し、途中のエラー）、Safari と iPhone、リバースプロキシ、長く使った `DSH_HOME` での動きは、ここでは確かめていません。

### 偽データでしか確かめていないもの

次は `?mock` の偽データと単体試験だけで確かめています。実物の DSH では未確認です。

- 子の会話（サブエージェント）への送信、一覧からの子の会話の開き方、サブエージェントの画面
- 会話の分岐（fork）、題名の変更、アーカイブ、ワークスペースの名前の変更と並べ替え
- 検索の結果と抜粋
- 対応待ちの件数と「完了」の消え方
- 設定の保存、API キーの登録、モデルの一覧と切り替え、権限の切り替え、プラン
- 統計、ファイル、ジョブ、ゴールの画面
- 応答が失われたときの「送信結果が不明です」（偽データでは応答の消失を作れますが、実物では作っていません）
- 承認と質問に、対応待ちの画面やトレースの画面から答えること（統合試験は会話の画面からだけ）
- 再接続したときに、生成中の応答が途中から続くこと（試験では生成中に止めていない）

### 人が実機で確かめるべきもの

- 本番の DSH の版（`dsh --version`）が 0.1.5-rc.3 であること。違う版なら、上の表のとおり動かない見込みです。
- iPhone の Safari とホーム画面の Web アプリで、上の経路を一通り（特に、キーボード、シート、再接続）
- リバースプロキシや TLS を挟む構成で、`/m3e/`、`/plugins/…`、`/api/remote.mux` が通ること。埋め込み拒否のヘッダーが消されないこと
- 本物の LLM での、長い返答、考えた内容、複数のツール、サブエージェント
- 長く使った本番の `DSH_HOME`（たくさんのセッション、古い記録）での一覧と履歴の読み込み

## 版を上げるときの手順

1. `M3E_DSH_VERSION=<新しい版>` で `e2e-dsh` を流し、どこで止まるかを見ます。
2. 新しい版の `node_modules/@deepseek-ai/` で、cordis・cordis-plugin-loader・dsh-client-store の版を調べ、`package.json` と `src/shared/dsh-compat.ts` を同時に直します（`pnpm test` が食い違いを止めます）。
3. 新しい版の `dsh-api-session-controller/lib/types/client/contract/` と M3E の `web/src/dsh/services.ts` を照らし合わせ、`web/src/dsh/contract.ts` の一覧を直します。
4. 上の「依存の境界」の表を上から順に確かめます。
5. `pnpm typecheck`、`pnpm test`、`pnpm build`、偽データの e2e、`e2e-dsh` がすべて通ってから、README の「必要なもの」とこの文書の表を更新します。
