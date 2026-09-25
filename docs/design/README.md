# 設計書の全体像と進め方

DSH（DeepSeek Harness）のスマートフォン向け M3E 画面を、機能ごとに分けて実装するための設計書です。Codex を複数のプロセスで並行に動かす前提で書いています。

2026-09-25 に、Canvas の最新版（`docs/canvas/merged.json`、41 画面）を現段階の決定としました。細かい見た目と文言は、実装したものを見てユーザーがフィードバックする形で詰めます。

## 読む順番

各プロセスは、次の順に読んでから作業を始めてください。

1. この文書
2. 担当の設計書（下の表）
3. `docs/ui-spec.md` のうち、担当の設計書が指す節
4. `docs/canvas/merged.json` のうち、担当の画面（設計書に画面の id を書いてあります）の `note`
5. 必要になったら、API の調査メモ `~/AI/inbox/2026-09-17-dsh-webui-m3e-api-surface.md`

Canvas の見た目と `docs/ui-spec.md` が食い違うときは、`docs/ui-spec.md` の「Canvas のモックと実装の違い」を正とします。

## 設計書の一覧と段階

| 段階 | 設計書 | 内容 | 並行 |
|---|---|---|---|
| 1 | [00-foundation.md](00-foundation.md) | 共通の土台。画面の枠、画面の切り替え、DSH との接続、シート、偽データ、各機能の仮の部品 | 1 本だけ |
| 2 | [01-home.md](01-home.md) | 一覧、ワークスペースの切り替え、フォルダの選択、セッションの操作 | 並行 |
| 2 | [02-chat.md](02-chat.md) | チャットタブ（メッセージの表示）、ツールの詳細、メッセージの操作 | 並行 |
| 2 | [03-composer.md](03-composer.md) | 入力欄、新しいセッション、＋ のシート、候補、添付、モデル、権限 | 並行 |
| 2 | [04-trace.md](04-trace.md) | トレースタブ、記録の詳細 | 並行 |
| 2 | [05-interactions.md](05-interactions.md) | ツール承認、AI からの質問、プランの確認のシート | 並行 |
| 2 | [06-inbox.md](06-inbox.md) | 対応待ちタブと件数のバッジ | 並行 |
| 2 | [07-search.md](07-search.md) | 検索タブ | 並行 |
| 2 | [08-settings.md](08-settings.md) | 設定タブ、DSH の設定、API キー、外観 | 並行 |
| 2 | [09-session-tools.md](09-session-tools.md) | 会話の ⋮ メニュー、統計、ファイル、ジョブ、サブエージェント、ゴール | 並行 |
| 2 | [10-pwa.md](10-pwa.md) | ホーム画面に追加する Web アプリの設定 | 並行 |
| 3 | [99-integration.md](99-integration.md) | 統合、実物の DSH での確認、Simulator での確認 | 1 本だけ |

段階 2 の各機能は、段階 1 が main に入ってから始めます。段階 2 の機能どうしは、互いの完成を待ちません。ほかの機能の部品は、段階 1 が作る「仮の部品」（決まった形の関数と、中身が空の画面）を通して使います。

## 並行作業の決まり

### 作業場所

- 1 つの機能に 1 つの git worktree と 1 つのブランチを使います。ブランチ名は `feat/<番号>-<名前>`（例：`feat/01-home`）です。
- worktree はリポジトリの外に作ります。例：`git worktree add ../dsh-webui-m3e-01 -b feat/01-home main`。そのあと、その中で `pnpm install` を実行します。
- main へのマージは統合の担当（段階 3）かユーザーが行います。各プロセスは自分のブランチにコミットするところまでです。

### 変更してよいファイル

