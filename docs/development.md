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

**0.0.8 は未公開。マージと公開は続けて行います。公開までは、名前だけでの追加は 404 になります。** README は npm に掲載する公開後の利用手順として書いています。公開状況と検証記録はこの文書、`dsh-compatibility.md`、`handoff.md` で管理します。

配布判定の単体試験はレビュー対応で 26 件になり、監査の 35 変異と追加の 11 変異をすべて検出しました。稼働中の追加・更新・旧版復帰・削除とデータ保持は、前回の隔離環境での手動確認を引き継ぎます。`e2e-dsh/dsh-host.ts` の単独パッチと、代替の `e2e-dsh/plugin-cli.ts` の追加は前回、それぞれ 1 回試して保護フックに拒否されました。同じ変更を別手段で再試行していません。利用者の指定した代替手順に従い、導入ライフサイクルの自動の試験は無いまま、下記の手動結果を残しています。公開権限・2 要素認証は公開する人の環境で確認が必要です。

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

Node.js・pnpm・npm と `tar` が必要です。開発では TypeScript ファイルを Node で直接実行するため、その実行に対応した Node を使います。確認環境は macOS 27.2（26B5086k）、Node 26.7.0、pnpm 11.17.0、npm 11.19.0 です。DSH 0.2.0-rc.2 自身の manifest に engines はありませんが、CLI の commander 15.0.0 は Node `>=22.12.0`、pnpm 11.17.0 は `>=22.13` を宣言しています。最低版での実行は未検証であり、M3E が Node 22 の初期版から動くとは案内しません。

M3E の根拠が不足していた `engines.node: >=22` は削除しました。M3E の実行時 dependencies は空で、依存側の宣言と M3E の検証済み下限は別です。根拠は隔離 DSH の `node_modules/commander/package.json:60` と通常 CLI の pnpm の `package.json:63`、`bin/pnpm.mjs:6-18`。tmp の依存無し tgz に試験用 `engines.node: >=99` を付けて Node 26.7.0 の pnpm 11.17.0 で追加すると、既定では警告無し・exit 0、`--config.engine-strict=true` では `ERR_PNPM_UNSUPPORTED_ENGINE`・exit 1 でした。engines を書くだけで動作確認の代わりにはならず、未確認の下限で利用を拒むことも避けるため、今回は新しい下限を宣言していません。

`prepack` が build → check:pack の順に実行します。`pnpm pack` と `npm pack` の両方で実際に発火を確認しました。`npm publish` も同じ prepack を使うことは [npm の lifecycle の説明](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-operation-order)に基づきます。公開コマンド自体は実行していません。公開はソースのルートから行い、`--ignore-scripts` でこの仕組みを無効化しないでください。作成済み tgz をそのまま publish する経路には、再ビルドの保証はありません。

`check:pack` は実際に `npm pack --ignore-scripts --json` で `tmp/pack-check/run-*/` に tgz を作り、tar の一覧と許可したテキストの内容を調べます。内側だけ scripts を止めて prepack の再帰を避けています。引数で既存 tgz を渡せば、pnpm が作った実物にも同じ検査を行えます。判定は副作用のない `scripts/pack-contract.ts` の `validatePack` です。外側の pack は必ずビルドし、内側の check 単独は現在のビルド成果物を検査します。

検査対象は、package.json、Host/client の JS、HTML、JS/CSS assets、patch、LICENSE、3 言語 README の存在です。配布先の main/exports、package と patch の名前、bundle 宣言、実行時依存が空であること、利用者側の preinstall/install/postinstall/prepare が無いことも調べます。許可するファイルの一覧にないソース・試験・docs・tmp・設定・マップなどは拒否します。JS/CSS の sourceMappingURL と、配布テキストの利用者ホームの絶対パスも拒否します。

Vite 7.3.6 の既存成果物は `index-BL75o79i.js`、`index-2YhsQp64.css`、`material-symbols-outlined-DzyP15l8.woff2` でした。`vite.config.ts` に `[name]-[hash:8]` の出力形式を明記し、assets の許可条件も名前＋8文字ハッシュと小文字の js/css/woff2 に限定しました。開発用のドット入りの名前、サブディレクトリ、想定外の拡張子は拒否します。出力設定を変える際は正常系の fixture と許可条件も見直し、実 tgz の `check:pack` を通してください。tgz の生の名前は純粋関数 `parsePackEntries` で先に検査し、`package/` 外のファイル・ディレクトリを、内容を読まずに `invalid archive root` で拒否します。

