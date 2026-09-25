# 10 ホーム画面に追加する Web アプリ（PWA）

## 目的

iPhone のホーム画面に追加して、アプリのように全画面で開けるようにします。今の画面（DSH の標準の画面）の動きを壊さないことを最優先にします。

## 担当する画面

画面は作りません。仕様は `docs/handoff.md` の「次にやること」の PWA の項目です。

## 担当するファイル

- `web/index.html` の `<head>`（Web アプリ用の `meta` と `link` を足すところだけ。本文と `main.tsx` の読み込みは変えない）
- `web/public/` の全部（新しく作る。マニフェスト、Service Worker、アイコン）
- `src/host/index.ts` のうち、キャッシュの指定（`Cache-Control`）を決める部分だけ。必要なときに限ります。
- `tests/10-*.test.ts`
- この設計書の「実装メモ」

段階 1 の担当と並行するファイルはないので、段階 2 のほかの機能と衝突しません。ただし `src/host/index.ts` を変えたら、`tests/host-routes.test.ts` が通ることを確かめてください。

## 決まっていること

- **Service Worker の対象は `/m3e/` の下だけ**にします。ファイルは `/m3e/sw.js`、`scope` は `/m3e/` です。`/` の下（今の画面）には一切かかわりません。
- **画面本体（index）はキャッシュしません**。キャッシュすると、この端末の選択を「今の画面」に戻しても、古い M3E の画面が出続けるためです。index は毎回ネットワークから取ります。
- キャッシュしてよいのは、ファイル名にハッシュの付いた `/m3e/assets/` の下のファイルとフォントだけです。
- DSH との通信（WebSocket や RPC）には手を出しません。
- オフラインのときに出す専用の画面は作りません。接続が切れたときの表示は、アプリの中のバナー（00）が担当します。

## 作るもの

### マニフェスト（`web/public/manifest.webmanifest`）

- `name`：「DSH」、`short_name`：「DSH」
- `start_url`：`/m3e/`、`scope`：`/m3e/`、`display`：`standalone`
- `background_color` と `theme_color`：00 のテーマの明るい側の背景色
- アイコン：192px と 512px、`maskable` も 1 つ

### iPhone 向けの指定（`web/index.html` の `<head>`）

- `<link rel="manifest" href="/m3e/manifest.webmanifest">`
- `<link rel="apple-touch-icon" href="/m3e/apple-touch-icon.png">`（180px）
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-title" content="DSH">`
- `<meta name="theme-color">` を明暗の 2 つ（`media` で分ける）
- ステータスバーの指定は既定のまま（`default`）にします。部品集の比較で、この設定ならページがステータスバーの下から始まり、上の safe-area が 0 になることを確かめています。

### Service Worker（`web/public/sw.js`）

- `install` と `activate` で古いキャッシュを消し、すぐに有効にします（`skipWaiting`、`clients.claim`）。
- `fetch`：
  - `/m3e/assets/` の下とフォント：キャッシュを先に見て、なければネットワークから取ってキャッシュします。
  - それ以外（index、`sw.js` 自身、`/m3e/` の外のすべて）：何もしません（ブラウザに任せる）。
- 登録は `main.tsx` を変えずに行うため、`web/index.html` に小さな `<script>` を足して `navigator.serviceWorker.register('/m3e/sw.js', { scope: '/m3e/' })` を呼びます。開発時（`pnpm dev`）は登録しません。
- 今の画面に戻すときに登録を解除する必要はありません。対象が `/m3e/` の下だけで、画面本体をキャッシュしないためです。

### アイコン

- 紫の地に白で「DSH」の文字を置いた、単純なものにします。PNG で 180px、192px、512px、`maskable` 用の 512px を用意します。
- 画像を作る道具は、リポジトリに依存を足さない方法で用意してください（手元の道具で作って PNG をコミットする）。

### サーバー側のキャッシュの指定

- 今のサーバー（`src/host/index.ts`）は、`/m3e/assets/` の下を長期のキャッシュ（immutable）にしています。`sw.js`、`manifest.webmanifest`、アイコン、index は長期のキャッシュにしてはいけません。
- 今の実装がすでにそうなっていれば、変えずに実装メモに「確認済み」と書いてください。
- `sw.js` の `Content-Type` が `text/javascript` になることを確かめてください。

