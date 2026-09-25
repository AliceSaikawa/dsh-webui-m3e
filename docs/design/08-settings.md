# 08 設定タブ

## 目的

この端末だけの設定と、DSH 全体の設定を変えられるようにします。DSH の設定は、DSH が返す定義（スキーマ）から画面を自動で作り、項目を 1 つずつ手で描かないようにします。

## 担当する画面

| Canvas の画面 id | 名前 |
|---|---|
| `settings` | 設定 |
| `settingsModel` | 設定の詳細（モデル） |
| `keys` | 提供元と API キー |
| `keyEntry` | API キーの入力 |
| `appearance` | 外観 |

仕様は `docs/ui-spec.md` の「設定タブ」「そのほかの一覧と設定の画面」の節です。

## 担当するファイル

- `web/src/features/settings/` の全部（`routes.tsx` と `SettingsScreen.tsx` は 00 の仮の部品を置き換える）
- `tests/08-*.test.ts`
- この設計書の「実装メモ」

## 入口

`routes`：`#/settings`（下のタブ、`tab: 'settings'`）と `#/settings/<ページ>`。

## 画面の中身

### 設定のトップ

- **この端末**
  - 「今の画面に戻す」：00 の `backToClassic()`。押す前に確認のダイアログ（「この端末では DSH の標準の画面を使います。M3E の画面には、標準の画面の設定からいつでも戻れます」）を挟みます。
  - 「外観」：今の値を 2 行目に出し、タップで外観のシート。
- **DSH の設定**：次の 5 行です。2 行目には、そのページの主な値を出します。

| 行 | ページ | 名前空間 |
|---|---|---|
| モデル | `#/settings/models` | `agent-default-model`、`subagent-model-selection` |
| 権限 | `#/settings/permission` | `permission` |
| エージェント | `#/settings/agent` | `agent-presets`、`agent-loop` |
| 提供元と API キー | `#/settings/providers` | `llm-*`（`llm-deepseek`、`llm-pi-ai`、`llm-retry` など、`llm-` で始まるもの全部）と認証情報 |
| Web 検索とシェル | `#/settings/tools` | `web-search-deepseek`、`shell`、`locale` |

- `ui-` で始まる名前空間と `ui-onboarding` は、今の画面向けなので出しません。上の表にない名前空間が `describe()` にあれば、「そのほか」の行を足し、名前空間の名前をそのまま見出しにしたページで出します。
- 一番下に、この UI の版（`package.json` の `version`）と、接続先の DSH の版（取れれば）を小さく出します。

### 設定の詳細ページ（スキーマから作る）

- ページに含まれる名前空間ごとに、見出しを付けて項目を並べます。
- `describe()` の各名前空間の `schema`（JSON）から、項目の種類を読み取って部品を選びます。

| スキーマの種類 | 部品 |
|---|---|
| 真偽 | スイッチ |
| 文字 | テキスト欄 |
| 数値 | 数値のテキスト欄（最小・最大があれば検査） |
| 決まった値のどれか（定数の組み合わせ） | ドロップダウン |
| 入れ子のまとまり | 小見出しを付けて、中の項目を並べる |
| 配列、辞書、そのほか | 値を読み取り専用で出し、「この項目は今の画面で編集してください」と添える |

- 項目の説明（スキーマの説明文）は補足として小さく出します。
- 補足の最後に、反映のタイミングを出します。`applies` が `live` なら「すぐ反映されます」、`restart` なら「DSH の再起動後に反映されます」。
- ユーザーが上書きした項目（`user` に値がある）には「既定値に戻す」を出します。
- 値を変えたら、すぐに `settings.update(ns, patch, revision)` で保存します。文字と数値は、入力が止まって 600ms 後か、欄から離れたときに保存します。
- `writable` が false なら、すべての項目を無効にし、上に「この DSH では設定を変更できません」と出します。
- 保存が競合したら（`settings/conflict`）、スナックバーで「ほかの場所で設定が変わりました。読み直しました」と出して、その名前空間を読み直します。イベント `settings/document-updated` が来たときも読み直します。
- 保存が拒否されたら（`settings/rejected`）、その項目の下に理由を出します。
- 秘密の値（`secrets`）の項目は、値を出さず「登録済み」「未登録」だけを出します。

### 提供元と API キー

- 提供元ごとに 1 行。2 行目は「API キー：登録済み」「API キー：未登録」「キーは不要」のどれかです。
- キーが要る提供元の行をタップすると、キーの入力のシートを開きます。提供元ごとの詳しい設定（`llm-*` の名前空間）は、同じページの下にスキーマから作ります。
- **キーの入力のシート**：テキスト欄（入力中は伏せ字、目のアイコンで表示の切り替え）、「保存」（`credentials.set`）、登録済みなら「登録を消す」（`credentials.unset`、確認を挟む）。保存したら欄を空にし、二度と表示しません。

### 外観

- シートで「端末の設定に合わせる」「ライト」「ダーク」を選びます。00 の `useAppearance()` と `setAppearance()` を使い、選んだ瞬間に画面の明暗が変わります。
- この設定はこの端末だけのものです。DSH 本体の `ui-theme` とは共有しません（2026-09-25 の決定）。

## 使う DSH の窓口

- `ctx.remote.settings`：`describe()`、`update()`、`replace()`、イベント `settings/document-updated`（API の調査メモ §6）
- `ctx.remote.credentials`：`describe(refs)`、`set(ref, value)`、`unset(ref)`。型は未確認です（下の「未確認のこと」）
- 00 の `backToClassic()`、`useAppearance()`、`setAppearance()`、`openSheet`、`openDialog`、`showSnackbar`

参考の実装：今の画面の `dsh-client-ui-settings`、`dsh-client-ui-settings-general`、`dsh-client-ui-settings-models`、`dsh-client-ui-theme`。スキーマの JSON の読み方はここに合わせてください。

## 偽データ（mock.ts）

- 上の表の名前空間を揃えた `describe()` の結果。各名前空間に、真偽、文字、数値、決まった値のどれか、入れ子、配列の項目を最低 1 つずつ含めます。`applies` は `live` と `restart` を混ぜます。
- `llm-deepseek` はキー登録済み、`llm-pi-ai` は未登録、ローカルはキー不要。
- `?mock&scenario=settings-readonly`：`writable: false`。`scenario=settings-conflict`：最初の保存で `settings/conflict` を返します。

## テスト

`tests/08-settings.test.ts` で、次の純粋な処理を確かめます。

- スキーマの JSON から、項目の一覧と部品の種類を作る処理（上の表の全種類と、知らない種類）
- 名前空間を 5 つのページと「そのほか」に振り分ける処理（`ui-` を除く、`llm-` をまとめる）
- 保存する差分（patch）の組み立てと、「既定値に戻す」ときの差分

## 完了条件

- `?mock` で、トップの 2 区分、5 つのページと「そのほか」、各種の項目の編集と保存、読み取り専用、競合、キーの登録と削除、外観の切り替え、今の画面に戻す（確認のダイアログまで）が動きます。
- `pnpm typecheck`、`pnpm test`、`pnpm build` が通ります。

## 未確認のこと

- スキーマの JSON の正確な形（cordis の `Schema` の `toJSON()`）。参考の実装で確かめてください。
- `ctx.remote.credentials` の正確な型（API の調査では型ファイルを読めず、README からの推測です）。
- 認証情報の参照（`ref`）と `llm-*` の名前空間の `secrets` の対応。
- DSH の版を取る窓口があるか。なければ DSH の版は出しません。

## 実装メモ

（実装した担当が書き足します）