偽データの起動は `web/src/main.tsx:12-13` の DEV 分岐から行い、`web/src/dsh/mock/index.ts` が feature の mock を登録します。Vite の `productionModuleGuard` は、生成チャンクの `modules` に偽データ用モジュールが 1 つでもあればビルドを止めます。対象は `web/src/dsh/mock/` と、features 内の `mock*.ts(x)`、`*-mock*.ts(x)`、`*-fixtures.ts(x)`。現在の 30 ファイル全件を `tests/18-pack.test.ts` の一覧で照合し、Windows の区切りと query 付き id も検査します。

唯一の例外は `web/src/dsh/mock/observable.ts` です。このファイルは通知・購読・スナップショットの汎用処理だけを持ち、偽 workspace・controller・記録は生成しません。本番の `completion-status.ts:2` と `conversation-selection.ts:2` が利用しているため、ファイル名の完全一致だけを許可しています。同じ場所の別名ファイルは拒否します。

tgz 内でも `readme-review`、`approval-sheet`、`__m3eTest`、`createMockContext`、`mock/open-failed`、`/mock/` を JS の目印として検査します。これはモジュール検査を補うもので、目印だけに依存しません。本番の案内にもある `?mock` の文字だけは許可します。Vite と build-plugin はソースマップを有効にしておらず、実際の 19 ファイルにもマップはありません。`tests/18-pack.test.ts` の 26 件が正常系と具体的なエラー文字列を確認し、通常の `pnpm test` に含まれます。

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

#### 比較用 tgz を再現する

リポジトリのルートで、未使用の `tmp/issue18-compare/` を使います。元の版は 0.0.8 のまま、コピーだけを試験用の 0.0.10 にします。既存のフォルダがある場合は全コマンドで別の名前に揃えてください。このコピーは公開しません。

```bash
mkdir -p tmp/issue18-compare/next
pnpm pack --pack-destination tmp/issue18-compare/base
tar -xzf tmp/issue18-compare/base/dsh-webui-m3e-0.0.8.tgz -C tmp/issue18-compare/next
```

`tmp/issue18-compare/make-copy.mjs` に次を保存します。HTML の `<head>` と Host の 2 箇所の 200 応答だけに印を付け、想定した差分を当てられない場合は停止します。

```js
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const dir = new URL('./next/package/', import.meta.url)
const read = path => readFileSync(new URL(path, dir), 'utf8')
const write = (path, text) => writeFileSync(new URL(path, dir), text)
const manifest = JSON.parse(read('package.json'))
assert.equal(manifest.version, '0.0.8')
const html = read('dist/index.html')
assert.equal(html.split('<head>').length, 2)
const host = read('lib/index.js')
const response = 'res.writeHead(200, {'
assert.equal(host.split(response).length - 1, 2)
manifest.version = '0.0.10'
write('package.json', JSON.stringify(manifest, null, 2) + '\n')
write('dist/index.html', html.replace('<head>', '<head><meta name="issue18-copy-version" content="0.0.10">'))
write('lib/index.js', host.replaceAll(response, response + ' "x-issue18-host-version": "0.0.10",'))
```

```bash
node tmp/issue18-compare/make-copy.mjs
cd tmp/issue18-compare/next/package
npm pack --ignore-scripts
cd ../../../..
```

ここだけ `--ignore-scripts` を使うのは、ビルド済みの比較用コピーの印を保持するためです。公開用の pack/publish では使いません。元の tgz は `base/dsh-webui-m3e-0.0.8.tgz`、比較用は `next/package/dsh-webui-m3e-0.0.10.tgz` です。この作成手順はレビュー対応時にそのまま実行し、コピーの版・HTML の印・Host の 2 箇所の印と、リポジトリの版が 0.0.8 のままであることを確認しました。前回の Host 実測では、新版への更新直後は HTML の meta だけが変わり、再起動後に Host ヘッダーも `0.0.10` になりました。元へ戻すときは逆に、再起動まで新版のヘッダーが残りました。

#### 同じ環境で追加・更新・復帰・削除する

既存補助を Node REPL で起動し、表示された隔離 HOME を別端末の `read` に入力します（全体 e2e とは同時に動かさないでください。全体 e2e は古い `run-*` を片付けます）。

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

画面から上記の workspace・会話・設定を作ります。次は直前の手順で作った比較用 tgz を使います。コマンドを一段階ずつ実行し、上の結果表どおりに再起動の前後を確認してください。