## 使う DSH の窓口

使いません。

## テスト

`tests/10-pwa.test.ts` で、次のことを確かめます。

- `manifest.webmanifest` が JSON として読め、`start_url` と `scope` が `/m3e/` であること
- `sw.js` の「キャッシュする URL か」の判定（`/m3e/assets/` の下は する、`/m3e/` と `/m3e/index.html` と `/` の下は しない）。判定の関数を `sw.js` から分けて読み込めるようにしてください。
- `src/host/index.ts` を変えた場合は、`sw.js` と `manifest.webmanifest` が長期のキャッシュにならないこと

## 完了条件

- `pnpm build` のあと、`dist/` に `manifest.webmanifest`、`sw.js`、アイコンが入っています。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。
- iPhone でのホーム画面への追加の確認は、段階 3 で行います。

## 未確認のこと

- DSH の標準の画面が、すでに `/` で Service Worker を登録しているか。登録していて、その `scope` が `/` なら、`/m3e/` の下の要求も標準の画面の Service Worker を通ります。段階 3 で確かめ、問題があれば実装メモに書いてください。
- ホーム画面から開いた Web アプリは、Safari と別の Cookie を持ちます（README の「端末ごとの切り替え」）。最初に開いたとき、ログインの Cookie がない状態になるかを段階 3 で確かめます。

## 実装メモ

### 2026-09-25：実装と確認

- `feat/10-pwa` の担当範囲だけを変更する。main の操作、merge、rebase、DSH・開発サーバーの起動、HTTP 確認は行わない。
- 標準画面の `dsh-client-ui-*/lib` をまとめて検索する操作は、実行方針の `Opaque shell wrappers are blocked` で拒否された。その一括検索は中止し、別経路で繰り返していない。この操作に依存しない実装・検証と、別途特定した Web 配信担当の読み取り調査は続ける。

#### 実装したことと、自分で決めたこと

