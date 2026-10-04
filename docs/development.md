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

- **サーバー側**（[src/host/index.ts](../src/host/index.ts)）: `/m3e` を prefix 経路として登録し、上の切り替えスクリプトを差し込みます。画面本体は、今の UI と同じ `authorizeIndex`（ログイン確認）と `renderIndex`（起動データの埋め込み）を通して返します。標準画面向けの相対 URL の先読み指定を取り除き、M3E の index には `<base href="/">` を入れます。通信は Host のルート、画面遷移は `/m3e/` を基準にします。
- **今の画面に入る部品**（[src/client/index.tsx](../src/client/index.tsx)）: 設定の一般セクション（`settings.general.item`）に切り替えの行を追加します。React は今の画面が持っているものを使います。M3E の画面はこの部品を読み込みません。
- **ブラウザ側の起動**（[web/src/dsh/boot.ts](../web/src/dsh/boot.ts)）: DSH が埋め込む `__DSH_BOOT__` から、ジョブの controller を含む通信用の `TRANSPORT_PLUGINS` と、その依存だけを残して起動します。残したプラグインは個別の URL で読み込みます。DSH は、宣言していない組み合わせの一括 URL には 404 を返すためです。
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
pnpm exec playwright test -c e2e/playwright.config.ts   # ?mock の画面。専用 Vite を自動で起動
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts   # 実 DSH と偽の LLM
```

## 試験の使い分け

| 試験 | 確かめる対象 | 起動・ポート |
|---|---|---|
| `pnpm test` | 変換、参照の寿命、偽 controller、各機能の単体試験 | DSH やブラウザは起動しません |
| `e2e/playwright.config.ts` | `?mock` の画面と操作 | Vite を `127.0.0.1:5191` で起動し、ブラウザは `http://localhost:5191` を使います |
| `e2e-dsh/playwright.config.ts` | 実 DSH の Host・通信と M3E。LLM は Messages 形式の偽物です | `127.0.0.1` の空きポートを自動で使います。Vite は使いません |

偽データ e2e は `reuseExistingServer: false` と `--strictPort` を使います。既定ポートが占有されている場合は、既存サーバーを流用せず、`e2e/playwright.config.ts` を継承した `tmp/e2e-alt-port.config.ts` で `use.baseURL`、`webServer.command`、`webServer.port` を同じ空きポートにそろえます。試験条件は変えません。今回の移行では、まとめ側が 5192、段階 5 の worktree が 5194 を使いました。一時設定は Git 管理外なので、新しい worktree にあるとは限りません。

```bash
pnpm exec playwright test -c tmp/e2e-alt-port.config.ts
```

実 DSH の試験は、初回だけ指定版を npm から `tmp/dsh-integration/` に入れます。M3E をビルド・pack し、試験用の新しい `HOME` と `DSH_HOME` で起動します。利用者の DSH は使いません。

| 環境変数 | 指定するもの |
|---|---|
| `M3E_DSH_VERSION` | 試す DSH の版。省略時は `src/shared/dsh-compat.ts` の対応版 |
| `M3E_DSH_DIR` | 入れ済みの DSH のディレクトリ（`node_modules/.bin/dsh` を含む場所） |
| `M3E_SKIP_BUILD=1` | 同じコードを直前にビルドした場合に限り、ビルドを省く指定。pack は行います |
| `M3E_CHROMIUM_PATH` | Chromium の実行ファイル。偽データ e2e と実 DSH の両方で使えます |

環境変数は `env M3E_DSH_VERSION=… pnpm exec …` の形で渡します。試験用 Host の `DEEPSEEK_BASE_URL`、架空の API キー、`SSH_CONNECTION` は `e2e-dsh/dsh-host.ts` が設定します。

期限つき質問の spec は `e2e-dsh/timed-questions-fixtures.ts` を使います。`startDsh(llm.url, { timedQuestionSeconds: 2 })` が隔離ホームの `cordis.patch.yml` に専用 preset を置き、`dsh-tool-ask-user` の `mode: 'timed'` と `timeout: 2` を起動前に設定します。この項目は公開設定ではなく、設定 RPC からの変更ではありません。通常の legacy 質問とは別の Host を使い、追加の環境変数は不要です。全体実行にも含まれ、対象だけなら次のように実行します。

```bash
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts e2e-dsh/timed-questions.spec.ts e2e-dsh/timed-questions-hidden.spec.ts e2e-dsh/timed-questions-race.spec.ts
```

`fixture-contract.spec.ts` は偽記録と不正入力を、実物の V4・Session・commands・compaction の検査関数で照合します。この spec は既定の `tmp/dsh-integration/dsh-<版>/` から関数を読み込むため、`M3E_DSH_DIR` を指定しても、全体実行には既定の場所に同じ版が必要です。Host 上で全 fixture の会話を生成したという確認ではありません。

**フォルダ選択の方式に注意してください。** macOS / Windows の loopback 起動では、Host が OS のダイアログを使う `native` を選ぶ場合があります。統合試験は SSH 起動の印で `browse` を選び、ブラウザのフォルダ一覧を操作します。実際に SSH 接続するわけではなく、bind は `127.0.0.1` のままです。この構成では open-in-app の候補が空になるため、native のフォルダ選択や外部アプリ起動の確認には使えません。

Playwright は途中で中断せず、Host・偽 LLM・Vite の終了処理まで待ちます。対象を絞る場合は、実行の最初からファイルや `-g` を指定してください。結果は偽データが `tmp/e2e-report.json`、実 DSH が `tmp/dsh-integration/report.json` に出ます。

最新の件数と確認範囲は [互換性文書の版ごとの確認結果](dsh-compatibility.md#版ごとの確認結果) と [実 DSH の統合試験](dsh-compatibility.md#実-dsh-の統合試験) にまとめます。実 DSH の通常成功と既知の差の期待失敗を分け、偽データの成功を実 DSH の成功に数えません。追加・変更した試験は、同文書の[壊して確かめる手順](dsh-compatibility.md#試験の強さの確かめ方)でも確認します。文書だけの変更では試験・ビルドを流さず、記述・リンク・差分を確認します。

## 偽データの選び方

開発用の状態は URL で選べます。

- `?mock`：3 ワークスペース、待機中と実行中の 2 セッション
- `?mock&scenario=disconnected`：接続切れ
- `?mock&scenario=reconnecting`：再接続中
- `?mock&scenario=approval-demo#/s/readme-review`：1 秒後に仮の承認シート
- `?mock&scenario=approval-demo#/s/readme-review/trace`：トレース表示中の承認

各機能は `web/src/dsh/mock/kit.ts` の `MockKit` を使い、自分の `mock.ts` の `extendMock(kit)` でデータやシナリオを追加できます。共通セッション `readme-review` と `approval-sheet` の履歴は変更せず、必要なセッションを追加してください。共有部品の引数と戻り値、静的調査の結果は [00 の実装メモ](design/00-foundation.md#実装メモ) にあります。

偽物も、実物の拒否条件・準備・参照・取消・通知に合わせます。現在の契約と残す差は [偽データの決まりと意図した簡略化](dsh-compatibility.md#偽データの決まりと意図した簡略化) を参照してください。V4 の見本を変えるときは [規則の対応表と表示期待値の再生成手順](../tests/helpers/s6b-v4-rules.md) を使い、対象履歴を消して通すことや、本体と同じ変換で期待値を作ることを避けます。

DSH に入れる手順は README の「入れ方」にあります。
