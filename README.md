# dsh-webui-m3e

DeepSeek Harness（DSH）のスマートフォン向け Web UI を、Material 3 Expressive で作り直すプラグインです。今の UI はそのまま残し、端末ごとに切り替えて使います。

## 今の状態

`/m3e` で画面を配信し、DSH と接続して、接続状態とセッション一覧を表示するところまでできています。端末ごとの切り替えも動きます。M3E の見た目と PWA の設定はまだありません。

## 端末ごとの切り替え

- この端末の選択は、Cookie `dsh-webui`（値は `m3e` か `classic`）に入っています。iPhone のホーム画面に追加した PWA は Safari と別の Cookie を持つので、別々に選べます。
- サーバーは、DSH が返すすべての index の `<head>` の先頭に、小さなスクリプトを差し込みます（`tapIndex`）。今の画面の index（`/` と `/index.html`）で Cookie が `m3e` なら、今の画面のコードを読み込む前に `/m3e/` へ移動します。判定は [src/shared/ui-choice.ts](src/shared/ui-choice.ts) にあります。
- 切り替える方法は 3 つあります。
  - 今の画面の「設定 → 一般 → この端末で M3E の画面を使う」
  - M3E の画面の「今の画面に戻す」ボタン
  - URL の `?ui=m3e` と `?ui=classic`。どちらかの画面が壊れたときの戻り道です。
- `/` の経路を横取りする方法は使っていません。今の画面を返す処理（fallback）を外から呼び出せないためです。

## 仕組み

- **サーバー側**（[src/host/index.ts](src/host/index.ts)）: `/m3e` を prefix 経路として登録し、上の切り替えスクリプトを差し込みます。画面本体は、今の UI と同じ `authorizeIndex`（ログイン確認）と `renderIndex`（起動データの埋め込み）を通して返します。今の UI 向けの先読み指定は取り除きます。
- **今の画面に入る部品**（[src/client/index.tsx](src/client/index.tsx)）: 設定の一般セクション（`settings.general.item`）に切り替えの行を追加します。React は今の画面が持っているものを使います。M3E の画面はこの部品を読み込みません。
- **ブラウザ側の起動**（[web/src/dsh/boot.ts](web/src/dsh/boot.ts)）: DSH が埋め込む `__DSH_BOOT__` には、今の UI の部品を含む約 50 個のプラグインが並んでいます。そこから通信用の 8 個（`TRANSPORT_PLUGINS`）と、その依存だけを残して起動します。残したプラグインは 1 個ずつ個別の URL で読み込みます。DSH は、宣言していない組み合わせの一括 URL には 404 を返すためです。
- **共有ライブラリ**: 今の UI は、プラグインが外部参照する `@deepseek-ai/cordis` と `@deepseek-ai/dsh-client-store` を自分のビルドから渡しています。この UI では、同じものを自前で同梱して渡します。**版は本番 DSH と合わせる必要があります**（今は 0.1.5-rc.2 に固定しています）。

## ビルドで補っていること

- `@deepseek-ai/dsh-client-store` は zustand と immer を使っていますが、依存関係として宣言していません。そのため [pnpm-workspace.yaml](pnpm-workspace.yaml) の `packageExtensions` で補っています。
- `@deepseek-ai/cordis-plugin-loader` は、読み込まれた時点で Node.js の内部 API を探しに行きます。そのため [vite.config.ts](vite.config.ts) で `node:module` を代わりのファイルに差し替え、`process.versions.node` を `"0"` に置き換えています。

## コマンド

```bash
pnpm install
pnpm test        # 起動データの絞り込み、サーバーの経路、切り替えの判定の単体テスト
pnpm typecheck
pnpm build       # dist/（M3E の画面）、lib/index.js（サーバー側）、lib/client.js（今の画面に入る部品）
```

DSH に入れる手順は次のとおりです。

```bash
pnpm pack
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

入れ直すときは package.json の version を上げてください。同じ版のままだと、pnpm が古いファイルを使い続けます。DSH を再起動すると、`http://<host>/m3e/` で開けます。先に `/` で一度ログインして、Cookie を持った状態にしておく必要があります。
