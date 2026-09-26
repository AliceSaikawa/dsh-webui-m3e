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

### 2026-09-25：2本のレビューを受けたキャッシュ修正

#### 修正内容と判断

- 新しいハッシュの応答を保存できた後、同一オリジン・同じフォルダ・同じ元の名前・同じ拡張子の旧ハッシュだけを削除するようにした。Worker の再インストールに頼らず、各保存時に世代を整理する。別のファイルや他アプリのキャッシュは対象にしない。
- 同じファイルの保存と世代整理は順番に行う。同時に別ハッシュの要求が完了しても、新旧が互いを削除して両方なくなることを防ぐ。最後に保存に成功した要求のハッシュを残す。保存が失敗したら旧版は消さず、削除処理の失敗もネットワーク応答を妨げない。
- `cacheFirst` は応答用 `response` と保存完了用 `cacheDone` の2つの Promise を返す。`sw.js` の fetch ハンドラ内で `respondWith(response)` と `waitUntil(cacheDone)` を同期的に登録し、画面へ返す応答はキャッシュの書き込み・削除を待たない。`waitUntil` の最初の呼び出しをイベント内で行う制約は [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil)で確認した。
- フォントもハッシュを必須にした。`/m3e/assets/` と `/m3e/fonts/` の両方で、ハッシュのないフォントを対象から外す。元の名前とハッシュ内のハイフンを区別するため、ハッシュ長は現行 Vite 出力の既定の8文字に統一した。将来、ビルド側でハッシュ長を変える場合は、この判定も合わせる必要がある。
- キャッシュ名は `dsh-webui-m3e-static-v2` へ更新した。この Worker が入る際、従来の v1（ハッシュなしフォントを含む）を削除する。その後のビルド更新は同じ v2 内で上記の保存時の整理を使う。
- `/m3e/` 内だけを扱うこと、index を保存しないこと、応答の型・状態の確認は維持した。共通基盤（00）とサーバーは変更していない。

#### 確認結果と残ること

- `pnpm typecheck`：成功。
- `pnpm test`：69件すべて成功（PWA 用14件）。新版保存後に旧ハッシュだけが消えること、別名・別フォルダ・別拡張子・別オリジンの保持、ハイフンを含むハッシュのフォント更新、保存完了前の応答、保存失敗時の旧版保持、列挙・削除失敗の吸収、並行保存、`respondWith` と `waitUntil` の同期登録を確認した。PWA 用の単独テストも14件成功した。
- `pnpm build`：成功。前回と同じ JS chunk サイズ警告（883.80 kB）は残る。
- ビルド後、`dist/sw.js` と `dist/sw-cache.js` が元ファイルと一致し、キャッシュ名が v2 であることを Node で確認した。実際の JS・CSS・woff2 の全3ファイルが新しい8文字の判定を通ることも確認した。
- `git diff --check`：成功。今回、拒否された操作はない。
- `?mock` の画面操作は行わない。DSH・開発サーバー・HTTP 確認は引き続き実施せず、実ブラウザの Worker 更新や Cookie は前節のとおり段階3へ引き継ぐ。今回の3指摘は DSH の窓口を使わないため、現行プラグインの再調査は不要と判断した。
- 担当外で必要になった変更：なし。

### 2026-09-26：土台の統一テーマに PWA の色を合わせる

- `feat/10-pwa-2` のクリーンな状態から開始した。00 の実装メモ末尾「テーマの色生成の統一（4）」の引き継ぎを確認し、index.html の明暗の theme-color をライト `#fdf8fd`、ダーク `#141316` に更新した。マニフェストの background_color と theme_color はライトの `#fdf8fd` にそろえた。
- `tests/10-pwa.test.ts` の色の期待値を更新した。既存のマニフェスト・head の検証を使い、新しいテストは追加していない。
- `pnpm typecheck`：成功。`pnpm test`：450件すべて成功（PWA 用14件を含む）。`pnpm build`：成功。JS chunk のサイズ警告は残る（1,494.32 kB）。
- ビルド後の `dist/index.html` の明暗 theme-color と `dist/manifest.webmanifest` の2つの色が新しい値であることを確認した。`git diff --check` も成功した。
- `?mock` の画面操作、DSH・開発サーバーの起動、HTTP 確認は行っていない。実機での色表示はオーケストレーターへ引き継ぐ。今回の変更は土台から指定された色への置換だけで、DSH プラグインの再調査は不要と判断した。
- 担当外で必要になった変更：なし。main の操作、merge、rebase は行っていない。

### 2026-09-26：統合時の index 別表記の認証・保存指定を修正

- 指摘2への対応として、`src/host/index.ts` の `resolveTarget` で、正規化後の絶対パスが `DIST_INDEX` と一致する場合も既存の index 処理へ渡すようにした。`/m3e//index.html` と `/m3e/assets/%2e%2e%2findex.html` も `authorizeIndex` を通り、許可された応答は描画処理と `Cache-Control: no-store` を使う。
- 通常の index と静的ファイルの配信処理、標準画面の切り替えスクリプト、登録する `/m3e` の prefix は変更していない。`/m3e/` 外へのルート登録は追加していない。設計書の元の担当範囲を超えるルート判定の修正は、今回の統合担当からの明示指示に基づく。
- `tests/host-routes.test.ts` に、正規化後の index 判定、通常・別表記の認証拒否と許可、描画と `no-store`、assets の immutable と Worker・マニフェストの `no-cache`、既存 prefix と index フックの維持を追加した。認証拒否時はファイルの読み取りも描画も行わないことを確かめた。
- 修正前の `node --test tests/host-routes.test.ts` は追加した3件が失敗した。別表記が通常のファイルパスとなり、認証なしで200、保存指定が `no-cache` になることを stub で再現した。修正後の `node --test tests/host-routes.test.ts tests/10-pwa.test.ts` は23件すべて成功した。
- DSH・HTTP サーバーは起動していない。ハンドラを直接呼び、ファイル読み取り・認証・描画を stub にした確認であり、実際の DSH の認証やブラウザの動作は未確認。今回の操作に拒否はなかった。
- 指摘1と合わせた最終検証：`pnpm typecheck` 成功、`pnpm test` 534 件すべて成功、`pnpm build` 成功。ビルドの 500 kB 超の chunk 警告は残る（JavaScript 1,578.50 kB、gzip 397.02 kB）。
