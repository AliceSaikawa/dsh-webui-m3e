# 開発者向けの説明

利用の方法は [README](../README.md) にあります。この文書は、仕組みと開発の方法をまとめたものです。設計書は [docs/design/](design/README.md)、画面の仕様は [docs/ui-spec.md](ui-spec.md) にあります。

開発中は `pnpm dev` のあと `http://localhost:5173/m3e/?mock` を開きます。DSH の起動は不要です。偽データは開発時だけ読み込まれ、本番ビルドには含まれません。`features/*/routes.tsx` と `features/*/mock.ts` は自動で集めるので、機能の担当は共有登録ファイルを編集する必要がありません。

## 端末ごとの切り替え

- この端末の選択は、Cookie `dsh-webui`（値は `m3e` か `classic`）に入っています。iPhone のホーム画面に追加した PWA は Safari と別の Cookie を持つので、別々に選べます。
- サーバーは、DSH が返すすべての index の `<head>` の先頭に、小さなスクリプトを差し込みます（`tapIndex`）。今の画面の index（`/` と `/index.html`）で Cookie が `m3e` なら、今の画面のコードを読み込む前に `/m3e/` へ移動します。判定は [src/shared/ui-choice.ts](../src/shared/ui-choice.ts) にあります。
- 切り替える方法は 3 つあります。
  - 今の画面の「設定 → 一般 → この端末で M3E の画面を使う」
  - M3E の画面の「今の画面に戻す」ボタン
  - URL の `?ui=m3e` と `?ui=classic`。どちらかの画面が壊れたときの戻り道です。
- `/` の経路を横取りする方法は使っていません。今の画面を返す処理（fallback）を外から呼び出せないためです。

## 仕組み

- **サーバー側**（[src/host/index.ts](../src/host/index.ts)）: `/m3e` を prefix 経路として登録し、上の切り替えスクリプトを差し込みます。画面本体は、今の UI と同じ `authorizeIndex`（ログイン確認）と `renderIndex`（起動データの埋め込み）を通して返します。今の UI 向けの先読み指定は取り除きます。
- **今の画面に入る部品**（[src/client/index.tsx](../src/client/index.tsx)）: 設定の一般セクション（`settings.general.item`）に切り替えの行を追加します。React は今の画面が持っているものを使います。M3E の画面はこの部品を読み込みません。
- **ブラウザ側の起動**（[web/src/dsh/boot.ts](../web/src/dsh/boot.ts)）: DSH が埋め込む `__DSH_BOOT__` には、今の UI の部品を含む約 50 個のプラグインが並んでいます。そこから通信用の 8 個（`TRANSPORT_PLUGINS`）と、その依存だけを残して起動します。残したプラグインは 1 個ずつ個別の URL で読み込みます。DSH は、宣言していない組み合わせの一括 URL には 404 を返すためです。
- **共有ライブラリ**: 今の UI は、プラグインが外部参照する `@deepseek-ai/cordis` と `@deepseek-ai/dsh-client-store` を自分のビルドから渡しています。この UI では、同じものを自前で同梱して渡します。**版は本番 DSH と合わせる必要があります**。対応する版と固定版は [src/shared/dsh-compat.ts](../src/shared/dsh-compat.ts) の 1 か所にまとめてあり、`package.json` と食い違うと `pnpm test` が止まります。
- **DSH との境界**: どこが DSH のどの部分に依存しているか、どの版で何を確かめたかは [dsh-compatibility.md](dsh-compatibility.md) にあります。起動の直後に、使う controller のメソッドが揃っているかを `web/src/dsh/contract.ts` で確かめます。

## ビルドで補っていること

- `@deepseek-ai/dsh-client-store` は zustand と immer を使っていますが、依存関係として宣言していません。そのため [pnpm-workspace.yaml](../pnpm-workspace.yaml) の `packageExtensions` で補っています。
- `@deepseek-ai/cordis-plugin-loader` は、読み込まれた時点で Node.js の内部 API を探しに行きます。そのため [vite.config.ts](../vite.config.ts) で `node:module` を代わりのファイルに差し替え、`process.versions.node` を `"0"` に置き換えています。

## コマンド

```bash
pnpm install
pnpm dev         # http://localhost:5173/m3e/?mock（DSH は起動しない）
pnpm test        # 既存のテストと、ルーター・承認/質問・セッション・偽データの単体テスト
pnpm typecheck
pnpm build       # dist/（M3E の画面）、lib/index.js（サーバー側）、lib/client.js（今の画面に入る部品）
pnpm exec playwright test -c e2e/playwright.config.ts   # ?mock の画面を幅 390px で操作する試験（開発サーバーは自動で起動）
pnpm exec playwright test -c e2e-dsh/playwright.config.ts   # 実物の DSH（偽の LLM）での統合試験。初回は DSH を npm から tmp/ に入れる
```

開発用の状態は URL で選べます。

- `?mock`：3 ワークスペース、待機中と実行中の 2 セッション
- `?mock&scenario=disconnected`：接続切れ
- `?mock&scenario=reconnecting`：再接続中
- `?mock&scenario=approval-demo#/s/readme-review`：1 秒後に仮の承認シート
- `?mock&scenario=approval-demo#/s/readme-review/trace`：トレース表示中の承認

各機能は `web/src/dsh/mock/kit.ts` の `MockKit` を使い、自分の `mock.ts` の `extendMock(kit)` でデータやシナリオを追加できます。共通セッション `readme-review` と `approval-sheet` の履歴は変更せず、必要なセッションを追加してください。共有部品の引数と戻り値、静的調査の結果は [00 の実装メモ](design/00-foundation.md#実装メモ) にあります。

DSH に入れる手順は README の「入れ方」にあります。
