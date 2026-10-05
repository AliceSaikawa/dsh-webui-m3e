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
| `M3E_SKIP_BUILD=1` | 既存の明示的 build だけを省きます。pack と、その prepack の build・検査は必ず行います |
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

DSH に入れる手順は README の「Quick Start」にあります。

## 配布

公開名は `dsh-webui-m3e`、準備中の版は **0.0.8**、対応する DSH は **0.2.0-rc.2 のみ**です。0.0.7 は以前配布した内容と main の内容が異なるため、その番号を再利用しません。npm 公開・タグ・GitHub Releases・CI の追加は今回行っていません。

配布判定の単体試験 16 件と各試験の変異検証を追加し、稼働中の追加・更新・旧版復帰・削除とデータ保持を隔離環境で手動確認しました。`e2e-dsh/dsh-host.ts` の単独パッチと、代替の `e2e-dsh/plugin-cli.ts` の追加は、それぞれ 1 回試して保護フックに拒否されました。同じ変更を別手段で再試行していません。利用者の指定した代替手順に従い、導入ライフサイクルの自動の試験は無いまま、下記の手動結果を残しています。公開権限・2 要素認証は公開する人の環境で確認が必要です。

### ソースからのビルドと配布物の検査

```bash
git clone https://github.com/AliceSaikawa/dsh-webui-m3e.git
cd dsh-webui-m3e
pnpm install --frozen-lockfile
pnpm build
pnpm run check:pack
pnpm pack --pack-destination tmp/release
node scripts/check-pack.ts tmp/release/dsh-webui-m3e-0.0.8.tgz
```

Node.js・pnpm・npm と `tar` が必要です。開発では TypeScript ファイルを Node で直接実行するため、その実行に対応した Node を使います（今回の実行版は 26.7.0）。配布する JavaScript の最低 Node は従来どおり 22 です。最低版での追加検証はしていません。

`prepack` が build → check:pack の順に実行します。`pnpm pack` と `npm pack` の両方で実際に発火を確認しました。`npm publish` も同じ prepack を使うことは [npm の lifecycle の説明](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-operation-order)に基づきます。公開コマンド自体は実行していません。公開はソースのルートから行い、`--ignore-scripts` でこの仕組みを無効化しないでください。作成済み tgz をそのまま publish する経路には、再ビルドの保証はありません。

`check:pack` は実際に `npm pack --ignore-scripts --json` で `tmp/pack-check/run-*/` に tgz を作り、tar の一覧と許可したテキストの内容を調べます。内側だけ scripts を止めて prepack の再帰を避けています。引数で既存 tgz を渡せば、pnpm が作った実物にも同じ検査を行えます。判定は副作用のない `scripts/pack-contract.ts` の `validatePack` です。外側の pack は必ずビルドし、内側の check 単独は現在のビルド成果物を検査します。

検査対象は、package.json、Host/client の JS、HTML、JS/CSS assets、patch、LICENSE、3 言語 README の存在です。配布先の main/exports、package と patch の名前、bundle 宣言、実行時依存が空であること、利用者側の preinstall/install/postinstall/prepare が無いことも調べます。許可するファイルの一覧にないソース・試験・docs・tmp・設定・マップなどは拒否します。JS/CSS の sourceMappingURL と、配布テキストの利用者ホームの絶対パスも拒否します。

偽データは `web/src/main.tsx:12-13` の DEV 分岐からのみ読み、`web/src/dsh/mock/index.ts` が feature の mock を登録します。検査は `readme-review`、`approval-sheet`、`__m3eTest`、`createMockContext`、`mock/open-failed`、`/mock/` を成果物 JS の目印とします。本番のエラー案内にもある `?mock` という文字だけは拒否しません。Vite と build-plugin はソースマップを有効にしておらず、実際の 19 ファイルにもマップはありません。`tests/18-pack.test.ts` の 16 件が正常系と具体的なエラー文字列を確認します。通常の `pnpm test` に含まれます。

