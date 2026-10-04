# DSH との互換性

**対応する版は DSH 0.2.0-rc.2 です。0.1.5 系への対応は外しました。** 会話の参照、一覧と投影、V4 記録、設定・ファイルの RPC が変わったため、旧版へ切り替えるだけでは動きません。後方互換の分岐はありません。

対応版と同梱ライブラリの固定版は [src/shared/dsh-compat.ts](../src/shared/dsh-compat.ts) にあります。この文書は移行後の境界、確認範囲、次に版を上げる手順をまとめます。作業の経過は [99 の実装メモ](design/99-integration.md#2026-10-04dsh-020-rc2-への移行) にあります。

## 版ごとの確認結果

2026-10-04 の記録を基にしています。文書の起点は、段階 4 までを統合した `722692c` です。段階 5 の RPC は別 worktree の `f365a2f` までの報告に基づき、以下では **「段階 5 報告」** と記します。段階 5 の追加修正と、全段階の統合後の最終結果は指示役からの連絡待ちです。別 worktree の件数を足して最終件数にはしません。

| DSH の版・確認時点 | 対応と確認結果 | 型検査・ビルド | 単体試験 | 偽データ e2e |
|---|---|---|---:|---:|
| 0.2.0-rc.2・段階 4 統合後 `722692c` | 対応版。実 DSH の内訳は [下表](#実-dsh-の統合試験) | 成功 | 846 件成功 | 124 件成功 |
| 0.2.0-rc.2・段階 5 報告 `f365a2f`（別 worktree） | RPC の通常経路を確認。レビュー・監査後の修正結果は未確定 | 成功 | 842 件成功 | 125 件成功 |
| 0.2.0-rc.2・全段階の統合後 | **最終集計待ち** | 未確定 | 未確定 | 未確定 |
| 0.1.5 系 | 対応対象外。移行後のコードでは再検証していません | ― | ― | ― |
| 上記以外 | 対応を保証しません。移行後のコードでは未検証です | ― | ― | ― |

段階 4 統合後は統合報告、段階 5 は仕上げ報告の値です。各段階の保存ログの集計行も確認しました。この文書の更新では試験・ビルドを再実行していません。ビルドには既存のチャンクサイズ警告が残っています。

## 依存の境界

DSH の内部の型は [web/src/dsh/services.ts](../web/src/dsh/services.ts) に必要な分だけ書き写しています。起動時の [contract.ts](../web/src/dsh/contract.ts) は controller の入口を確認しますが、メソッドの存在だけでは引数・戻り値・寿命の一致までは分かりません。下表の `features/` は `web/src/features/` の略で、RPC の行は段階 5 報告に基づきます。

| 境界 | 0.2.0-rc.2 の形と注意 | このリポジトリの場所 |
|---|---|---|
| 起動グラフ | `__DSH_BOOT__`、`__ModuleLoader__.create()`、相対の `plugins/…`。通信用プラグインと依存だけを個別 URL で読みます | `web/src/dsh/boot.ts`、`boot-graph.ts` |
| 通信の宛先と `<base>` | M3E の index に `<base href="/">`。プラグイン、RPC、WebSocket、画像送信を Host の `/plugins/…`、`/api/…`、`/api/remote.mux` へ解決します | `src/host/index.ts` の `prepareM3eIndex` |
| 画面の URL | 通信の基準を変えても画面は `/m3e/` に残します。空のリンク先、hash、検索文字列、戻る操作、PWA scope に注意します | `web/src/app/route-match.ts` の `pageHref`、`router.ts`、`Markdown.tsx` |
| 共有ライブラリ | cordis 4.0.4、cordis-plugin-loader 1.0.5、dsh-client-store 0.2.0-rc.2 | `package.json`、`src/shared/dsh-compat.ts`、`boot.ts` の `STATIC_MODULES` |
| 稼働状態 | `loader.await()` の完了だけでは成功を保証しません。`FiberState.ACTIVE = 2`、`importError(id)`、`fiber.await()` で状態と原因を確認します | `boot.ts` の `assertPluginsActive` |
| 会話の参照 | `retain(target, { source, signal? })`、`using`、`SessionReference.ready/release`。最後の参照を解放すると scope は即時破棄されます | `conversation-selection.ts`、`session-navigation.ts`、`features/composer/delivery.ts` |
| 参照の借用と失敗 | `scope` / `binding` は保持中だけ使えます。Host 拒否では `ready` が解決しても `openState: 'error'`、中断・解放では拒否になります。signal の中断と明示解放は別です | `web/src/dsh/services.ts`、会話選択・送信処理 |
| 一覧と子の会話 | 一覧は `ids/byId/phase/projectionsBySession`。子カタログは投影 `subagentCatalog`、行は `id/mode/label` など。`byId` だけにある子と親 ID も扱います | `web/src/dsh/session-navigation.ts`、`session-rows.ts`、`features/session-tools/presentation.ts` |
| 順番待ち・割り込み | 投影 `inbox` の `next-turn` と利用者由来の `next-step`。編集・削除のメッセージ ID と送信照合の `source.rpcId` を区別します | `web/src/dsh/inbox.ts`、`features/composer/Sheets.tsx` |
| ジョブ | 一覧から専用の `ctx.jobs.state`、`watchRows` へ移りました。起動グラフにジョブの controller を含めます | `web/src/dsh/jobs.ts`、`boot.ts`、`features/session-tools/JobsScreen.tsx` |
| 完了して未読 | Host の保存値ではなく、標準画面と同じ観測規則で画面側の `completionUnread` を計算します。永続化しません | `web/src/dsh/completion-status.ts` |
| V4 記録 | `tool/result` の `message.role` は `tool`。`toolCallId/content/isError` はメッセージ直下です。旧記録は Host が変換します | `features/chat/model.ts`、`tool-output.ts`、`features/trace/model.ts`、`RecordSheet.tsx` |
| V4 の出どころ・拡張 | `source.kind` に `runtime-context`、`compact-checkpoint`、`plugin:<名前>` など。未知のイベント・ブロックにも `plugin:` が付きます | チャット・トレースの読み取り、`web/src/dsh/session-journal.ts` |
| 設定の名前空間と保存 | profile の entry id。`subagent-model-selection-settings`、`bash-sandbox`（Windows は `pwsh-sandbox`）、`agent-preset-registry.selectedDefault`。Host の `dsh-settings` と `dsh-config-editor` が profile の `cordis.patch.yml` を編集します | `features/settings/schema.ts`、`store.ts`、`ModelsPanel.tsx`。M3E は RPC を使い、設定ファイルを直接編集しません |
| 設定の公開範囲 | `.volatile()` の項目だけ公開・編集可能です。`autoGenerate` を尊重し、`applies` は `live` のみ。`revision` は Host のプロセス内で管理します | `features/settings/`。`settings.describe/update/mutate`、通知 `(ns, revision)` |
| 権限の候補 | 投影 `permissions` は `currentValue` のみ。候補は `permissionPresets.catalog()` と `permission-presets/catalog-changed`。既定値は `defaultOptions/defaultPreset` を使い、`settings.mutate` で `permission` の `defaultPreset` を保存します | `features/composer/api.ts`、`Sheets.tsx`、`features/settings/` |
| モデル・提供元・API キー | モデルのある提供元だけが利用候補です。キーの照会は登録状態、登録・削除の戻り値は `void`。アカウントに架空のキー参照を作りません | `features/settings/providers.ts`、`features/composer/api.ts`。キー保存の内部実装は保護対象のため未読で、更新放送の正確な引数も未検証です。購読側は引数を使わず再取得します |
| ファイル RPC | `readBytes(sid, path, { range: { offset, length }, baseFile? }, signal)` のバイト列は `Uint8Array`。`changes(sid, path, signal)` は `RemoteStreamHandle` | `features/session-tools/files.ts`、`FileScreen.tsx`、`FilesScreen.tsx` |
| その他の RPC・通知 | `commands.list`、`fileReferences.list`、`session.modelCatalog/selectModel`、`directoryPicker`、`goals`、承認・質問の返答 | 各機能の `api.ts`、`operations.ts`、`web/src/dsh/remote-events.ts`、`interactions-store.ts` |
| エラー・その他の投影 | `RemoteResult` と `RemoteFailure`、エラーコード、`plan/modelSelection/goal/tokenUsage/contextPressure` の形 | `web/src/dsh/remote-result.ts` と各機能。型・案内の試験と、実際のエラー発生は別に確認します |
| Host・標準画面 | `webServer.register/renderIndex/tapIndex`、`connection.authorizeIndex`、`settings.general.item`。preload の除去は相対 URL にも対応します | `src/host/index.ts`、`src/client/index.tsx` |
| Host のフォルダ選択 | macOS / Windows の loopback 起動は条件により `native`、SSH 起動の印があれば `browse` になります | `features/home/directory.ts`、`e2e-dsh/dsh-host.ts` |
| 偽 LLM との接続 | `/v1/messages` と Messages 形式の SSE、`tool_use/tool_result`、画像の `image` ブロック。ブラウザに届く V4 記録とは別の形式です | `e2e-dsh/fake-llm.ts` |

### 0.1.5 から 0.2.0 で壊れた境界と、どう直したか

| 壊れた境界 | 移行で直したこと |
|---|---|
| 相対の bootstrap URL が `/m3e/plugins/…` へ向き、起動できませんでした | Host の index に `<base>` を入れ、相対の preload を除去します。ルーターと Markdown のリンクは表示中のページを基準に解決します |
| RPC・WebSocket・画像の宛先もページの基準 URL に依存していました | Host のルートへそろえました。個別の通信フックを差し込む案も比較し、画像の進捗通知を保てる `<base>` を採用しました |
| 共有ライブラリと loader の失敗処理が変わりました | 同梱版をそろえ、待機後の稼働状態と失敗原因を確認します。通信失敗を版の不一致に取り違えないようにします |
| 会話の開閉 API と暗黙の scope 作成がなくなりました | 画面・準備・送信の参照の持ち主を分け、新しい参照を取ってから古い参照を解放します。一覧の準備待ち、失敗後の再選択、離脱・復帰にも対応します |
| 一覧内の選択・ジョブ・子カタログ、会話内の順番待ち、完了フラグを前提にしていました | 選択は M3E、ジョブは専用 controller、カタログと順番待ちは投影、完了未読は画面側の計算へ移しました |
| 旧記録の結果ブロックと出どころを読んでいました | V4 だけを読みます。注入文脈と自分の発言を分け、トレースの呼び出しと結果を結合します |
| 設定、権限候補、ファイル RPC の中身が変わりました | 名前空間、公開項目、候補取得元、バイト列と監視の引数を合わせました（段階 5 報告）。追加修正の完了は下の残件で管理します |
| 偽 LLM が旧通信形式で応答し、Mac の試験が native のフォルダ選択で止まりました | Messages 形式へ移行し、隔離 Host だけに SSH 起動の印を付けて browse を選びます |

## 仕様と実物の差

[docs/ui-spec.md](ui-spec.md) は今回変更していません。以下は自動的に仕様変更したものではなく、**利用者が決める必要があること**です。

| 項目 | 確認した動き・制約 | 決めること |
|---|---|---|
| 再接続のバナー | 0.2.0 でも Host 停止中は `connecting` のまま再試行し、進捗バーが続きます。統合試験の観測時間内にバナーは出ません。Host 復帰後の自動再接続は成功しています | 長い再接続をバナーへ切り替える時間、古いデータと手動再接続の案内を決めます |
| 実行中のアーカイブ | `stopActivity` なしでは `workspace/session-active` で拒否されます。自動停止は加えず、止めてから再試行する案内だけを追加しました（段階 5 報告）。実 DSH でこの UI 操作の再現は未実施です | アーカイブ時に実行を止める操作や確認を設けるかを決めます |
| 完了して未読 | 標準画面と同じく、観測した実行状態の変化から計算します。起動時の待機中の一覧は未読にせず、会話を開く・再実行する・削除すると消します。保存しないため再読み込み後は引き継ぎません | 端末間や再読み込み後にも未読を保持するかを決めます |
| 設定項目・反映時期 | 新名前空間の公開項目だけを扱い、`autoGenerate: false` は汎用フォームに出しません。既存の専用画面は維持し、反映は `live` のみです（段階 5 報告） | 仕様書の旧名前空間と再起動後の反映の説明を、今後どう改訂するかを決めます |
| アカウントでのログイン | 利用可能なアカウント提供元だけを表示する処理があります。ログイン、解除、失効、ログイン要求の画面は未対応で、ログイン済み実機も未検証です | M3E にアカウント操作を追加するかを決めます。通常の Host へのログインとは別です |
| V4 で増えた記録 | `developer/message` のツール増減は読み飛ばします。標準画面には文脈として表示があります。`forked` は終了境界として扱い、専用の理由表示は足していません | ツール増減や分岐終了の表示を追加するかを決めます。未知ブロックは既存の非対応表示、未知イベントは読み飛ばしです |
| 期限付きの質問 | 待ち続ける既定の質問への返答を確認しています。期限付き待機と `attachWait` は未対応です（段階 5 報告） | 期限付きの質問を扱う場合の表示と回答方法を決めます |
| native のフォルダ選択 | OS のダイアログを選ぶ Host では、ブラウザのフォルダ一覧を使う経路が拒否されました。統合試験は browse に限定します | ローカルの native 方式も M3E で扱うかを決めます |

`?mock&scenario=disconnected` は状態を直接作る偽データです。実 DSH の Host 停止時に同じ状態へ移る証拠にはなりません。認証失効時の接続状態も未検証です。

### 段階 5 の最終報告で確認すること

以下は仕様として確定した制約ではなく、レビュー・監査後の修正結果待ちです。

- 実在する設定名前空間の偽スキーマを公開項目に合わせ、架空のフォーム試験用項目を分離した結果。
- 開いたままのモデル選択シートへの更新通知が移行前からの動きか、移行で生じた差か。その判断と対応。
- フォルダ監視の通知を、変更した子ではなく監視対象自身のパスとメタデータに合わせた結果。
- API キーの管理サービスがない場合の案内文の修正、設定保存から `(ns, revision)` が届くことの確認。
- 画像の範囲指定、キー更新通知、権限候補の再取得、バイト本文の監査指摘への対応と、画像表示の不安定な失敗の原因・再確認。

## 実 DSH の統合試験

`e2e-dsh/` は実物の DSH Host と通信の部品、ビルド・pack した M3E を、Chromium から操作します。**LLM だけは偽物です。本物の LLM の動作を保証する試験ではありません。** 初回の DSH 取得には npm を使いますが、LLM の接続先はローカルです。

### 集計

| 確認時点 | 通常の成功 | 既知の差の期待失敗 | 実行・根拠 |
|---|---:|---:|---|
| 段階 4 統合後 `722692c` | 19 件 | 1 件 | 統合報告で連続 2 回とも同じ結果。予期しない失敗・skip・flaky なし |
| 段階 5 報告 `f365a2f`（別 worktree） | 23 件 | 1 件 | 仕上げ報告で連続 2 回とも同じ結果。V4 表示の追加 spec はこの集計に含めません |
| 全段階の統合後 | **最終集計待ち** | **最終集計待ち** | 段階 5 の修正と統合後に、指示役の結果で更新します |

期待失敗は Host 停止中のバナーの既知の差です。Playwright の `passed` には「失敗すると宣言した試験が失敗した」場合も入るため、通常の成功と分けて読みます。

### 仕組みと実行

- [fake-llm.ts](../e2e-dsh/fake-llm.ts) は `/v1/messages` に応答し、`message_start`、`content_block_*`、`message_delta`、`message_stop` の SSE を返します。ツールは `tool_use/tool_result`、画像は `image` ブロックで到着を確認します。ブラウザへ流れる V4 の `role: 'tool'` とは別の形式です。
- `[[slow]]`、`[[medium]]`、`[[approval]]`、`[[question]]` で応答を選びます。`holdTurn(prompt)` は指定した会話の進行を試験から解放できるようにし、順番待ちはターン終了後、割り込みは同じターンの次ステップに届くことを区別します。
- [dsh-host.ts](../e2e-dsh/dsh-host.ts) は `tmp/dsh-integration/` 配下に毎回新しい `HOME` と `DSH_HOME` を作ります。Host と偽 LLM は `127.0.0.1` の空きポートを自動で使い、Host の再起動は同じポートとホームを使います。固定の Vite ポートは使いません。
- Host に `DEEPSEEK_BASE_URL` と試験用の架空の API キーを渡します。`SSH_CONNECTION` の印で `browse` を選びます。SSH 接続を実行するものではなく、macOS / Windows の native ダイアログを避けて遠隔 Host のブラウザ操作を確認するためです。自動ブラウザ起動の抑止と open-in-app 候補が空になる副作用もあり、それらの経路は検証対象外です。
- [fixtures.ts](../e2e-dsh/fixtures.ts) で Host を worker 内で共有し、`workers: 1`、再試行なしで実行します。新しい spec は他の spec の会話を前提にせず、必要な会話を自分で用意します。

```bash
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts
```

| 環境変数 | 用途 |
|---|---|
| `M3E_DSH_VERSION` | 試す版。省略時は `SUPPORTED_DSH_VERSION` |
| `M3E_DSH_DIR` | 入れ済みの DSH のディレクトリ。`node_modules/.bin/dsh` を含む場所です |
| `M3E_SKIP_BUILD=1` | 直前に同じコードをビルド済みの場合だけビルドを省きます。pack は行います |
| `M3E_CHROMIUM_PATH` | Chromium の実行ファイル。偽データ e2e にも使えます |

`pnpm test` には含めていません。結果は `tmp/dsh-integration/report.json`、失敗時の trace などは同じディレクトリの `results/` に出ます。再実行前に必要な証跡を保存してください。起動処理は以前の `run-*` を整理するため、長期利用したホームの検証にはなりません。試験は中断せず終了処理まで待ちます。

### 確かめた経路

| 経路 | 実 DSH と偽 LLM で確認した内容 | 根拠 |
|---|---|---|
| 起動・埋め込み拒否 | `/m3e/` の一覧、index のヘッダー、iframe の表示拒否 | `real-dsh.spec.ts` |
| ワークスペース | browse のフォルダ選択から追加 | 同上 |
| 会話・履歴 | 初回送信、LLM への本文到着、返答、再読み込み後の履歴と題名、会話切り替え | 同上 |
| 逐次表示・停止 | 途中の返答、停止時の LLM 接続切断、以降の表示停止 | 同上 |
| 承認・質問 | 会話から許可・拒否・回答し、結果が LLM に戻ること | 同上 |
| 順番待ち・割り込み | 待機表示、本文、モデルへ届くターン・ステップの違い | 同上。`holdTurn` で区別します |
| 画像送信 | Messages の画像ブロックが LLM に届くこと | 同上 |
| 再接続 | Host 停止中は送れず、復帰後は自動再接続して送れること | 同上。バナーの差は期待失敗として別集計です |
| 参照の引き継ぎ・復帰 | 初回送信の参照を画面へ引き継ぐこと、送信中に離脱したときの解放、`pagehide/pageshow` 後の送信 | `session-contract.spec.ts`。Safari の実際の BFCache は未検証です |
| V4 表示 | 承認・質問の結果本文がチャットとトレースで見えること、呼び出しと結果の結合、注入文脈と自分の発言の区別 | `records-v4.spec.ts` |
| 設定・モデル | 設定の保存と再読み込み、提供元とモデルの表示 | 段階 5 報告の `rpc.spec.ts` |
| 権限 | 既定値の保存、新規会話への適用、会話内の切り替え | 同上。候補変更時の再取得は監査後の報告待ちです |
| ファイル | 一覧、テキスト本文、画像寸法、バイト列、実ファイルの変更通知 | 同上。範囲指定・フォルダ監視の追加確認は報告待ちです |
| API キー | 隔離ホームの架空値の登録・削除と再読み込み後の状態、環境由来の変更不可表示 | 同上。更新放送の購読を検出する追加確認は報告待ちです |

### 試験の強さの確かめ方

移行では、読むレビューに加え、**本体や偽 controller を一時的に壊し、対象の試験が落ちることを確かめる監査**を行いました。成功件数だけでは、準備を通っていない試験や、別の文字列を拾って通る試験を見つけられないためです。

下表は独立監査 M1〜M5 の初回集計です。「調べた試験」の延べ数で、変異の個数や全試験の総数とは異なります。修正結果は報告が確認できた範囲です。

| 対象 | 調べた試験 | 検出 | 空振り | 弱い | 未決・未実施 | 初回に生存した試験の修正結果 |
|---|---:|---:|---:|---:|---:|---|
| M1：参照・選択・偽 controller | 151 | 141 | 5 | 5 | 0 | 10 件を強化し、同じ変異で失敗を確認 |
| M2：送信・子の会話・各機能の単体試験 | 132 | 124 | 4 | 4 | 0 | 8 件を強化し、同じ変異で失敗を確認 |
| M3：セッションの画面・実 DSH | 39 | 37 | 0 | 2 | 0 | 2 件を強化し、同じ変異で失敗を確認 |
| M4：V4 記録 | 34 | 29 | 0 | 5 | 0 | 5 件を強化し、同じ変異で失敗を確認 |
| M5：RPC | 51 | 47 | 0 | 4 | 0 | 4 件の修正・再確認結果待ち |
| 合計（延べ） | 407 | 378 | 9 | 20 | 0 | 25 件は修正後の検出を確認、4 件は報告待ち |

再確認で追加された「子の親 ID の欠落」と「トレース本文だけが非表示」の穴も修正し、同じ変異で失敗した報告があります。初回集計には足していません。監査対象外の機能まで確認済みという意味でもありません。

次回も、追加した試験と入力・期待を変えた試験ごとに、次の手順を行います。

1. 通常状態での成功と、確かめる動きを確認します。監査用の隔離 worktree を使い、既存の未コミット変更を巻き戻さないようにします。
2. 最小の変更を本体か偽 controller に当てます。準備の空振りを調べる場合は、データ投入や操作を一時的に省きます。
3. 対象ファイルや試験名に絞って実行します。型エラー・読み込み失敗・無関係な時間切れは検出に数えません。
4. 通った場合は「空振り」「一部の確認が弱い」「動きが同じ変異」「別の試験が担当」を分けます。動きが同じなら別の変異で試します。
5. 強化後に、生存したのと同じ変異を当て直して失敗を確認します。表示試験は本文の一致と、その本文の要素が見えることを確かめます。
6. 一時変更だけを `git restore <対象ファイル>` で戻し、差分と通常実行を確認します。試験名・変異箇所・狙った失敗・復元結果を記録し、変異はコミットしません。

### 偽データでしか確かめていないもの

次は単体試験や `?mock` の確認が中心で、実 DSH の対応する操作全体は未検証です。

- 実際に生成したサブエージェントへの送信、子カタログの競合・拒否・再試行、統計、ジョブの購読・停止、ゴールの操作。
- 会話の分岐、手動の題名変更、アーカイブ、ワークスペースの名前変更・並べ替え、検索の結果と抜粋、完了未読の表示と消去。
- プラン確認、対応待ちやトレースからの承認・質問への回答、応答が失われたときの「送信結果が不明です」。
- `developer/message`、`forked`、未知の `plugin:` 拡張、compaction の発生時の表示。古い記録の移行・検索 index・ページング全体も未検証です。
- 監視非対応、writer-held、投影不能、モデル不能などの実際のエラー発生。再接続後に生成途中の応答が続く経路も、復帰後の新規送信とは別に残っています。

偽 controller は公開契約の境界を厳しくしていますが、OS、永続化、LLM の全能力、履歴の全修復は再現しません。段階 5 の旧 `readBytes` 引数は実物では範囲が無視されましたが、偽物は旧呼び出しを見逃さないため拒否します。この意図した差も、実物と同じという説明には含めません。

### 人が実機で確かめるべきもの

- 利用する Host の `dsh --version` が対応版であること。本番や利用者の DSH の更新・確認は隔離試験に含めていません。
- iPhone の Safari とホーム画面の Web アプリで、キーボード、シート、画像、送信・停止、再接続を操作すること。特に別ページから「戻る」で **実際の BFCache から復帰**した後に、参照が戻って送れること。
- TLS やリバースプロキシを挟んで `/m3e/`、`/plugins/…`、`/api/…` が通り、WebSocket と埋め込み拒否のヘッダーが保たれること。
- 本物の LLM の長い返答、考えた内容、複数ツール、途中のエラー、サブエージェント。実 API キーによる外部接続とログイン済みアカウントも未検証です。
- 長期利用した `DSH_HOME` の多数の会話と古い記録、Windows のシェル、native のフォルダ選択を使う構成。

## 版を上げるときの手順

1. 対応版、起点コミット、既知の差、通常成功と期待失敗を記録します。利用者の DSH を使わず、`e2e-dsh` の隔離環境で新しい版を試し、最初に止まる境界を記録します。
2. 共有ライブラリを照合し、`package.json` と `src/shared/dsh-compat.ts` を同時に更新します。loader の待機・失敗処理も確認します。
3. 起動グラフ、preload、`<base>`、RPC・WebSocket・画像の宛先を確認します。`/m3e/` の遷移、空の Markdown リンク、戻る・再読み込み、PWA scope も確認します。
4. 実 DSH 試験の前提を確認します。LLM の接続形式、SSE、ツールと画像の形式を実物に合わせ、フォルダ選択の native / browse を確認します。環境の差を API の破損と取り違えないようにします。
5. セッション controller の型・実装を照合し、参照の所有、ready の成功・失敗、解放、一覧と投影、ジョブを移行します。偽 controller も公開契約に合わせ、非同期の準備・中断・後着応答を確認します。
6. 会話の記録を実際に受信し、チャット・トレース・偽記録を合わせます。その後、設定、権限、提供元、ファイル、通知の RPC を照合します。共通の参照契約が安定すれば、記録と RPC は独立した worktree で進められます。
7. 実物を読むときは対象パッケージ・ファイルを限定します。保護対象のパスにあるパッケージは読まず、許可された呼び出し側と隔離環境の動作で確認できる範囲を記録します。内部の保存形式や通知の引数を推測で埋めません。
8. 読むレビューに加え、上の[試験の強さの確かめ方](#試験の強さの確かめ方)を実行します。成功件数が維持されても、確認が失われていないかを壊して確かめます。
9. 統合したコードで `pnpm typecheck`、`pnpm test`、`pnpm build`、偽データ e2e を通し、実 DSH を連続して確認します。コマンドは [development.md](development.md#試験の使い分け) を参照します。削除・skip・条件の緩和で件数をそろえません。
10. この文書の集計表を更新し、README の各言語と引き継ぎから参照します。仕様との差、未検証、実機で利用者が判断することを残します。文書だけの修正では試験・ビルドを再実行せず、根拠・リンク・差分を確認します。
