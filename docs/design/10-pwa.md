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

（実装した担当が書き足します）