```bash
read M3E_TEST_HOME
dsh_lifecycle() {
  env HOME="$M3E_TEST_HOME" DSH_HOME="$M3E_TEST_HOME/../dsh-home" "$PWD/tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/.bin/dsh" "$@"
}
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-compare/next/package/dsh-webui-m3e-0.0.10.tgz"
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 画面とヘッダーを確認し、REPL の await host.restart() 後にも確認
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-compare/base/dsh-webui-m3e-0.0.8.tgz"
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 前後を確認。削除前には標準画面 /?ui=classic を開く
dsh_lifecycle plugin --profile web remove dsh-webui-m3e
dsh_lifecycle plugin --profile web list dsh-webui-m3e --depth 0 --json
# 削除後と再起動後を確認してから、未導入状態へ再追加
dsh_lifecycle plugin --profile web add "file:$PWD/tmp/issue18-compare/next/package/dsh-webui-m3e-0.0.10.tgz"
```

REPL で HTTP の結果を確認する例です。標準画面は削除前後に実際に開き、workspace と会話を選んで本文を確かめます。再起動は各段階の確認後に `await host.restart()`、M3E が入っている段階の認証と再表示は `await openM3e(page, host)` で行います。削除中は M3E を開かず、`await page.goto(host.loginUrl)` の後に `await page.goto(host.origin + '/?ui=classic')` で標準画面へ入ります。

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
| `pnpm test` | 1,037 件成功、skip なし。配布検査 26 件を含む |
| `pnpm build` | 成功。既存のチャンクサイズ警告は残る |
| `pnpm exec playwright test -c tmp/e2e-alt-port.config.ts --global-timeout=600000` | この worktree 指定の 5218 で偽データ 159 件成功（約 5.6 分）、skip なし。公開者用の既定手順は下記の管理済み設定を使う |
| `env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000` を 2 回 | 各 34 件が想定どおり。各回とも通常成功 33 件＋既知の差の期待失敗 1 件、予期しない失敗・skip なし（約 3.1 分／3.0 分） |
| `pnpm run check:pack`、pnpm と npm の実 tgz に `node scripts/check-pack.ts <tgz>` | 19 ファイルで成功 |
| `pnpm pack` と `npm pack` | 修正後も両方で prepack の build → check を実行し、外側の tgz も各 19 ファイルで成功。初回作業では古い印を付けた `lib/index.js` が再ビルドされることも確認 |
| `npm pack` の tgz を隔離 DSH に file: で追加（初回作業） | exit 0、追加されたパッケージは M3E 1 個。利用側のビルドは走らない |
| 検査スクリプト 2 ファイルへの追加の TypeScript 検査（初回作業） | 成功。`scripts` と `tests` は `tsconfig.host.json` の include にあり、通常の `pnpm typecheck` の対象にも含まれる |

実 DSH の初回作業の結果は `tmp/issue18-cli/real-run-1.json` と `real-run-2.json`、手動確認を追加した時点は `tmp/issue18-lifecycle/real-run-1.json` と `real-run-2.json`、レビュー修正後の今回の結果は `tmp/issue18-review/real-run-1.json` と `real-run-2.json` に保存しています。`e2e-dsh` の成功は file: 導入後の `/m3e/` と通信の根拠です。npm レジストリの名前だけの成功や、導入ライフサイクルのデータ保持まで含めません。後者は上記の手動確認と区別しています。

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

以下は初回追加確認（`2ade474`）時点の 16 件の記録です。1 件ずつ `scripts/pack-contract.ts` の該当判定を一時的に外し、`node --experimental-strip-types --test --test-name-pattern='<対象試験名>' tests/18-pack.test.ts` が **AssertionError、exit 1** になることを確認しました。各回に本体を復元し、最後に元の内容との完全一致と 16 件すべての成功を確認しています。この後の独立監査で入力の境界不足が見つかったため、レビュー対応で下記の確認を追加しました。行番号は初回時点のものです。

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

#### レビューと独立監査の指摘への対応

監査で生存した M04/M05/M07/M14/M22/M35 を含め、35 変異を修正後の本体に当て直し、すべて検出しました。追加の 11 変異も検出し、計 46/46 が AssertionError・exit 1 です。M05/M07 は新しいハッシュ付きの名前でもサブディレクトリ／txt を許可する同じ変更、M35 は同一行の空白を必須から任意にする同じ変更を適用しました。1 変異ごとに `git restore` し、修正済みの本体との完全一致を確認しています。

以下は 26 試験それぞれを実際に落とした変更です。未変更の試験も含めて当て直しました。場所は原則 `scripts/pack-contract.ts`、最後の 2 件は `scripts/production-modules.ts` です。