- `web/index.html` の head にマニフェスト、Apple 用アイコン、全画面表示・タイトル・既定のステータスバー、明暗の theme-color を追加した。本文と `main.tsx` の読み込みは変更していない。
- 00 の `web/src/app/theme/Theme.tsx` と同じ `#6750A4` のパレットを、同梱の色計算ライブラリで計算した。surface は明 `#fffbff`、暗 `#1c1b1e`。マニフェストの背景・テーマ色には明るい側を使った。
- 紫地に白い DSH の PNG を、macOS の AppKit と Helvetica-Bold で生成した。180・192・512px と maskable 用 512px を同梱し、リポジトリの依存は増やしていない。maskable は文字を小さくし、中央の安全領域へ収めた。PNG の寸法をテストし、maskable の画像も目視した。
- 登録は head の小さいスクリプトで行い、Vite の HTML 定数 `%PROD%` が `true` の場合だけ実行する。未置換の HTML と開発時は登録しない。`/m3e/sw.js`、scope `/m3e/` を固定し、判定関数を別ファイルから読み込めるよう `type: 'module'` を使った。`updateViaCache: 'none'` とし、Worker とその import の更新に HTTP キャッシュを使わない。登録失敗は日本語のコンソール警告だけにし、画面の起動は妨げない。
- 判定は `web/public/sw-cache.js` に分けた。同一オリジンの GET だけを扱い、`/m3e/assets/` 配下のハッシュ付き JS・CSS・画像、および `/m3e/assets/`・`/m3e/fonts/` のフォントを対象にした。ハッシュは Vite の出力に合わせた8文字以上の英数字・ハイフン・アンダースコア。クエリー付き、Range 要求、navigation、document、iframe は対象外にした。
- index、Worker 自身、マニフェスト、アイコン、DSH の通信、`/m3e/` 外の要求では `respondWith` を呼ばない。index の事前保存も、オフライン時の代替 index も作らない。キャッシュ候補の応答でも HTML、リダイレクト、200 以外、型の不一致、`no-store`・`private`・`Vary: *` は保存しない。保存済み応答にも同じ型判定を行う。
- `dsh-webui-m3e-static-v1` だけを使用する。install と activate は同じ専用接頭辞の旧版だけを消し、それぞれ `skipWaiting` と `clients.claim` を呼ぶ。標準画面など他アプリのキャッシュは削除しない。キャッシュ方針の更新時は版を上げる。読み書きや容量の失敗時も、正常なネットワーク応答は返す。
- サーバー側は**確認済み、変更不要**。`src/host/index.ts:98` は index を `no-store`、`:103-106` は assets だけを immutable、それ以外を `no-cache` にしている。今回の Worker・判定モジュール・マニフェスト・アイコンは assets 外なので長期保存されない。`:32` から `sw.js` と `sw-cache.js` は `text/javascript; charset=utf-8`、`:38` からマニフェストは `application/manifest+json` になる。これはコードの確認で、HTTP での確認はしていない。
- 仕様の参照：[Vite の HTML 定数置換](https://vite.dev/guide/env-and-mode.html#html-constant-replacement)、[Service Worker の scope・module・更新設定](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)、[maskable の安全領域](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons#support_masking)。

#### 「未確認のこと」を現行プラグインで調べた結果

参照元の基点は `/Users/user/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`。読み取りだけで、稼働中 DSH へのアクセスや変更はしていない。

1. 標準画面の入口は `dsh-web-app/lib/index.js:110` が `dsh-web-frontend/dist/index.html` を解決し、`:176` で静的配信担当へ渡す。frontend に lib はないため、この特定済み HTML と直接参照先を確認した。`dist/index.html:6` にマニフェスト、`:9-10` に `assets/index-BKQ_L1z6.js` と `assets/vendor-CCJJTK99.js` がある。HTML と両 JS に Service Worker 登録を示す処理は見つからなかった。確認した renderer・layout・open-in-app と Web 配信・接続担当の lib にも登録処理は見つからなかった。
2. ただし標準エントリの JS にはプラグインの動的 import があり、全プラグインの未登録までは断定しない。ブラウザに過去から残る登録と実際の scope は静的コードから分からない。**段階3で、標準画面と M3E の制御中 Worker・登録 scope を確認する。**
3. `dsh-client-connection/lib/index.js:292-293` は Cookie を `Path=/; HttpOnly; SameSite=Strict` で発行する。`:386-425` はルートの有効な起動トークンから Cookie を発行して `303 /` へ移動し、`:431-448` は Cookie がない・無効・期限切れなら `401` と `no-store` を返す。M3E の index も同じ `authorizeIndex` を使うため、**初回のホーム画面アプリが有効な Cookie を持たなければ401になる実装**と確認した。
4. Safari から追加した時点の Cookie がホーム画面アプリへ実際に引き継がれるかは、このコードでは確認できない。**段階3で、追加直後の起動・ログイン・再起動・標準画面への切り替えを実機で確認する。**

#### 検証結果

- `pnpm typecheck`：成功。
- `pnpm test`：64件すべて成功。PWA 用9件で、マニフェスト・PNG寸法・head の指定、開発時の未登録、登録の失敗、キャッシュ対象の境界、応答の型、キャッシュヒット、他アプリを残す削除、保存失敗、オフライン、Worker の install・activate・fetch を Node 上で確認した。既存 `tests/host-routes.test.ts` も成功。
- `pnpm build`：成功。JS chunk が500 kBを超える警告は出る（883.80 kB）。今回の担当範囲では分割設定を変更していない。
- ビルド後に、`dist/` のマニフェスト、`sw.js`、`sw-cache.js`、4種の PNG が public の元ファイルと同じ内容であることを Node で照合した。ビルド済み HTML の `%PROD%` が `true` に置換され、実際に出力された JS・CSS・woff2 の全3ファイルがキャッシュ対象と判定されることも確認した。
- `git diff --check`：成功。
- `?mock` で操作した画面：**なし**。最新のオーケストレーター指示で開発サーバー・HTTP 確認を禁止されているため、ブラウザ操作はオーケストレーターへ引き継ぐ。iPhone のホーム画面への追加、Worker の実登録・更新、ステータスバー、実機の Cookie は段階3に残る。DSH は起動していない。

#### 担当外で必要になった変更

なし。`src/host/index.ts` も変更していない。標準画面のキャッシュや認証の変更は提案・実施せず、実機での確認事項として残した。