`e2e-dsh` の明示的 build と prepack の build が重なる状態です。解消パッチが拒否されたため、利用者の指定どおり二重ビルドを残しました。結果は変わらず、実行時間だけが増えます。`M3E_SKIP_BUILD=1` は既存の明示的 build を省く指定で、prepack のビルドと検査は省かれません。

### 版の上げ方

M3E の公開版は `package.json.version` だけを上げます。`src/shared/dsh-compat.ts` は対応 DSH と同梱ライブラリの宣言であり、M3E の公開版とは別です。DSH 自体を移行する場合だけ、[互換性文書の手順](dsh-compatibility.md#版を上げるときの手順)で共有ライブラリと宣言を揃えます。今回その関係、依存、ロックファイルは変更していません。公開済みの同じ版に別の成果物を載せる運用はしません。

### DSH CLI 0.2.0-rc.2 で確認したこと

確認日：2026-10-05。macOS 27.2（26B5086k）、Node.js 26.7.0、pnpm 11.17.0、npm 11.19.0。使用した実物は `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/.bin/dsh` です。HOME と DSH_HOME は `tmp/issue18-cli/` 以下、Host を起動した全体試験は既存の `e2e-dsh` の隔離環境です。利用者の DSH と 3081/3199 は使っていません。

表の `dsh` は上の実物の絶対パス、実行環境は次の形です。

```bash
env HOME="$PWD/tmp/issue18-cli/home" DSH_HOME="$PWD/tmp/issue18-cli/dsh-home" tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/.bin/dsh plugin --profile web --help
```

| コマンド・確認 | 実際の結果 |
|---|---|
| `dsh plugin --help` | exit 1、required option `--profile <name>` not specified |
| `dsh plugin --profile web --help` | exit 0、pnpm 11.17.0 の help。初回は web profile も初期化する |
| 同じ接頭辞で `add --help`、`remove --help`、`update --help` | pnpm の引数を表示。追加 add、削除 remove、更新 update/up。更新先を固定する案内には `add name@version` を使用 |
| `list dsh-webui-m3e --depth 0 --json` | dependencies の version と解決先を表示。導入前・削除後は dependencies が無い |
| `add file:<baseline/0.0.7.tgz>` → `add file:<copy/0.0.8.tgz>` → baseline を再追加 | すべて exit 0。一覧の version は 0.0.7 → 0.0.8 → 0.0.7。profile の直接参照が新しい tgz を向く |
| `remove dsh-webui-m3e` | exit 0。dependency と dsh.profile.bundles の M3E が消え、base と web-app は残る |
| `add dsh-webui-m3e` / `add dsh-webui-m3e@0.0.8` | exit 1、`ERR_PNPM_FETCH_404`、registry.npmjs.org の Not Found。成功は公開後の確認 |
| `--profile web-typo add file:<tgz>` | exit 0。base と M3E だけの別 profile が作られる。web-app は入らない。打ち間違いは自動検出されない |
| `--profile ../wrong list` | exit 1、invalid profile name とスタックトレース |
| 1 コマンドだけ `env PATH=/usr/bin:/bin … /absolute/node …/dsh/lib/bin.js plugin --profile web list` | exit 127、`pnpm was not found; install pnpm and make it available on PATH.`。環境設定は変更していない |

失敗時には `$DSH_HOME/profiles/<profile>/.plugin-manager/logs/operation-*/pnpm.log` の場所が表示されます。通常 CLI が選んだ pnpm は今回 `/opt/homebrew/bin/pnpm` でした。導入先は `$DSH_HOME/profiles/<profile>/node_modules`、書き換えるのは profile の package.json（dependencies と dsh.profile.bundles）、pnpm-lock.yaml、node_modules および処理記録です。共有ストアに古い成果物が物理的に残るかは調べておらず、直接参照が新しい版になることと区別します。

作業用 0.0.7 は main の DSH 0.2.0-rc.2 対応済みコードから作ったものです。以前配布した 0.0.7 の検証ではありません。0.0.8 の比較用 tgz は `tmp/issue18-cli/copy/package/` のコピーだけを編集して作り、リポジトリの版を試験のために往復させていません。

実物の根拠（以下は `node_modules/@deepseek-ai/` 内の相対パス）：

| 場所 | 確認した契約 |
|---|---|
| `dsh/lib/bin.js:115-125,234-236` | profile 必須、引数転送、runPlugin の exit code |
| `dsh/lib/plugin-BGnVfe_D.js:76-96` | CLI options、管理関数、pnpm 不在と診断先の表示 |
| `dsh-plugin-manager/lib/types/operations.d.ts:13-26` | 実行コマンド・引数・環境を渡せる型。既定は PATH の pnpm |
| 同 `operations.js:43-72,246-275,325-331,444-536` | bundle の追加・削除、profile cwd、同梱コードの書換えではなく profile の依存を管理 |
| `dsh-app-boot/lib/index.js:524-587` | profile 名の検査、テンプレート、新規 profile の初期化 |
| `dsh-hmr/lib/index.js:353-376` | manifest は bundle の名前の列が変わらないと refresh を省く。手動確認でも、版だけの更新・復帰では Host コードの反映に再起動が必要だった |

[上流 CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#plugin-management)の PATH 上の pnpm・引数転送は実物と一致します。ただし master の「update で bundle 宣言を得た依存も有効になる」という説明と、実物の reconcile が既存の beforeDeps を skip する点は一致しません。M3E は最初から bundle 宣言を持ちます。[配布ガイド](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)の省略形 `dsh plugin add` には実物で必須の `--profile` を補います。Issue の 0.1.5 の記述は今回 0.2.0-rc.2 に読み替えています。Desktop の同梱経路は[上流の説明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)への参照だけで、実物は未検証です。

### 保持の確認範囲と残る検証

隔離 CLI で、home の cordis.patch.yml に別の組込みプラグイン `time-context` の `timeZone: Asia/Tokyo`、profile の cordis.patch.yml に確認用内容、profile の package.json に無関係な独自フィールドを置きました。追加 → 新版 tgz への入れ直し → 削除の各直後に、両 patch の完全一致と独自フィールドの保持を確認しました。これはファイル保持の確認で、当該設定を使う Host の実行や別の第三者プラグインの動作確認ではありません。

追加の手動確認では、既存の `startDsh` と偽 LLM を使い、新しい HOME と DSH_HOME（`tmp/dsh-integration/run-1791174147190/` 以下）で Host を loopback 起動しました。画面から workspace `home`、会話「Issue18 データ保持の確認」と偽 LLM の返答を作り、別の組込みプラグイン `@deepseek-ai/dsh-bash-sandbox` の `timeoutMs` を 61000 に変更して保存・再読み込みしました。利用者の環境は使っていません。

0.0.8 の実 tgz を基に、`tmp/issue18-lifecycle/next/package/` に版だけ 0.0.9 と HTML の目印を付けたコピー、`next10/package/` に版 0.0.10 と HTML の目印、Host の応答ヘッダー `x-issue18-host-version: 0.0.10` を付けたコピーを作りました。コピー内で `npm pack --ignore-scripts` を行い、リポジトリの版は 0.0.8 のままです。HTML の変化だけでは Host コードの更新を証明できないため、判定には後者のヘッダーを使いました。

| 操作（Host を動かしたまま実行） | 再起動前 | 再起動後 |
|---|---|---|
| 新版の tgz を `add file:` で再追加 | `/m3e/` 200、HTML は新版、Host の識別ヘッダーは無し（旧コード） | 200、HTML・Host のヘッダーとも新版 |
| 元の 0.0.8 tgz を再追加 | 200、HTML は元に戻るが、新版の Host ヘッダーが残る | 200、新版ヘッダーが消え、元の Host コードへ戻る |
| `remove dsh-webui-m3e` | `/m3e/` 404、標準画面 200。標準画面で同じ会話と返答を表示 | 404、標準画面 200。同じ会話と返答を表示 |
| 削除して再起動した未導入状態から新版 tgz を追加 | 200、新版 HTML と Host ヘッダー。会話と設定を表示 | 200、同じ内容を表示 |

全段階で標準画面の HTTP 200 を確認しました。更新・復帰の前後と再起動後に同じ会話の本文・返答を表示でき、シェルの待機時間 61000 も保持しました。削除中は profile の patch に同じ値が残り、再追加後も設定画面で 61000 を確認しています。workspace も標準画面の一覧と M3E に残りました。**この環境では追加・削除は再起動なしで反映され、更新・旧版復帰は Host コードを切り替えるため再起動が必要でした。** 判定記録は `tmp/issue18-lifecycle/evidence.json`、削除後の標準画面は `removed-classic.png` です。手動操作中のセレクター不一致と URL の `#` 重複は修正して再確認し、失敗した操作を成功には数えていません。

この導入ライフサイクルの自動の試験はありません。第三者プラグイン、長期利用の既存データ、本物の LLM、Desktop は未検証です。公開後は registry 経由でも下の手順を実行します。

手動確認で使うコマンドの形は次のとおりです。既存補助を Node REPL で起動し、表示された隔離 HOME を別端末の `read` に入力します（全体 e2e とは同時に動かさないでください。全体 e2e は古い `run-*` を片付けます）。

```bash
node --experimental-repl-await
```

```js
var { startFakeLlm } = await import('./e2e-dsh/fake-llm.ts')
var { startDsh } = await import('./e2e-dsh/dsh-host.ts')
var llm = await startFakeLlm()
var host = await startDsh(llm.url)
console.log(host.workspace)
var { chromium, expect } = await import('@playwright/test')
var { openM3e } = await import('./e2e-dsh/fixtures.ts')
var browser = await chromium.launch({ headless: false })
var page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await openM3e(page, host)
```

画面から上記の workspace・会話・設定を作ります。次は実際に使ったコピーのパスです。再実行時は同じ構成の作業用コピーを用意してください。

```bash
read M3E_TEST_HOME
dsh_lifecycle() {
  env HOME="$M3E_TEST_HOME" DSH_HOME="$M3E_TEST_HOME/../dsh-home" "$PWD/tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/.bin/dsh" "$@"
}
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-lifecycle/next10/package/dsh-webui-m3e-0.0.10.tgz"
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 画面とヘッダーを確認し、REPL の await host.restart() 後にも確認
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-lifecycle/dsh-webui-m3e-0.0.8.tgz"
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 前後を確認。削除前には標準画面 /?ui=classic を開く
dsh_lifecycle plugin --profile web remove dsh-webui-m3e
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 削除後と再起動後を確認してから、未導入状態へ再追加
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-lifecycle/next10/package/dsh-webui-m3e-0.0.10.tgz"
```

REPL で HTTP の結果を確認する例です。標準画面は削除前後に実際に開き、workspace と会話を選んで本文を確かめます。再起動は各段階の確認後に `await host.restart()`、認証と M3E の再表示は `await openM3e(page, host)` で行います。

```js
var response = await page.request.get(host.origin + '/m3e/')
console.log(response.status(), response.headers()['x-issue18-host-version'] ?? null)
await page.goto(host.origin + '/?ui=classic')
// すべて確認した後、既存補助の終了処理を待つ
await browser.close()
await host.stop()
await llm.close()
```

### 今回の検証結果

| 確かめ方 | 結果 |
|---|---|
| `pnpm typecheck` | 成功 |
| `pnpm test` | 1,027 件成功、skip なし。配布検査の新規 16 件を含む |
| `pnpm build` | 成功。既存のチャンクサイズ警告は残る |
| `pnpm exec playwright test -c tmp/e2e-alt-port.config.ts --global-timeout=600000` | 偽データ 159 件成功（約 4.3 分）、skip なし |
| `env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000` を 2 回 | 各 34 件が想定どおり。各回とも通常成功 33 件＋既知の差の期待失敗 1 件、予期しない失敗・skip なし（約 2.1 分／2.0 分） |
| `pnpm run check:pack`、pnpm と npm の実 tgz に `node scripts/check-pack.ts <tgz>` | 19 ファイルで成功 |
| `pnpm pack` と `npm pack` | 両方 prepack の build → check を実行。npm では `lib/index.js` を一時的な古い印に置き換えても、tgz には再ビルド済みのコードが入ることを確認 |
| `npm pack` の tgz を隔離 DSH に file: で追加 | exit 0、追加されたパッケージは M3E 1 個。利用側のビルドは走らない |
| 検査スクリプト 2 ファイルへの追加の TypeScript 検査 | 成功（既存の typecheck の対象外なので個別に確認） |

実 DSH の初回作業の結果は `tmp/issue18-cli/real-run-1.json` と `real-run-2.json`、今回の追加確認の結果は `tmp/issue18-lifecycle/real-run-1.json` と `real-run-2.json` に保存しています。`e2e-dsh` の成功は file: 導入後の `/m3e/` と通信の根拠です。npm レジストリの名前だけの成功や、導入ライフサイクルのデータ保持まで含めません。後者は上記の手動確認と区別しています。

次は初回作業で **tmp 内の実 tgz を壊して配布検査を直接実行した結果**です。すべて exit 1 で該当する理由を表示しました。これとは別に、追加した単体試験ごとの本体変異も下表のとおり確認しました。

| 壊したコピーの場所・内容 | 検出結果 |
|---|---|
| `dist/index.html` を tgz から外す | missing: dist/index.html |
| `vite.config.ts` を混ぜる | unexpected: vite.config.ts |
| package.json の name だけ変える | package/patch name mismatch |
| `lib/index.js` に `readme-review` を足す | mock code: lib/index.js |
| `lib/index.js` に利用者ホームの絶対パスを足す | absolute home path: lib/index.js |
| package.json に dependencies を足す | runtime dependencies: dependencies |
| package.json に install script を足す | consumer lifecycle: install |
| client の exports を存在しない JS に向ける | missing target: exports../client.default |
| package.json を private にする | private package |
| dsh.bundle を外す | missing bundle patch declaration |

破損コピーと結果は `tmp/issue18-cli/mutant-*/` に残しました。本体への破損変更は残していません。

`tests/18-pack.test.ts` の 16 件について、1 件ずつ `scripts/pack-contract.ts` の該当判定を一時的に外し、`node --experimental-strip-types --test --test-name-pattern='<対象試験名>' tests/18-pack.test.ts` が **AssertionError、exit 1** になることを確認しました。各回に本体を復元し、最後に元の内容との完全一致と 16 件すべての成功を確認しています。判定を外したのに成功する試験はありませんでした。

| 試験 | 一時的に壊した判定（pack-contract.ts の行） | 結果 |
|---|---|---|
| 正常な配布物と公開者側 prepack を許可 | 13: 必須ファイルを許可する分岐を無効化 | 落ちた・復元済み |
| 必須ファイル・3 言語 README | 25: 必須ファイルの欠落検査を外す | 落ちた・復元済み |
| JS と CSS assets | 27: assets の存在検査を外す | 落ちた・復元済み |
| 開発用ファイル・設定・マップ・不正パス | 30: 許可一覧の検査を外す | 落ちた・復元済み |
| sourceMappingURL | 33: マップ参照検査を外す | 落ちた・復元済み |
| 偽データの目印 | 34: mock 検査を外す | 落ちた・復元済み |
| 利用者の絶対パス | 32: ホームパス検査を外す | 落ちた・復元済み |
| 重複 | 37: 重複検査を外す | 落ちた・復元済み |
| 不正な manifest | 43: parse エラーの記録を外す | 落ちた・復元済み |
| private | 45: private 検査を外す | 落ちた・復元済み |
| package と patch の名前 | 47: 名前の照合を外す | 落ちた・復元済み |
| 実行時の依存 | 49: 依存検査を外す | 落ちた・復元済み |
| 利用者側 lifecycle | 52: lifecycle 検査を外す | 落ちた・復元済み |
| main | 56: main の参照先検査を外す | 落ちた・復元済み |
| exports | 61: exports の参照先検査を外す | 落ちた・復元済み |
| bundle の patch 宣言 | 64: bundle 宣言検査を外す | 落ちた・復元済み |

結果と各回のログは `tmp/issue18-mutations/report.json` と `1.txt`〜`16.txt` にあります。単体試験だけのパッチは通りました。Host 補助の単独パッチは `M3E_SKIP_BUILD` を含む環境変数参照行、代替補助は環境変数を展開する行が保護対象文字列に見えた可能性があります。フックは理由を「protected path or sensitive filename pattern」としか示さず、原因文字列は特定できていません。変異確認の最初の長いシェル呼び出しも形式を理由に拒否されましたが、共通の決まりで許可されたコマンド形式の修正だけを行い、tmp の作業スクリプトを直接実行しました。

Issue の受け入れ条件は次の状態です。

| 項目 | 判定 |
|---|---|
| 1. 公開名・権限・対応版と配布検査 | 満たせない（公開権限のみ）。名前・対応版・配布物の検査・単体 16 件と変異検証は完了。公開アカウントへの認証確認は範囲外なので、権限は公開する人が確認する |
| 2. クリーン環境で名前だけの導入 | 公開のあとでないと確かめられない。現在は 404。file: と `/m3e/` は確認済み |
| 3. pnpm と Desktop の前提・環境記録 | 満たした。通常 CLI の実物と環境を記録し、Desktop は上流リンクと未検証を明記 |
| 4. tgz からの移行・公開版の更新 | 公開のあとでないと確かめられない。ローカル tgz の版切替は成功。registry への参照切替、公開旧版→新版を追加確認する |
| 5. 設定・他プラグイン・会話の保持 | 満たした（隔離したローカル tgz の手動確認範囲）。1 workspace・1 会話と返答・別の組込みプラグインの設定を追加／更新／復帰／削除の前後で保持。第三者プラグインと長期利用データは未検証。registry 経由でも公開後に確認する |
| 6. 前提不足・誤プロファイル・取得失敗の案内 | 満たした。PATH 不足 127、404、無効名、打ち間違いによる別 profile 作成を再現し、確認先を記載 |
| 7. 旧版への復帰・削除・標準画面 | 満たした（ローカル tgz）。復帰は再起動後に旧 Host コードへ戻る。削除の前後と再起動後に標準画面と同じ会話を確認し、手順を 3 言語で更新。公開された旧版への復帰は公開後に追加確認する |

### 公開する人の手順

公開名が未登録だったことは公開権限の証明にはなりません。アカウント、名前を取得できること、アクセス権、2 要素認証は公開する人が自分の環境で確認します。ここではログイン・認証確認も実行していません。上記の手動確認範囲と残る未検証事項を確認し、次の検査を済ませてから公開します。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm run check:pack
pnpm exec playwright test -c tmp/e2e-alt-port.config.ts --global-timeout=600000
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000
pnpm pack --pack-destination tmp/release
node scripts/check-pack.ts tmp/release/dsh-webui-m3e-0.0.8.tgz
mkdir -p tmp/release-npm
npm pack --pack-destination tmp/release-npm
node scripts/check-pack.ts tmp/release-npm/dsh-webui-m3e-0.0.8.tgz
```

すべてを確認した公開者だけが、リポジトリのルートで次を実行します。この作業では実行していません。

```bash
npm publish
```

### 公開のあとに確かめること

以下は公開後の実行手順であり、成功済みの記録ではありません。DSH 0.2.0-rc.2 が上記 tmp にある開発環境で、未使用の `tmp/npm-smoke/` を用意します。既に存在する場合は新しい名前を選びます。既存の利用者環境をコピーしません。

```bash
mkdir -p tmp/npm-smoke/home tmp/npm-smoke/dsh-home
```

一つ目の端末で偽 LLM を起動し、表示された loopback URL を控えます。完了後は Ctrl+C で終了します。

```bash
node --input-type=module -e 'const {startFakeLlm}=await import("./e2e-dsh/fake-llm.ts"); const llm=await startFakeLlm(); console.log(llm.url); process.on("SIGINT",async()=>{await llm.close(); process.exit(0)})'
```

二つ目の端末で `read` にその URL を入力し、隔離した CLI を定義します。初回追加は版も file: も付けず、名前だけで行います。

```bash
read M3E_FAKE_URL
dsh_smoke() {
  env HOME="$PWD/tmp/npm-smoke/home" DSH_HOME="$PWD/tmp/npm-smoke/dsh-home" DEEPSEEK_API_KEY=fake-key-for-m3e-integration DEEPSEEK_BASE_URL="$M3E_FAKE_URL" SSH_CONNECTION=m3e-integration "$PWD/tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/.bin/dsh" "$@"
}
dsh_smoke plugin --profile web add dsh-webui-m3e
dsh_smoke plugin --profile web list dsh-webui-m3e --depth 0 --json
dsh_smoke web --no-open --host 127.0.0.1 --port 0
```

表示された標準画面のログイン URL をブラウザで開いてから同じ origin の `/m3e/` を開きます。workspace を一つ追加し、会話を一つ作って偽 LLM の返答まで保存します。別プラグインの設定も一つ保存し、その値・workspace・会話の本文を控えます。Host を Ctrl+C で正常終了してから、次の操作を一段階ずつ行い、その都度上の web コマンドで再起動して同じ内容が残ることを確認します。

```bash
# ローカル tgz から registry への移行：手元の互換版 tgz を使う
dsh_smoke plugin --profile web add "file:$PWD/tmp/release/dsh-webui-m3e-0.0.8.tgz"
dsh_smoke plugin --profile web add dsh-webui-m3e@0.0.8
dsh_smoke plugin --profile web list dsh-webui-m3e --depth 0 --json

# 2 つ以上の互換版が公開された後、旧版と新版を入力する
read M3E_PREVIOUS_VERSION
read M3E_NEW_VERSION
dsh_smoke plugin --profile web add "dsh-webui-m3e@$M3E_PREVIOUS_VERSION"
dsh_smoke plugin --profile web add "dsh-webui-m3e@$M3E_NEW_VERSION"
dsh_smoke plugin --profile web list dsh-webui-m3e --depth 0 --json
# 旧版へ戻す
dsh_smoke plugin --profile web add "dsh-webui-m3e@$M3E_PREVIOUS_VERSION"
dsh_smoke plugin --profile web list dsh-webui-m3e --depth 0 --json
# 標準画面へ切り替えてから終了・削除
dsh_smoke plugin --profile web remove dsh-webui-m3e
dsh_smoke plugin --profile web list dsh-webui-m3e --depth 0 --json
dsh_smoke web --no-open --host 127.0.0.1 --port 0
```

削除後は新しく表示された URL で標準画面にログインし、`/?ui=classic` で同じ workspace・会話・設定を確認します。第三者プラグインの依存と動作、長期利用データも別途検証してください。初回の 0.0.8 公開だけでは「公開された旧版から新版」の検証は完了しません。以前配布した別内容の 0.0.7 を、0.2.0-rc.2 の互換旧版と見なしてはいけません。