| 試験 | 本体を一時的に壊した箇所・内容 | 検出 |
|---|---|---|
| 正常系・prepack・固定公開ファイル | M04: 許可一覧から sw.js を除く | exit 1 |
| 必須ファイル | M02: 必須ファイル検査を除く | exit 1 |
| JS/CSS 必須 | M08: assets の存在検査を除く | exit 1 |
| 開発用ファイル・設定・map | M10: 許可パス検査を除く | exit 1 |
| 空白・タブを含む sourceMappingURL（JS/CSS） | M14: 空白を扱わない式にする。M15: CSS を検査しない | exit 1 |
| 偽データの目印 | M16: JS を検査しない | exit 1 |
| 利用者の絶対パス | M12: Windows の検査を除く | exit 1 |
| 重複 | M18: 重複検査を除く | exit 1 |
| 不正 manifest | M20: parse エラーの記録を除く | exit 1 |
| private | M21: true/false を反転 | exit 1 |
| package/patch の名前 | M23: 名前の一致検査を除く | exit 1 |
| 実行時依存 | M25: 非空の依存を許可 | exit 1 |
| 利用者側 lifecycle | M27: prepare を許可 | exit 1 |
| main の参照先 | M28: ファイル存在検査を除く | exit 1 |
| exports の参照先 | M31: 先頭の export だけを検査 | exit 1 |
| bundle 宣言 | M34: patch 宣言検査を除く | exit 1 |
| assets 内の開発用の名前 | N01: ハッシュを要求せずドットも許可 | exit 1 |
| assets の下の階層・拡張子 | M05: スラッシュを許可。M07: txt を許可 | exit 1 |
| file URL のホームパス | N04: file URL の検査を除く | exit 1 |
| Windows の大小文字 | N05: 大小文字を区別する式にする | exit 1 |
| patch の name が 2 件 | M22: name の件数検査を除く | exit 1 |
| 字下げのない name（先頭改行も確認） | M35: 字下げを任意にする | exit 1 |
| 正常な生の tar 名と directory record | N03: directory record をファイル扱いにする | exit 1 |
| package/ 外の生の tar 名 | N02: package/ 必須検査を除く | exit 1 |
| 偽モジュール 30 ファイル | N06/N07: shared/feature の判定を除く。N09: Windows 正規化を除く | exit 1 |
| 本番モジュールと observable の例外 | N08: 例外を除く。N11: 例外を別名ファイルにも広げる | exit 1 |

記録は `tmp/issue18-review/mutations/report.json` と各 ID のログです。実 tgz も、監査で通った A12 と、新しく作った package/ 外のハッシュ付き JS、ルートの lib/index.js への置換、assets 内の example.test.js の計 4 件をすべて exit 1 で拒否しました。ルート違反は `invalid archive root`、開発用 JS は `unexpected` です。

モジュール検査の実物確認として、本番の `web/src/main.tsx` に `applyMockOperations` の import と `Object.assign(globalThis, { issue18InjectedMock: applyMockOperations })` を一時追加しました。`pnpm run build:web` は `mock module in production: …/features/settings/mock-mutations.ts` を示して exit 1 になりました。単なる未使用 import ではなく、出力に残る参照を作って確認しています。直後に `git restore web/src/main.tsx` で戻し、通常の build 成功を確認しました。

Issue の受け入れ条件は次の状態です。

| 項目 | 判定 |
|---|---|
| 1. 公開名・権限・対応版と配布検査 | 満たせない（公開権限のみ）。名前・対応版・配布物の検査・単体 26 件、46 変異、偽モジュール混入によるビルド失敗は確認済み。公開アカウントへの認証確認は範囲外なので、権限は公開する人が確認する |
| 2. クリーン環境で名前だけの導入 | 公開のあとでないと確かめられない。現在は 404。file: と `/m3e/` は確認済み |
| 3. pnpm と Desktop の前提・環境記録 | 満たした。通常 CLI・commander・pnpm の宣言と実測環境を区別し、Node 下限の保証を撤回。Desktop は上流リンクと未検証を明記 |
| 4. tgz からの移行・公開版の更新 | 公開のあとでないと確かめられない。ローカル tgz の版切替は成功。registry への参照切替、公開旧版→新版を追加確認する |
| 5. 設定・他プラグイン・会話の保持 | 満たした（隔離したローカル tgz の手動確認範囲）。1 workspace・1 会話と返答・別の組込みプラグインの設定を追加／更新／復帰／削除の前後で保持。第三者プラグインと長期利用データは未検証。registry 経由でも公開後に確認する |
| 6. 前提不足・誤プロファイル・取得失敗の案内 | 満たした。PATH 不足 127、404、無効名、打ち間違いによる別 profile 作成を再現し、確認先を記載 |
| 7. 旧版への復帰・削除・標準画面 | 満たした（ローカル tgz）。復帰は再起動後に旧 Host コードへ戻る。削除の前後と再起動後に標準画面と同じ会話を確認し、手順を 3 言語で更新。公開された旧版への復帰は公開後に追加確認する |