- 各設計書の「担当するファイル」に書いたものだけを変更します。そこに書いていないファイルを変える必要が出たら、変えずに設計書の末尾の「実装メモ」に理由を書いて報告してください。
- 次のファイルは、段階 1 の担当以外は変更しません。
  - `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：依存を足すと、全部のブランチでロックファイルが衝突するためです。必要な依存は段階 1 でまとめて入れます。
  - `web/src/app/`、`web/src/dsh/`、`web/src/main.tsx`、`vite.config.ts`、`tsconfig*.json`
  - `docs/ui-spec.md`、`docs/canvas/`、ほかの機能の設計書
- 例外は [10-pwa.md](10-pwa.md) で、`web/index.html`、`web/public/`、`src/host/` の一部を担当します。
- 自分の設計書の末尾にある「実装メモ」には、分かったこと、決めたこと、未確認のまま残したことを書き足してください。統合の担当がこれを読みます。

### 画面と偽データの登録

共有のファイルを編集せずに済むように、段階 1 の土台は次のファイルを自動で集めます（Vite の `import.meta.glob`）。

- `web/src/features/<機能>/routes.tsx`：その機能の画面の URL と描き方
- `web/src/features/<機能>/mock.ts`：開発用の偽データ

各機能は自分のフォルダの中でこの 2 つを編集するだけで、画面と偽データを足せます。

### 画面の文言と見た目

- 画面の文言は日本語だけにします。多言語化はしません。
- 部品は `@m3e/react`（`@m3e/web` の React 版）を使います。色、角丸、余白は段階 1 のテーマに従い、各機能で色を直接書きません。
- アイコンは Material Symbols（段階 1 でフォントを同梱）の名前を使います。Canvas の `icon` の値がそのまま使えます。
- 外部の CDN、トラッカー、外部のフォントは使いません。

## 確かめ方

各機能の完了前に、次の 3 つを通してください。

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

加えて、ブラウザで確かめられる環境なら、`pnpm dev` を実行して `http://localhost:5173/m3e/?mock` を開き、幅 390px 前後で担当の画面を操作してください。`?mock` を付けると、DSH なしで偽データの画面が出ます（段階 1 で作ります）。

- テストは `tests/<番号>-<名前>.test.ts` に置き、`node --test` で動く純粋な処理（データの変換、判定）を対象にします。React の描画そのものはテストしません。
- 実物の DSH での確認は、段階 3 でまとめて行います。

## コミット

- メッセージは `<type>: <内容>` の形で、type は `feat`、`fix`、`refactor`、`docs`、`test`、`chore` のどれかです。
- ユーザーの共通ルールに従い、AI が書いたコミットには、次の git トレーラを付けます。どの AI のどの設定で書いたかを、あとで比べられるようにするためです。分からない値は `unknown` と書きます。

```text
AI-Harness: Codex CLI
AI-Model: <モデル名>
AI-Effort: <推論の強さ>
AI-Duration: <作業にかかった時間。例：1h20m>
AI-Cost: <費用。定額のプランで測れなければ unknown>
AI-Task: <設計書の番号。例：03-composer>
```
- コミットメッセージに個人情報を書きません。`git push --force` と `git reset --hard` は使いません。

## Codex に渡す指示の例

リポジトリ直下の `AGENTS.md` を Codex が自動で読み、この文書へ案内します。そのため、指示には担当の設計書だけを書けば足ります。

```text
docs/design/03-composer.md の担当範囲を実装してください。
作業場所は今の worktree（ブランチ feat/03-composer）です。
担当するファイル以外は変更せず、必要になったら設計書の「実装メモ」に書いて報告してください。
pnpm typecheck、pnpm test、pnpm build を通し、自分のブランチにコミットしたら終了です。
```

## DSH の版

- Mac の DSH は 0.1.5-rc.1 で、API の調査メモもこの版を基にしています。
- 同梱している `@deepseek-ai/dsh-client-store` は 0.1.5-rc.2 です。
- 本番（Arch）の版は未確認です。段階 3 で確かめ、合わない場合は同梱の版を合わせます。
- 今の画面のプラグイン（`dsh-client-ui-*`）は、参考の実装として読んでかまいません。場所は `$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/` です。ただし、M3E の画面はこれらのプラグインを読み込みません。