### 公開する人の手順

順番は **PR をマージ → main の先頭で下記の確認 → 公開者が npm publish → 公開後の確認 → 結果を文書へ記録**です。マージと公開は続けて行います。この作業ではマージ・認証・公開を行っていません。

公開者は npm のアカウント画面で公開に使うアカウントを確認し、[スコープ無しパッケージの公開手順](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)に沿って準備します。`npm view dsh-webui-m3e versions --json` で名前と公開済みの版を再確認し、既に名前が存在する場合は自分に公開権限があることも確認します。404 は名前が未登録であるという結果であり、権限の証明にはなりません。対話的な公開に備え、[2 要素認証の設定と公開時の確認](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)を公開者自身の環境で済ませてください。

PR をマージした後、新しく clone した main または更新済み main のルートで実行します。`git branch --show-current` が main、`git status --short` が空であることを確認し、`git rev-parse HEAD` と `git ls-remote origin refs/heads/main` のハッシュを照合します。異なる場合は公開せず、main の先頭を用意し直します。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm typecheck
pnpm test
pnpm build
pnpm run check:pack
pnpm exec playwright test -c e2e/playwright.config.ts --global-timeout=600000
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000
env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts --global-timeout=600000
pnpm pack --pack-destination tmp/release
node scripts/check-pack.ts tmp/release/dsh-webui-m3e-0.0.8.tgz
mkdir -p tmp/release-npm
npm pack --pack-destination tmp/release-npm
node scripts/check-pack.ts tmp/release-npm/dsh-webui-m3e-0.0.8.tgz
```

既定の 5191 が使用中の場合だけ、空きポートを選んで一時設定を用意します。たとえば 5218 が空いていれば `mkdir -p tmp` を行い、`tmp/e2e-alt-port.config.ts` に次を保存します。baseURL・command・port の数値はすべて同じ値に揃え、既存サーバーは流用しません。

```ts
import base from '../e2e/playwright.config.ts'
import { fileURLToPath } from 'node:url'
export default {
  ...base,
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  use: { ...base.use, baseURL: 'http://localhost:5218' },
  webServer: { ...base.webServer, command: 'pnpm exec vite --host 127.0.0.1 --port 5218 --strictPort', port: 5218 },
}
```

この場合だけ、確認の列の偽データ e2e を `pnpm exec playwright test -c tmp/e2e-alt-port.config.ts --global-timeout=600000` に置き換えます。新規 clone の既定手順は管理済みの設定だけで実行できます。

すべてを確認した公開者だけが、リポジトリのルートで次を実行します。この作業では実行していません。

```bash
npm publish
```

続けて次節の名前だけでの追加・版確認・`/m3e/`・削除と標準画面を確認します。完了したら README 以外の次の場所へ、公開日、版、main のハッシュ、実行環境、コマンド、結果、残る未検証事項を記録します。

| 更新する場所 | 更新する内容 |
|---|---|
| この文書の「配布」「今回の検証結果」「受け入れ条件」「公開のあとに確かめること」 | 未公開の注意を公開済みの事実へ更新し、公開後の結果と判定を追記。2026-10-05 の 404 は過去の実測として残す |
| `docs/dsh-compatibility.md` の「npm 配布版 0.0.8 の準備」 | 公開版の導入・更新・復帰で確認できた範囲と残件を更新 |
| `docs/handoff.md` の「npm 配布の準備」 | 公開日・版・検証結果と次に渡すことを更新 |

公開後に問題があれば、基本は版を上げて修正します。[npm の取り消しポリシー](https://docs.npmjs.com/policies/unpublish/)では、新規パッケージの公開から 72 時間以内でも、他の公開パッケージから依存されていないことが条件です。それ以後は、依存されていないことに加え、直近 1 週間のダウンロード数が 300 未満、所有者／管理者が 1 人という条件があります。取り消しても同じ名前と版の組合せは再利用できず、取り消し自体も戻せません。取り消せない場合の非推奨化も含め、公開者が公式の条件を確認して判断します。

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
