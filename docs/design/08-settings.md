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

### 2026-10-05：Issue #16 カスタムプロバイダーの契約と実装

対象は **0.2.0-rc.2 のみ**。第1回の画面案を基に、追加・編集の専用フォームを実装した。過去のメモの未確認事項は、この節で確認できた範囲を更新する。Issue #18 を通常のマージで取り込み、その配布用設定や scripts は変更していない。キーの RPC を呼ぶ既存関数を再利用し、保護対象のパッケージは読んでいない。

#### 配布物で確かめた契約

以下の `P/` は、リポジトリ内の `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/` を指す。5 パッケージを個別に指定して読んだ。上流 master の内容をそのまま契約としない。

| 事実 | 実物のパスと行 |
|---|---|
| 設定先は `llm-pi-ai` の `providers[ID]` | `P/dsh-llm-pi-ai/lib/index.js:1017–1051, 2513–2535` |
| 標準画面の追加は開いた revision を付けた `settings.mutate`。設定成功後にキーを別保存 | `P/dsh-client-ui-settings-models/lib/client.js:1210–1277` |
| 標準画面の編集は変更箇所の `set/unset` と revision。ID は固定 | 同 `client.js:1455–1489, 1511–1524, 1586–1626` |
| `update` は再帰マージ、配列は置換。`mutate` は保存済みの層への path 操作 | `P/dsh-settings/lib/index.js:190–218, 276–291, 470–499` |
| revision は名前空間・Host プロセス単位。異なる値は `settings/conflict`、検証拒否は `settings/rejected` | `P/dsh-settings/lib/index.js:500–514`、`P/dsh-api-settings-controller/lib/index.js:391–423, 451–504` |
| providers の `sKey` は string、pattern なし。標準画面の小文字英字・ハイフン制限は UI 独自 | `P/dsh-llm-pi-ai/lib/index.js:1051`、`P/dsh-client-ui-settings-models/lib/client.js:1186–1204` |
| プロトコルは schema の `api` の const union。別の候補 RPC は不要 | 同 `client.js:938–958`、`P/dsh-llm-pi-ai/lib/index.js:802–816, 1020` |
| カスタムの判定は directory の `declared: true` と設定先。稼働中かどうかではない | `P/dsh-llm-pi-ai/lib/index.js:2506–2529` |
| スキーマ以外にもモデル ID の重複、カタログ外の必須項目などを解決時に検査 | 同 `index.js:638–711, 1085–1154` |
| volatile 設定の更新で adapter、directory、catalog が変わる | 同 `index.js:2537–2561, 2588–2597, 2616–2637` |
| adapter の登録変更で `llm/adapters-updated`、設定変更で `(ns, revision)` の `settings/document-updated` | `P/dsh-llm/lib/index.js:1879–1893, 1910–1963`、`P/dsh-settings/lib/index.js:413–461` |
| `apiKeyEnv` はキーの参照名。導出式は ID を大文字化し英数字以外の連続を `_` にして `_API_KEY` を付ける | `P/dsh-client-ui-settings-models/lib/client.js:938–940`、`web/src/features/settings/providers.ts:47` |
| キーの RPC は参照名の検査、状態の照会、登録・削除を別々に扱う | 呼出し側の `P/dsh-api-settings-controller/lib/index.js:62–70, 161–216`。保存実装の保護対象パッケージは対象外 |
| 伏せる処理はスキーマの role に従う。pi-ai の `apiKeyEnv`、`headers` は自動的に伏せられる項目ではない | `P/dsh-settings/lib/index.js:22–84`、`P/dsh-llm-pi-ai/lib/index.js:1017–1051` |

Issue の版表記は 0.2.0-rc.2 に読み替えた。master を根拠とする保存契約はこの版でも成立した。一方、ID の pattern、HTTP URL の強制、未知項目の一律拒否は Host の条件ではなかった。

#### フォームが扱うスキーマ

根拠は `P/dsh-llm-pi-ai/lib/index.js:1001–1051` と `lib/types/config.d.ts:51–161`。スキーマの任意と、カタログ外の提供元で必要になる条件を区別する。

| 項目 | 型と条件 |
|---|---|
| ID（辞書キー） | string。空文字は解決時に拒否。sKey の pattern はない |
| `displayName` | 任意 string。指定した空文字は拒否。フォームの空欄は省略／既存上書きの unset |
| `baseURL` | 任意 string だがカスタムでは非空が必須。URL の pattern はなく、HTTP の制限もない |
| `api` | 任意 const union だがカスタムでは必須。`openai-completions` / `openai-responses` / `anthropic-messages`。フォームは応答から列挙する |
| `models` | 配列。カタログ外で解決できるモデルが 0 件なら拒否 |
| モデル `id` | 必須 string、非空、同じ一覧内で一意。空白だけの文字列は Host で受理 |
| モデル `name` | 任意 string |
| `contextWindow`, `maxTokens` | 任意 number、1 以上の整数。`maxTokens <= contextWindow` という制約はない |
| `input` | `text` / `image` の配列。省略・空配列は継承。フォームの「提供元の既定値を使う」で省略する |
| `apiKeyEnv` | 任意の参照名。キー本体を設定へ入れない |

フォームの対象外は `headers`、`modelOverrides`、`compat`、`reasoningEfforts`、`thinkingBudgets`、各種既定値、timeout、transport、retryPolicy 等。モデルの `reasoningEfforts` は false または off/minimal/low/medium/high/xhigh/max をキー、string/null を値とする辞書。未知の項目と合わせて保持する。スキーマの詳細を高度なフォームへ展開することはしない。

#### 隔離した実 DSH への追加実入力

`tmp/issue16-observe/contract.spec.ts` を既存 e2e-dsh の fixture で実行した。HOME と DSH_HOME は tmp、loopback の Host、偽 LLM を使用。設定 RPC のみで **35 入力**を観測し、受理した入力は毎回 unset で復帰、拒否した入力は保存済みの層が変わらないことを確認した。結果は `tmp/issue16-observed.json`。一時 spec はコミットしない。

| 入力 | 結果 |
|---|---|
| キー参照なしの有効なカスタム | 受理 |
| ID：大文字、下線、点、数字始まり、空白を含む、スラッシュ、空白のみ | すべて受理 |
| ID：`constructor`, `prototype` | 受理。既存 M3E の安全な path アクセスが拒否する予約名なので、この画面では編集対象外 |
| ID：空文字、`__proto__` | `settings/rejected` |
| URL：`not a url`、FTP、空白のみ | 受理。保存可能という結果であり、通信に使えることの確認ではない |
| URL：空文字、省略 | `settings/rejected` |
| models：空配列、省略 | `settings/rejected` |
| モデル ID：空文字、欠落、重複 | `settings/rejected` |
| モデル ID：空白のみ | 受理 |
| contextWindow 0、maxTokens 1.5 / 1.000000001 | `settings/rejected` |
| input：空配列、image のみ | 受理 |
| input：audio | `settings/rejected` |
| api：未知値、省略 | `settings/rejected` |
| 未知の提供元項目、未知のモデル項目 | 受理し保持 |
| displayName：空文字 | `settings/rejected` |
| 表示名、モデル名、context 4096、maxTokens 8192、text/image | 受理 |

既存 `tests/support/settings-write-cases.ts` と `e2e-dsh/rpc.spec.ts:183–202` の 37 入力には、pi-ai の表示名の成功と空文字拒否、defaultInput 空配列拒否、未知項目受理、旧フィールド拒否、reasoningEfforts のキー検証がある。これは設定 RPC の確認で、今回の追加・編集フォームとは分けて扱う。

追加直後の `llm.listProviders`、`listConfigurableProviders`、`session.modelCatalog` に新しい ID とモデルが現れた。作成時は adapter 通知 2 回と設定通知、モデル名だけの編集では設定通知だけを観測した。モデル変更でも adapter 通知が必ず来るとは扱わない。編集後のカタログとページ再読み込み後の値も一致し、再起動なしで反映した。Host 再起動を挟む永続性と実際の外部提供元への接続は未検証。

#### 下書き、差分、キーの別保存

追加は次の形で、**フォームを開いて取得した revision** を送る。

```ts
settings.mutate('llm-pi-ai', [
  { op: 'set', path: ['providers', id], value: { api, baseURL, models /* 任意の表示名・キー参照 */ } },
], openedRevision)
```

編集は `['providers', id, 'displayName' | 'baseURL' | 'api']` の変更項目だけを `set/unset`。モデル一覧は元の各行全体を deep clone し、既知の編集項目だけを変更する。変化があった場合だけ `['providers', id, 'models']` を配列で set する。名前空間全体とプロフィール全体の置換、未変更の配列の再送はしない。伏せた値のパス、disabled、password role と対象が交差するならその欄を変更不可とし、安全な他の欄だけの編集を許可する。

キー入力があれば、参照未指定のときだけ `apiKeyEnv` を設定差分へ追加し、設定成功後に既存 `createProviderStore` の `load` と `save(row, input)` を呼ぶ。参照と登録可能状態を再確認し、キー RPC へ参照名と今回の入力だけを送る。キー空欄では登録済みキーを維持し、キー RPC を呼ばない。標準画面と同じ保存順。登録済みの値を取得・表示する経路は作らない。

`custom-provider-store.ts` は loading / blocked / editing / savingSettings / savingKey / keyFailed / stale / unknown / saved を区別する。同期的な busy で二重送信を止め、revision を通知で勝手に進めない。外部変更・競合では再読込と確認を求める。設定成功後は ID と保存応答を確定し、keyFailed の再試行はキー保存だけ。再作成はしない。応答を失った場合、または明確な拒否コード以外のエラー応答の場合は追加を再送せず、「保存結果を確認」で対象を取得し、既存なら編集へ切り替える。

`createKeyDraft` の送信開始時消去・表示状態初期化・dispose を再利用する。再読込時の `clear` は購読を保って入力だけを消す。キャンセル、Escape、ルート離脱で入力と未送信キーを破棄する。処理は閉じた後も送信済み設定の完了まで追跡し、完了後に一覧を更新するが、閉じたフォームからキーを続けて送らない。接続世代と取得 ticket で古い応答を無効化する。

#### ファイル、偽データ、判断

- 新規：`CustomProviderSheet.tsx`（共通フォーム）、`custom-provider.ts`（下書き・検証・差分）、`custom-provider-store.ts`（保存制御）、`mock-custom.ts`（失敗シナリオ）。いずれも `web/src/features/settings/`。
- 変更：同フォルダの `ProvidersPanel.tsx`、`providers.ts`、`settings.css`、`mock.ts`、`mock-models.ts`、`mock-validation.ts`。schema の復号、valueAt、既存キー操作、field-access、openFullSheet を再利用。ルーターと共有 overlay は変更しない。
- 試験：`tests/08-custom-provider.test.ts`、`e2e/settings-custom-provider.spec.ts`、`e2e-dsh/custom-provider.spec.ts`。既存 M5 の入力へ実 Host で必須の api/baseURL を足し、directory の declared を明示した。期待を緩めた修正ではない。`tests/18-pack.test.ts` の偽モジュール一覧に mock-custom を追加。
- 偽データ：既存 settings-readonly と、新規 custom-no-namespace / custom-unavailable / custom-rejected / custom-conflict / custom-response-lost / custom-slow。custom-partial のキー拒否処理への接続は一度保護フックで停止したが、`tmp/handoff-issue16-01.md` を指示役が `ad192ba` で適用済み。custom-slow はレビュー対応で固定 800ms を廃止し、試験側が開始を観測して保留応答を解放する。
- 全画面シートを採用。専用ルートは不要な履歴と復元を増やすため採用しない。共通シートを開くだけでは初期高さが半分になることを実測したため、このフォームを持つシートだけに動的画面高を CSS 指定した。ほかのシートを変更しない。
- 終了経路を統一できる破棄確認の仕組みが共有 overlay にないため、今回も破棄確認なし。送信開始後は取消できないことを表示する。
- モデルの index ごとの操作より、変更時だけ配列を送る案を採用。継承と削除後の index 移動を避け、元の未知項目を保持する。保護された子がある配列は置換しない。
- ID は標準画面独自の正規表現を採用せず、非空・重複・既存 M3E path が拒否する 3 予約名を検査する。ID の空白は保存どおり扱う。URL はレビューの明示指示を優先し、前後の空白を除いた HTTP/HTTPS の URL だけを保存する。Host の受理範囲を再現する偽データは変更しない。キー付きの保存には参照名の形式と、明示された名前も含む実際の保存先の重複検査を別に行う。

#### 受け入れ条件と検証の対応

| 条件 | 単体 | 偽データ e2e | 実 DSH e2e |
|---|---|---|---|
| 1 追加・編集 | I16 ops | UI lifecycle | real lifecycle、キーあり・なし |
| 2 値と未編集設定の保持 | I16 ops | UI lifecycle、モデル選択不変 | real lifecycle、再読込・他提供元・未知項目・既定値 |
| 3 入力検査 | I16 validation | UI lifecycle、欄エラーとフォーカス | 一時 spec の 35 入力 |
| 4 キーの維持・消去 | I16 partial / close / unknown | UI dismiss / refused / late | real lifecycle / failures |
| 5 保存失敗の分類 | I16 refusals / partial / unknown | UI blocked / refused / lost / partial（接続差分は適用済み） | real failures、別ページ競合と設定だけ成功 |
| 6 取消・連打・終了 | I16 partial / close | UI dismiss / late、4 終了経路 | real failures の閉じて再編集 |
| 7 狭い画面と回帰 | 既存キー・モデル試験 | 390px と 375×420px、実寸の全画面高と横幅 | 新モデルの選択候補。iOS のキーボード実機は未確認 |
| 8 品質 | typecheck / test | 全偽データ e2e | build、全実 DSH e2e を 2 回 |

追加・変更した各試験は次の故障注入で確認した。表の試験名は先頭の識別子。各回で対象だけを実行し、追跡ファイルへの変更は `git restore` で戻した。一時 spec の準備値は元の値へ戻して再実行した。ブラウザーの短い viewport をソフトウェアキーボード実機確認の代用とはしない。

| 試験 | 一時的な故障（本体または偽データ） | 結果 |
|---|---|---|
| I16 ops | custom-provider のモデル変換を既知キーだけに制限 | 未知の extra が消えて失敗 |
| I16 validation | 検証が常に空のエラーを返す | 空 ID のエラーがなく失敗 |
| I16 partial | 保存済みフラグと編集モードを消して再作成 | 設定書込み 2 回になり失敗 |
| I16 partial（入力消去） | createKeyDraft の送信時 draft/visible 初期化を削除 | 入力が残って失敗 |
| I16 refusals | 競合時に同じ mutate を自動再送 | 書込み 2 回になり失敗 |
| I16 close | dispose を空にする | 閉じた後も保存が成功扱いになって失敗 |
| I16 unknown | 再取得後も新規扱いにする | 編集へ切り替わらず失敗 |
| I16 unknown（エラー応答） | 不明なエラーコードの分類を削除 | unknown でなく editing になって失敗 |
| I16 partial（参照重複） | 導出参照名の重複検査を削除 | 他の提供元と同じキーを保存できてしまい失敗 |
| 既存 M5 | mock-models の declared を false にする | directory の厳密一致で失敗 |
| pack の全偽モジュール検査 | 偽の chunk 入力の mock-custom を命名規則外の custom-provider に変える | 規則外のファイルが検出されず失敗。scripts 本体は変更しない |
| UI lifecycle | 入力検証を無効化 | ID 重複エラーが表示されず失敗 |
| UI dismiss | 終了処理で submit も呼ぶ | キャンセル時の書込みが 0 → 1 となり失敗 |
| UI blocked | 名前空間なしの準備を削除 | 追加ボタンが有効になって失敗 |
| UI refused | 競合時に自動再送 | 書込み 2 回になり失敗 |
| UI lost | 再取得後も新規扱い | 保存済み ID の欄が空になって失敗 |
| UI late | dispose を空にする | 閉じた後にキーが登録済みとなり失敗 |
| UI lifecycle / dismiss / refused / lost / late（初期フォーカス） | シートが開いた後の見出しへの focus を削除 | 5 件とも見出しのフォーカス検査で失敗 |
| UI partial | 第2回の時点では接続差分が未適用 | `ad192ba` で適用済み。今回の故障注入の結果は下記のレビュー対応に記録 |
| real lifecycle | モデルの未知フィールドと reasoningEfforts を落とす | 保存・再読込後の配列の厳密一致で失敗 |
| real failures | 外部設定通知の処理を無効化 | 別ページ変更後の競合案内がなく失敗 |
| 一時 spec | 有効入力のモデル準備を空配列に変える | valid-no-key が拒否となり失敗 |

#### 第2回の最終検証（2026-10-05、接続差分適用前）

故障注入を戻した最終コードで実行した。結果を緑にするための skip、期待失敗への変更、アサーションの緩和は行っていない。

| 実行 | 結果 |
|---|---|
| `pnpm typecheck` | 成功 |
| `pnpm test` | 1,052 件成功、失敗・skip 0 |
| `pnpm build` | 成功。配布側の本番偽モジュール混入検査も通過 |
| 全偽データ e2e | 165 成功、1 失敗、skip/flaky 0、482.0 秒。既存ポートを避け、一時設定で 5216 を使用 |
| 全実 DSH e2e 1 回目 | 36 件が想定どおり、unexpected/skip/flaky 0、286.7 秒 |
| 全実 DSH e2e 2 回目 | 同じく 36 件が想定どおり、unexpected/skip/flaky 0、207.1 秒 |
| 追加実測の一時 spec | 1 件成功、35 入力（受理 19、拒否 16）と反映・通知・再読込、62.4 秒 |

実 DSH の各 36 件には、変更していない既存の期待失敗（Host が止まったままの場合の切断表示）1 件を含む。通常成功は各 35 件。LLM とキーは架空のもので、外部提供元への実通信ではない。

当時の偽データの失敗は `e2e/settings-custom-provider.spec.ts:140` の `I16 UI partial: 設定だけ成功したらキーだけ再試行する` だけだった。保護フックで止まった `web/src/features/settings/mock.ts` の接続差分は、`tmp/handoff-issue16-01.md` を指示役が `ad192ba` で適用して解消した。同コミットで指示役が型・単体 1,052 件・ビルド・配布検査・偽データ 166 件・実 DSH 2 回を確認済みとの引き継ぎを受けた。今回の再実行と故障注入は下記に分けて記録する。

第2回の判定と結果は `tmp/handoff-issue16-implementation.md`、`tmp/issue16-mock-final.json`、`tmp/issue16-real-run1.json`、`tmp/issue16-real-run2.json` に保存した。その後レビューで指摘された不足と最新の判定は下記のレビュー対応を参照する。iOS 実機のソフトウェアキーボードは引き続き未確認。

範囲外：カタログの提供元追加、提供元削除・ID 変更、OAuth、モデル自動取得、接続試験、高度な設定、他の DSH 版。保護対象パッケージを読むことと、利用者の DSH を操作することは実施していない。

### 2026-10-05：Issue #16 レビューへの対応

`ad192ba` の引き継ぎ差分を含む状態から修正した。対応パッケージの追加や、Issue #18 の配布用ファイルの変更はない。

#### 指摘ごとの変更

| 指摘 | 対応 |
|---|---|
| 1 明示された参照名との衝突 | `custom-provider-store.ts` は directory と全名前空間から `providerRows` で実際の参照先を取得し、新規とキーなし提供元へのあと付けの両方を検査する。`providers.ts` の再照会でも、初めて参照を付ける保存では他の行と同じ保存先を使わない。部分成功後の再試行もこの条件を保持する |
| 2 数字始まり ID が一括照会を壊す | Host の参照名検証を `validKeyReference` へ写し、不正な名前を照会から除外する。当該行だけを変更不可とし、理由を行とフォームへ出す。キー付きの保存は設定送信前の欄エラーで止める。既存提供元の状態・登録・削除は単体と実 DSH の画面で確認 |
| 3 閉じた後に再照会からキーを送る | 既存 `ProviderStore.save` に省略可能な `canSend` を追加。カスタムフォームは active・接続・接続世代を渡し、再照会の完了後とキー送信直前の両方で判定する。オプションを渡さない既存の登録経路は維持。専用試験は `tmp/handoff-issue16-02.md` へ回し、その後 `e9f4e3a` で適用済み。今回、正常実行と `canSend` を常に true にする変異の検出を確認 |
| 4 URL と ID の形式 | URL は HTTP/HTTPS のみ。前後の空白を除いて検証・保存する。ID は非空・重複・予約名を検査し、英字始まりを推奨。数字始まりなどはキーなしで許可する。キーの参照名を別に検査する |
| 5 固定 800ms の待ち | `mock-custom.ts` に試験用の保留・解放を設けた。UI late は開始件数 1、保存中表示、閉じてフォームが消えたことと行が未作成なことを確認してから解放する |
| 6 古い適用待ちの記述 | UI 仕様とこのメモを `ad192ba` で適用済みに更新。第2回の失敗結果は当時の記録と明示し、今回の結果と区別する |
| 7 UI partial の故障注入 | 設定の再送、新規再作成、キー送信の省略、最初の拒否の無効化を個別に確認する。結果は下表 |
| 8 新規・変更試験の故障注入 | 正常状態で通過後、各試験に対応する本体または偽データを壊して実行し、`git restore` で戻す。未適用の専用試験は成功実績に数えない |

根拠：`P/dsh-api-settings-controller/lib/index.js:55–70` は参照名を `^[A-Za-z_][A-Za-z0-9_]*$` と定義し、describe の配列内にも同じ検査を適用する。設定の ID 自体の制約とは異なる。実物の保存処理を含む保護対象パッケージには触れていない。

ID を標準画面の小文字英字・ハイフンだけへ制限する案は不採用。キーなしのローカル提供元や既存の大文字・数字始まりの ID を扱える契約を維持するため。画面から新規にキーを使う場合は有効な導出参照が必要で、既存提供元に有効な参照名が明示されていればそれを優先する。既に明示的に共有している参照は変更しない。

URL は Issue の明示要件を優先する。`http://` / `https://` のプレフィックスと URL の解析を検査し、localhost、IPv4、IPv6、ポートを許可。前後の空白を拒否する案より、入力欄に貼り付けたときの余分な空白だけを除く案を採用した。未変更の既存フィールドを自動的に正規化して書き直すことはしない。Host が FTP や空白だけの文字列も受理するという実測と、その偽データは維持する。フォームの条件とは目的が異なる。

#### レビュー対応で壊して確かめた表

| 試験 | 故障の場所と内容 | 検出 |
|---|---|---|
| I16 ops | custom-provider の URL 保存時の trim を削除 | 差分の URL に前後空白が残り失敗 |
| I16 validation | validBaseURL が常に true | 不正 URL の欄エラーがなく失敗 |
| I16 explicit reference | custom-provider-store の参照比較を ID からの導出だけへ戻す | 衝突する追加が成功して失敗 |
| I16 numeric ID | providers の照会対象から不正参照を除外しない | DeepSeek が登録済みでなく unknown となり失敗 |
| I16 numeric ID（欄検査） | custom-provider-store の参照名の形式検査を無効化 | キー欄のエラーがなく失敗 |
| I16 reference recheck | providers の送信前の共有検査を削除 | 共有を作るキー保存が成功して失敗 |
| I16 UI URL | validBaseURL が常に true | 不正 URL の保存が通り、欄エラーが出ず失敗 |
| I16 real numeric ID | providers の照会対象から不正参照を除外しない | 作成後、既存 DeepSeek の「登録済み」が「確認できません」となり失敗 |
| I16 UI late | custom-provider-store の dispose を空にする | 閉じてから保留応答を解放するとキーが登録済みとなり失敗 |
| I16 UI partial（設定再送） | 保存済みでも同じ URL の mutate を送る | 設定書込みが 1 回でなく 2 回となり失敗 |
| I16 UI partial（新規再作成） | 保存済みフラグを消し editing を false に戻す | 設定書込みが 2 回となり失敗 |
| I16 UI partial（キー未送信） | keyFailed からの再試行でキー保存の分岐を通らない | 登録済みでなく未登録のままで失敗 |
| I16 UI partial（拒否なし） | mock-custom の rejectKeyOnce が常に false | 部分成功の案内が出ず失敗 |
| I16 key recheck close | 前回は試験差分自体が保護フックで停止 | `tmp/handoff-issue16-02.md` は指示役が `e9f4e3a` で適用済み。正常実行も成功。今回の M47（参照先書込み待ち）とは別の待機境界 |

すべての実施した故障を `git restore` で戻し、本体・試験には故障を残していない。今回追加・期待変更した試験は上表に 1 件ずつ載せた。I16 UI partial は既存試験の条件を変更せず、指定の 4 種類の故障を個別に検出した。

#### レビュー対応後の全体検証と残り

| 実行 | 結果 |
|---|---|
| `pnpm typecheck` | 成功 |
| `pnpm test` | 1,055 件成功、失敗・skip 0 |
| `pnpm build` / `pnpm check:pack` | 成功。配布検査は 19 ファイル |
| 全偽データ e2e | 167 件成功、unexpected/skip/flaky 0、516.8 秒 |
| 全実 DSH e2e 1 回目 | 通常成功 36 件＋既存の期待失敗 1 件、unexpected/skip/flaky 0、296.0 秒 |
| 全実 DSH e2e 2 回目 | 通常成功 36 件＋同じ期待失敗 1 件、unexpected/skip/flaky 0、253.5 秒 |

結果は `tmp/issue16-review-mock-final.json`、`tmp/issue16-review-real-run1.json`、`tmp/issue16-review-real-run2.json`。実 DSH は隔離した 0.2.0-rc.2、LLM とキーは架空値。未適用の試験を skip で除いた結果ではなく、追跡中の試験を全件実行した結果である。

| 受け入れ条件 | 前回終了時（handoff 02 適用前）の判定 |
|---|---|
| 1 追加・編集 | 達成。数字始まりのキーなし作成も実 DSH で確認 |
| 2 再表示・他設定・モデル選択の保持 | 達成。明示参照との衝突を新規・あと付けで検査 |
| 3 入力検査 | 達成。URL の形式と正規化、ID、キー参照名の条件を分離 |
| 4 キー維持・伏せ字・入力破棄 | 本体は修正済み。キー保存内部の再照会待ちで送信 0 件を確かめる専用試験は引き継ぎ |
| 5 失敗の偽データ検証 | 達成。設定だけ成功も全体実行で成功 |
| 6 キャンセル・連打・再オープン・終了 | 設定保存待ちの終了は確認。キー内部の再照会待ちは専用試験を引き継ぎ |
| 7 狭い画面・キーボード・既存機能の回帰 | 390px、375×420px、既存キー・モデル操作は確認。実機キーボードは未確認 |
| 8 試験追加・品質 | 型・単体・ビルド・配布・全 e2e は成功。追加できなかった専用試験 1 件とその故障注入は未完了 |

指摘 3 の試験追加は、前回の保護フック拒否後に `tmp/handoff-issue16-02.md` へ回し、指示役が `e9f4e3a` で適用済み。上記の件数と受け入れ表は適用前の履歴であり、最新の残りは次の再レビュー対応を参照する。

今回の詳細報告は `tmp/handoff-issue16-review-fixes.md`。iOS 実機のキーボード、今回追加した設定の Host 再起動を挟む保持、外部提供元との実通信は引き続き未検証。検索コマンドの引用符なし glob が形式で拒否された 1 回は、対象ファイルを明示して読み直した。保護対象のパスと禁止された操作には触れていない。

### 2026-10-05：Issue #16 再レビュー・変異監査への対応

`e9f4e3a` から開始し、`git fetch origin` 後、`origin/main`（`23e8ec6`、v0.0.8）を通常のマージ `739606e` で取り込んだ。文書に衝突はなく、main の配布・リリースの記述を保持した。

#### 参照先の所有と衝突の契約

`P` は `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai`、`L` は同じ node_modules の `@earendil-works/pi-ai/dist`。

- `P/dsh-llm-pi-ai/lib/index.js:727–730,840–859`：標準のカタログ提供元は標準の認証探索を保持する。独自提供元の認証と区別する。
- `P/dsh-llm-pi-ai/lib/index.js:2088–2096`：標準の認証探索が環境名を要求すると、DSH の保存済みキーを先に探す。設定に明示名がないことは、保存先がないことを意味しない。
- `L/providers/openai.js:6–10`：標準 `openai` の既定名は `OPENAI_API_KEY`。`L/providers/google.js:6–10` は `GEMINI_API_KEY`、`L/providers/azure-openai-responses.js:6–9` は `AZURE_OPENAI_API_KEY`。
- `L/env-api-keys.js:67–121`：標準の環境名の対応表。Anthropic の 3 名、Copilot、Moonshot の共通名、Qwen/Opencode の共通名など、単なる ID 導出では得られない名前がある。ここから既定名を固定の契約データとして `provider-key-refs.ts` に保持する。実行時にライブラリを UI へ追加しない。
- `L/providers/amazon-bedrock.js:50–78`、`L/providers/google-vertex.js:61–82`：API キー以外の補助環境名も参照する。すべての SDK の探索先まで読んだとは断定せず、`AWS_`、`GOOGLE_`、`GCLOUD_`、`CLOUDFLARE_` の名前群を対応する標準提供元以外から予約する。保護対象パッケージ・設定ファイルは読まない。
- `L/providers/cloudflare-auth.js:1–3,20–24`：Cloudflare のキーに加え、account/gateway の補助名を使う。上の予約群の根拠に含める。
- `P/dsh-llm-pi-ai/lib/index.js:818–826`：明示名にキーがなければ認証探索へ戻らず要求が失敗する場合がある。そのため参照先だけの状態を一覧・フォームで案内する。

`ref` は登録状態の照会先、`usedRefs` は衝突防止用の集合と分けた。後者は明示名・導出名・既定名を含む。標準候補が未稼働でも既定名を予約する。既定名の所有者自身、および公開定義で同じ既定名を使う標準提供元どうしは使用できる。カスタムなど別の所有者との共有は止める。DSH の標準 DeepSeek の ID `deepseek-official` も `DEEPSEEK_API_KEY` の所有者とする（実 DSH の既存キー操作試験で確認）。`P/dsh-llm-pi-ai/lib/index.js:2506–2529` が全カタログを directory に含めるため、稼働していない標準 `deepseek` と公式提供元が同時に一覧に現れることを考慮した。

共通のキー保存・削除は毎回最新の行を読み、保存先の衝突を検査する。呼び出し側の `exclusive` オプションは廃止した。フォームの事前検査も同じ判定を使う。明示済み・設定だけ成功・開き直しという履歴に依存しない。衝突中は状態を unknown、変更不可とし、他人のキーを登録済みとして見せない。

補助名の予約は、確認済みの標準 ID 自身の導出名だけは除外する（`google` → `GOOGLE_API_KEY`）。標準の登録経路を妨げず、他の行の実際の参照先との照合は残す。`GOOGLE` のような別 ID や `GOOGLE_CLOUD_PROJECT` のような任意の補助名はこの除外に入らない。対応表は own property だけを読み、Host に `constructor` などの ID が存在しても一覧の取得を壊さない。

選ばなかった案：既存の明示共有だけを許す／未稼働の標準名を予約しない。前者は自動で付いた明示名を識別できず再オープンで迂回でき、後者は認証前の標準提供元を保護できない。安全側の予約は、未使用の標準名や補助名でもカスタムから登録できなくなる制約を持つ。キーなしの設定作成・編集は妨げない。

#### 試験の補強と引き継ぎ

一覧からの後付け登録、明示名が残った状態の再オープン、標準 OpenAI/Google/Moonshot の既定名との衝突は、先に現行本体で落ちる試験 3 件を作成した（全 3 件が誤った保存成功で失敗）。修正後は成功した。M08/M22/M24/M39 は保存要求の revision、欄エラーと送信 0 件、Host 成功値の確定、設定・キーの各待機中の無効ボタンを直接検査する。

実 DSH の競合試験はクライアントへの設定通知を保留し、旧 revision の要求を実 Host へ送る。応答が `settings/conflict`、書込みが 1 回、Host の revision・全提供元の値が別ページの変更のままであることを検査する。部分成功の再試行は Host の値に加え、設定 RPC の要求列が増えないことを検査する。同値の no-op 再送も検出する。RPC 本体や Host は置き換えていない。キー失敗用の参照には、この試験で渡す読み取り専用環境名 `M3E_DSH_VERSION` を使う（他の提供元のキーと共有させない）。

M47 は当時の通常の apply_patch が拒否されたため `tmp/handoff-issue16-03.md` に引き継いだ。その後、指示役が `e187882` で `tests/08-provider-reference-close.test.ts` を適用済み。正常実行、M47 と案内を除去する変異の検出も確認済みとの引き継ぎを受けた。今回も正常実行を確認した。

追加・変更ファイル：`provider-key-refs.ts`（標準名と衝突の純粋な判定）、`providers.ts`、`custom-provider-store.ts`、両フォーム/一覧、単体 2 ファイルと両 e2e、UI 仕様とこのメモ。新しい偽データモジュールはない。配布用のファイルは取り込み以外で変更しない。

#### 壊して確かめた表（今回）

M08/M22/M24/M39 と M09 は監査の置換と同じ。M25 は廃止した `exclusive` 引数だけを除き、監査と同じ条件・同じ no-op の設定書込みを挿入した。試験ごとに正常通過を確かめてから適用し、終了後は対象の本体を `git restore` で戻した。この回の 4 生存変異はすべて検出。M47 は後に `e187882` で適用・検証済み。

| 試験 | 故障 | 検出した結果 |
|---|---|---|
| I16 opened revision M08 | 開いた版を describe の最新 revision へ差し替え | 保存が成功してしまい、競合を期待する検査で失敗 |
| I16 input M22 | 明示する入力種別の検査を除去 | 空配列が保存され、送信しない期待で失敗 |
| I16 UI input M22 | 同上 | 欄エラーが表示されず失敗 |
| I16 committed state M24 | 成功応答を編集状態・初期値へ確定する publish を除去 | editing が false のままで失敗。正常時は部分成功も含め ID・revision・Host 整形値を確認 |
| I16 UI saving M39 | 監査と同じく保存中の phase を保存可能に追加 | 設定待ちの保存ボタンが有効となり失敗 |
| I16 UI saving M39（キー待ち） | savingKey のときだけ保存を有効化 | キー待ちの保存ボタンが有効となり失敗 |
| I16 destinations list | 衝突判定を常に false | 一覧からの後付け登録が成功して失敗 |
| I16 destinations reopen | 同上 | 明示名が残ったフォームでキー保存が成功して失敗 |
| I16 destinations native | 同上 | 標準の保存先を使うカスタムの作成が成功して失敗 |
| I16 destinations owners | 同上 | 標準以外の ID の予約が解除されて失敗。継承名の検査追加前には constructor 参照が例外になることも確認し修正 |
| I16 destinations owners（本人の導出名） | 補助名の予約で標準 ID 自身も除外しない | google 自身の登録まで拒否して失敗。修正前にも同じ検査で失敗を確認 |
| I16 reference recheck | 同上 | 保存直前に他の行の参照が変わっても成功し失敗 |
| I16 UI destinations | 同上 | 衝突中の案内が表示されず失敗 |
| I16 UI destinations（参照先だけ） | keyNotice の付与を除去 | 未登録の参照先に必要な案内が表示されず失敗 |
| I16 real failures / M09 | RPC 競合後に最新 revision で自動再送 | Host の表示名と revision が別ページの状態から変わり失敗 |
| I16 real failures / M25 | 部分成功後の再試行で同じ api を mutate | Host の値が同じでも設定要求が 2 件から 3 件になり失敗 |
| I16 UI partial / M25 | 同上 | 設定要求が 1 件から 2 件になり失敗 |
| I16 key recheck close（適用済み 02） | canSend を常に true | 閉じた後のキー送信が 0 件でなく 1 件になり失敗 |
| I16 reference write close / M47 | 参照先書込み後の 2 回目の canSend を除去 | 当時は未実行。`e187882` で適用され、指示役と独立監査が検出を確認済み |

画面と実 DSH の変異の結果は `tmp/issue16-review2-M22.json`、`M39.json`、`M39-key.json`、`destinations.json`、`reference-notice.json`、`M09-real.json`、`M25-real-final.json`、`M25-ui.json`（いずれも先頭は `issue16-review2-`）。失敗を期待した実行は全体の成功件数に含めない。

#### 今回の全体検証と受け入れ判定

- `pnpm typecheck`：成功。
- `pnpm test`：1,063 件成功、失敗・skip 0。
- `pnpm build`：成功。既存の 500 kB 超の chunk 警告あり。
- `pnpm check:pack`：19 ファイルで成功。
- 偽データ全体 e2e：170 件成功、予期しない失敗・skip・flaky 0。
- 実 DSH 全体 1 回目：通常成功 36 件、既知の差の期待失敗 1 件、予期しない失敗・skip・flaky 0。
- 実 DSH 全体 2 回目：通常成功 36 件、既知の差の期待失敗 1 件、予期しない失敗・skip・flaky 0。

全体 e2e は共通のコマンドに `--global-timeout=900000` を付けて実行した。実 DSH は 0.2.0-rc.2 の隔離プロファイルと偽 LLM。既知の期待失敗は、Host が停止したままでも切断済み表示へ変わらない従来の 1 件である。最初の試行では再試行後のボタンが有効になるという試験の誤りを検出した。入力消去後はボタンが無効になることが正しいため、入力欄の再有効化で完了を待ち、ボタンは無効と検査するよう修正した。修正後の正常動作と M25 の検出をやり直した。

| 受け入れ条件 | この回の終了時点（03 適用前）の判定 |
|---|---|
| 1 追加・編集の入口とフォーム | 達成。UI / real lifecycle |
| 2 保存値・他の提供元・未知項目・選択モデルの保持 | 達成。path operation 単体、real lifecycle、M24、実 Host の競合後の全値 |
| 3 入力検査と欄エラー | 達成。単体、UI lifecycle / URL / input M22、実 Host の設定書込み |
| 4 キーの非表示・空欄で保持・入力消去 | 実装と適用済み試験は成功。M47 の特定の待機境界の送信 0 件は未検証 |
| 5 各失敗と部分成功 | 達成。UI blocked / refused / lost / partial、real failures。M09/M25 の変異も検出 |
| 6 キャンセル・二重送信・戻る・閉じる | 通常の終了経路は成功。UI dismiss / late / saving M39。参照先書込み待ちの M47 は未検証 |
| 7 375–390px と既存操作の回帰 | 自動試験の範囲で達成。既存のモデル・キー操作と real numeric ID。iOS 実機のキーボードは未検証 |
| 8 単体・e2e・型・ビルド | 適用済みコードは上記で検証。M47 の追加試験・故障検出を引き継ぐ |

結果は `tmp/issue16-review2-mock-final.json`、`tmp/issue16-review2-real-final-1.json`、`tmp/issue16-review2-real-final-2.json`。最初の試行の結果は `tmp/issue16-review2-real-trial.json` に分けた。詳細報告は `tmp/handoff-issue16-review2-fixes.md`。この集計は 03 適用前の履歴であり、M47 はその後 `e187882` で正常・変異とも確認済み。現在の状態は次節に記す。

本番の利用者の DSH や実キーには触れず、実提供元への認証・推論はしていない。保護対象のパッケージは読まなかった。試験のパッチ以外には、検索引数に保護対象語を含む操作 2 回が停止し、共通の決まりが認める安全な単一ファイル指定へ直した。担当外の追加変更・依存追加・push はない。

### 2026-10-05：5 回目のレビューへの対応（現在の方針）

開始時は `6652683`。5 回目のレビューは blocking 3 件、minor 1 件で、Issue #16 の前からある機能の回帰は解消したと判定された。この節は、次の「4 回目の判断による単純化」の方針を引き継ぎ、下に書く点だけを改める。食い違う記述は、この節が優先する。

#### `6652683` の時点の状態（次節の「06・07 待ち」の記述の、その後）

次節は `8e45f9f` の時点の記録で、「06 へ引き継ぎ」「07 待ち」「現在のソースには分割ファイルが残る」「現在は確認不能を返す」と書いている。その後の経緯は次のとおり。

- 06（一覧の照会を main と同じ 1 回の呼び出しへ戻す）、07（フォームが新しい参照名の 1 件を照会する接続）、08（main の失敗の契約を固定する試験）は、指示役が `6652683` で当てた。64 件ずつに分ける処理のファイル `provider-key-info.ts` は外し、いまのソースには無い。
- `6652683` での指示役の検証：型検査とビルドは成功、単体 1,073 件が成功、`check:pack` は成功、偽データの e2e は 171 件が成功、実 DSH は全 40 件（通常の成功 39 件と、既知の差の期待失敗 1 件）。次節の「最終検証」と受け入れ条件の表にある失敗（06・07 待ち）は、この時点で解消している。

#### 指摘 1：衝突の検査で、所有者を除外しない

以前は、設定で参照名を明示している提供元の一覧を `{ id, ref }` で持ち、別の名前空間の所有者の `id` を `名前空間/提供元 ID` という文字列にして、入力されたカスタムの ID と同じなら「自分自身」として除いていた。カスタムの ID は `/` を許すので、たとえば `llm-deepseek` の `deepseek` が `LLM_DEEPSEEK_DEEPSEEK_API_KEY` を明示しているとき、ID `llm-deepseek/deepseek` のカスタムプロバイダーは、導出名が同じなのに衝突を見逃した。

この検査が走るのは、キーが入力されていて、その提供元が参照名をまだ持たない場合だけである。その提供元が同じ名前を自分で明示していることはないので、「自分自身を除く」処理は要らない。所有者を別々の項目で識別する代わりに、除外そのものを外した。`provider-key-refs.ts` の `keyReferenceReason` / `keyReferenceConflict` は、明示されている名前の一覧と、これから付ける名前だけを受け取る。

#### 指摘 2：新しく付けた参照名へは、未登録のときだけキーを送る

設定の保存に付ける revision は `llm-pi-ai` のもので、別の名前空間の設定と、キーの保存先の変化は検出しない。そのため、次の順で、ほかのキーを上書きできた。

1. 画面 A が `acme` をキーつきで追加し、`ACME_API_KEY` が未登録であることを確かめる。
2. 画面 B が、別の名前空間の提供元の参照先を `ACME_API_KEY` にして、キーを登録する。
3. A の設定の保存は、`llm-pi-ai` の revision が変わっていないので成功する。
4. A のキーの保存が、B のキーを上書きする。

指示役の判断にしたがい、次のようにした。

- `providers.ts` の `change` は、キーを送る直前に登録の状況を読み直している。`KeySaveOptions` に任意の `requireMissing` を足し、指定があるときだけ、読み直した結果が「未登録」でなければ、キーを送らずに理由を返す。指定が無い経路（一覧からの登録・削除、参照名のない標準の提供元）は main と同じまま。
- フォーム（`custom-provider-store.ts`）は、この保存で付けた参照名を `assignedReference` に覚え、その名前へのキーの保存にだけ `requireMissing` を付ける。覚えるのは、保存先の照会を通って、設定を送る直前。フォームを開いている間は消さない。したがって、部分成功のあとの同じシートでの再試行、シートの中での読み直し、設定の応答を失ったあとの「保存結果を確認」のあとでも、同じ確認が続く。
- フォームを開き直すと、新しい状態から始まり、参照名は設定に明示されたものとして読み込まれる。これまでの方針どおり、ふつうのキーの登録として扱う（一覧からの登録と同じ）。
- 止めたときは、部分成功の説明に続けて「設定を保存する間に、この参照名のキーが登録されました。上書きを避けるため、API キーを送信していません。この提供元は登録済みのキーを参照します。提供元の設定とキーを確認してください。」を出す。

これにより、次節の「設定成功後の同名の明示は、その操作側が意図した共有として扱う。設定後と再試行では衝突・configured の検査をしない」は、次のように改まる。衝突（名前の重なり）の検査と保存先の照会は、いまも設定の保存の前に 1 回だけで、再試行ではやり直さない。ただし、同じフォームからのキーの送信は、その名前がまだ未登録である場合にかぎる。別の画面が同じ名前を明示しただけ（キーは未登録）なら、これまでどおり送る。

**残る時間差（既存の制限）。** 確認は「読み直しから送信まで」の間を守れない。DSH の `credentials` には「未登録のときだけ書く」操作が無く、画面の側だけでは無くせない。同じ時間差は main にもある。`git show origin/main:web/src/features/settings/providers.ts` の `change`（138〜178 行）は、150 行で登録の状況を読み、参照名のない標準の提供元なら 159 行で導出した名前を `settings.update` で付け、163 行で `credentials.set` を呼ぶ。150 行の読み取りから 163 行の送信までに、ほかの提供元がその名前を明示してキーを登録すれば、同じように上書きになる。この時間差は、既存の制限として扱う。

**残る状態。** 止めたあとも、設定には参照名が残る。その名前には別のキーが登録されているので、このカスタムプロバイダーは、そのキーを参照する状態になる。画面は、そのことを文言で伝えるだけで、参照名を外す書き込みはしない（設定をもう一度書き換える操作は、指示の範囲に無く、それ自体が失敗や競合を起こし得るため）。利用者が、意図した共有かどうかを確かめる。

監査の B04（`I16 retry sharing B04`）は、キーの保存を偽物に置き換えた試験で、再試行で設定を送り直さないことと、保存先の照会をやり直さないことを確かめている。いまも正しい。再試行でキーを送るかどうかは、本物のキーの保存（`providers.ts`）が読み直した登録の状況で決まり、それは下の R5 の試験が確かめる。

#### 指摘 3：外していた照会の上限の試験を戻す

前の回に外した `I16 R3 lookup limit` は、64 件ずつに分ける処理の試験ではなく、偽の RPC が「64 件を受け付け、65 件を拒否する」という、いまも残っている契約の確認だった。根拠は `web/src/features/settings/mock.ts` の `describe` と、実物の `dsh-api-settings-controller/lib/index.js` の 55〜57 行（`MAX_DESCRIBE_REFS = 64`、超えると `gateway/bad-request`）。`tests/08-mock.test.ts` に `I16 lookup limit` として戻した。受け付けた 64 件の名前がそのまま返ることと、拒否のコードも確かめる。次節の表の「R3 lookup limit：削除」は、この回で取り消した。

#### 指摘 4：一覧の補足

カスタムの行から「（変更できません）」の補足が無くなっていた。参照名を持たない行は、「API キー：未設定」と「API キーは「編集」から登録できます。」で理由が伝わるので、変えない。参照名を持つ行は、キーを変更できないとき（キーの保存先だけが読み取り専用、など）に「API キー」のボタンが無効になるだけで理由が出ていなかったので、main の一覧と同じ条件（参照名があり、変更できず、登録状況が分かっている）で「（変更できません）」を添える。

#### `providers.ts` の main との差（この回の時点）

| 箇所 | 差と理由 |
|---|---|
| 型（`ProviderAddress.declared`、`ProviderRow.custom` / `keyNotice`、`status` の `unset`） | カスタムプロバイダーの識別、参照先なしの表示、参照先だけ設定された行の案内 |
| `ProviderState.settingsWritable` / `customAvailable` と、その publish | 「カスタムプロバイダーを追加」の可否 |
| `providerRows` | `declared` のカスタムで参照名が無い行は、名前を導出せず、`unset`、`needsReference` は false |
| 照会の結果に `keyNotice` を付ける 1 行 | 参照名が明示されていてキーが未登録の行の案内 |
| `KeySaveOptions`（`canSend`、`requireMissing`）と、`change` / `save` の引数 | フォームから任意で渡す。指定が無ければ main と同じ |
| `change` の `canSend` の判定 2 か所 | 閉じたフォームからキーを送らない |
| `change` の `requireMissing` の判定 1 か所（この回に追加） | フォームが新しく付けた参照名へは、未登録のときだけキーを送る |
| `createKeyDraft.clear()` | 読み直しと切断のときに入力を消す |

次節の表にある「残っている未完了差（分割 import と呼出し）」は、`6652683` で無くなった。

#### 試験の対応

| 試験 | 内容 |
|---|---|
| `I16 R5 foreign owner`（`tests/08-provider-destinations.test.ts`、追加） | `llm-deepseek` の `deepseek` が明示した名前と、ID `llm-deepseek/deepseek` の導出名が同じ場合に、追加と、編集でのあと付けが止まり、設定もキーも書かれない |
| `I16 destinations owners`（入力を変更） | 関数の引数から ID が無くなったので、呼び出しの引数を直した。名前ごとの期待（衝突する・しない）は同じ。ID だけが違って結果が同じになる行は、まとめた |
| `I16 R5 late registration`（`tests/08-provider-review5.test.ts`、追加） | 設定の保存の応答を保留し、その間に `llm-deepseek` が同じ名前を明示してキーを登録する。フォームからの送信は 0 件、理由が出る。同じフォームの再試行と、シートの中の読み直しのあとも送らない。一覧からの登録（指定なし）は main と同じく送る。開き直したフォームからも送る |
| `I16 R5 unknown result`（追加） | 設定の応答を失ったあとの確認で、別に登録されていれば送らず、未登録なら送る |
| `I16 R5 retry`（追加） | キーが拒否されただけで、未登録のままなら、同じフォームの再試行で送る（止めすぎないこと） |
| `I16 lookup limit`（`tests/08-mock.test.ts`、戻した） | 偽の照会が 64 件を受け付け、65 件を拒否する |
| `I16 UI late registration`（偽データの画面、追加） | 上の late registration を画面で確かめる。理由の表示、キーの欄が空に戻ること、送信の記録 |
| `I16 UI fixed key`（偽データの画面、追加） | 参照名を持つカスタムの行。変更できる場合は補足なしでボタンが有効、キーだけ読み取り専用なら「（変更できません）」が出てボタンが無効、編集は有効 |
| `I16 real late registration`（実 DSH、追加） | 1 つ目のページの設定の応答だけを保留し、2 つ目のページから `llm-deepseek` の参照先とキーを操作する。1 つ目のページからのキーの送信は 0 件、理由が出る、再試行でも 0 件。一覧からの登録で 1 件になる（数え方が正しいことの確認を兼ねる） |

別の画面の操作が入る位置は 2 通りを確かめている。単体と実 DSH の試験は、設定の書き込みが Host に反映されたあと、応答を受け取る前。偽データの画面の試験は、設定の書き込みが反映される前（レビューが示した順）。どちらも、キーを送る直前の読み直しで止まる。

main と同じ動きを固定している試験（`tests/08-provider-review4.test.ts`、`tests/08-providers.test.ts`）は、入力も期待も変えていない。

#### 壊して確かめた表（この回）

どれも、一時的に当てて、落ちることを見て、元に戻した。

| 試験 | 当てた変更 | 落ちたこと |
|---|---|---|
| R5 foreign owner | 直す前の本体（`6652683`）でそのまま実行 | 止まるはずの追加が成功した（`submit()` が true） |
| R5 foreign owner | `custom-provider-store.ts`：別の名前空間の明示名を集めない（`entry.settingsNs === CUSTOM_NS` の条件を足す） | 同上 |
| R5 foreign owner、destinations owners、既存の explicit reference / partial | `provider-key-refs.ts`：明示名との比較を常に偽にする | 4 件とも、衝突を期待する断言で落ちた |
| destinations owners、destinations native | `provider-key-refs.ts`：標準の既定名の予約の行を消す | 予約を期待する断言で落ちた |
| R5 late registration | 直す前の本体（`6652683` に指摘 1 の直しだけを当てた状態）でそのまま実行 | フォームの保存が成功し、キーが送られた |
| R5 late registration、R5 unknown result | `providers.ts`：`requireMissing` の判定を無効にする | 2 件とも、フォームの保存が成功し、キーが送られた |
| R5 late registration | `custom-provider-store.ts`：1 回目のキーの保存のあとに `assignedReference` を消す | 同じフォームの再試行が成功した |
| R5 late registration、R5 unknown result | `custom-provider-store.ts`：読み直し（`load`）で `assignedReference` を消す | 読み直しのあとの保存が成功した |
| R5 unknown result | `custom-provider-store.ts`：`assignedReference` を、設定の成功の応答を受けたあとにだけ覚える | 応答を失ったあとの保存が成功した |
| R5 late registration | `providers.ts`：`requireMissing` の指定が無くても判定する | 一覧からの登録が拒否され、main と同じ `{ ok: true }` の期待で落ちた |
| R5 late registration、R5 unknown result、R5 retry | `providers.ts`：判定を逆にする（未登録のときに止める） | 3 件とも落ちた。R5 retry は、未登録への再試行が拒否された |
| I16 lookup limit | `mock.ts`：`refs.length > 64` の判定を消す | 65 件が受け付けられた |
| UI fixed key | `ProvidersPanel.tsx`：カスタムの行の補足を消す | 「（変更できません）」が見つからない |
| UI fixed key | `ProvidersPanel.tsx`：変更できる行にも補足を出す | 補足が無いことの断言で落ちた |
| UI late registration | `providers.ts`：`requireMissing` の判定を無効にする | 理由の表示が見つからない（保存が成功してシートが閉じた） |
| UI late registration | `custom-provider-store.ts`：1 回目のあとに `assignedReference` を消す | 再試行が成功してシートが閉じた |
| real late registration | `providers.ts`：`requireMissing` の判定を無効にする | 実 DSH で、理由の表示が見つからない（保存が成功した） |
| real late registration | `custom-provider-store.ts`：1 回目のあとに `assignedReference` を消す | 実 DSH で、再試行が成功してシートが閉じた |

#### 検証（この回の最後）

コードの最後のコミット（`e247b94`）で、共通の決まりの確かめ方を全部流した。このあとのコミットは文書だけである。

| 確認 | 結果 |
|---|---|
| `pnpm typecheck` | 成功 |
| `pnpm test`（単体。偽データ） | 1,078 件が成功、失敗・skip・cancelled は 0。`6652683` の 1,073 件に、R5 foreign owner、R5 late registration、R5 unknown result、R5 retry、I16 lookup limit の 5 件を足した |
| `pnpm build` | 成功（既存の 500 kB 超の chunk の警告あり） |
| `pnpm run check:pack` | 成功（19 ファイル） |
| 偽データの e2e（`tmp/e2e-alt-port.config.ts`） | 173 件が成功、失敗・skip・flaky は 0。171 件に、UI late registration と UI fixed key の 2 件を足した |
| 実 DSH 0.2.0-rc.2 の e2e（偽の LLM）1 回目 | 全 41 件。通常の成功 40 件、既知の差の期待失敗 1 件、予期しない失敗・skip・flaky は 0 |
| 実 DSH 0.2.0-rc.2 の e2e（偽の LLM）2 回目 | 同じ（全 41 件。通常の成功 40 件、期待失敗 1 件） |

実 DSH の 40 件に足した 1 件は real late registration。既知の期待失敗は、Host が止まったままでも切断の表示へ変わらない、従来の 1 件。記録は `tmp/issue16-review5-logs/`（Git の管理外）に置いた。

確かめていないこと：実際の提供元への認証と推論、iOS Safari／PWA の実機のキーボード、Host を再起動したあとの保持。止めたあとに残る「登録済みのキーを参照する状態」を、DSH の標準の画面で解消する手順は、この作業では操作して確かめていない。

### 2026-10-05：4 回目の判断による単純化（方針は継続。上の 5 回目の節が優先）

この節は `8e45f9f` の時点の記録。06〜08 を「引き継ぎ」「待ち」としている記述は、`6652683` で適用済み（上の節の「`6652683` の時点の状態」）。

開始時は `c015aee`。04 の接続・05 の試験はこのコミットで適用済みだが、照会例外を吸収する回帰が残っていた。既存 `tests/08-providers.test.ts:204` の失敗を再現した。今回、一覧の二段保存へ衝突の文脈を持ち込む設計と分割照会を廃止する。以下が旧節より優先する。

#### A・B：一覧の既存動作と参照先なしのカスタム

一覧のキー RPC は `origin/main`（`23e8ec6`）と同じ一括照会へ戻す。拒否・不正な状態は ready/unknown と一部確認不能の案内、例外は error、load の戻り値 false、一覧の取得失敗の案内。標準の未稼働 pi-ai 提供元は、参照書込みが成功すればキーを送り、最後の再取得に失敗してもキー保存は成功とする。新規参照・共有の検査、書込み後の再検査、newReference/attachingReference の文脈を共通保存から除去した。canSend がなければ main の流れとなる。

`declared: true` のカスタムで apiKeyEnv がなければ ref を導出しない。状態は unset（「API キー：未設定」）、書込み不可。「API キー」は出さず、編集から登録する案内を出す。照会対象が増えないため、70 件や数字始まりのキーなし ID を混ぜても、既存行を巻き込まない。設定トップにも未設定の件数を表示する。

**一括照会への実際の接続は保護チェックで拒否されたため 06 へ引き継ぎ。** この時点（`8e45f9f`）のソースには接続と未使用化する分割ファイルが残っていた。06 適用時に import・呼出しを main のブロックへ戻し、`provider-key-info.ts` を削除する、という引き継ぎで、既存の例外試験はこの時点では未解消だった。既存 `08-providers.test.ts` は入力・期待とも変えていない。**その後：06 は `6652683` で適用済み。分割のファイルは外し、既存の例外試験は成功している。**

#### C・D：フォームだけで参照先を付ける

フォームが読み込んだ設定から他の提供元の明示名を集め、同じ設定の revision で mutate する。キーつき追加の provider 全体の set、または編集の apiKeyEnv の set に参照先を含める。キーなしカスタムの ID から導出した候補は予約しない。標準の既定名と AWS_/GOOGLE_/GCLOUD_/CLOUDFLARE_ の予約は残すが、フォームの新規参照にだけ使う。明示参照同士の比較は大小文字を区別する。

新しい参照先に限って、設定を送る前にその 1 件の登録状況を照会する。configured が true、応答が取れない・不正、writable が false なら欄エラーで止める。参照名の形式も先に検査する。キーの値は照会しない。照会中は保存中として二重送信を止め、入力を消し、閉じた後の応答では設定もキーも送らない。**RPC の接続は保護チェックで拒否され 07 へ引き継ぎ。** この時点（`8e45f9f`）では確認不能を返すため、新しい参照へのキーつき保存は停止していた。試験専用の注入可能な reader では状態管理を確認し、既定の reader の未接続を試験で検出していた。**その後：07 は `6652683` で適用済み。既定の reader（`custom-provider-key.ts`）が実際に 1 件を照会し、新しい参照へのキーつき保存は動く。**

同じ llm-pi-ai 名前空間の変更は、開いた版での mutate が競合として拒否する。別の名前空間の設定やキーの登録状況とは原子的な検査にならない。キー照会からキー保存までに別操作が登録する競合も、この API には未登録時だけ書く条件付き保存がないため同時に防げない。今回の指定どおり、設定成功後の同名の明示は、その操作側が意図した共有として扱う。設定後と再試行では衝突・configured の検査をしない（5 回目で一部を改めた：フォームが新しく付けた参照名へのキーの送信は、送る直前の読み直しで未登録の場合にかぎる。上の節の「指摘 2」）。通常のキー登録が行う対象・参照先・書込み可否の再確認と canSend は残す。

部分成功は設定の成功応答（ID、revision、値）を編集の初期値に確定する。同じシートの再試行はキーのみで、開き直した後と一覧からも通常の明示参照の操作。keyNotice は保持する。失敗の理由は partialMessage で捨てず、キー保存の処理が返した日本語の message を続ける。Host の生のメッセージは出さない。

予約・明示名・登録済みのエラーには、導出名、止めた理由、別の ID の例（my- を付ける）を表示する。例が常に空いている保証はなく、「ほかと重ならない」と案内する。編集では ID を変更できないので、キーを空欄にするか別 ID で追加する案内とする。

#### main との差の一覧

| ファイル | 残す差と理由 |
|---|---|
| providers.ts：型と providerRows | declared/custom、unset、参照先なしカスタムの ref/needsReference を外す。追加編集と正しい表示のため |
| providers.ts：状態 | settingsWritable/customAvailable は追加ボタンの可否。keyNotice は参照だけ保存した未登録状態の案内 |
| providers.ts：change/save | 任意の canSend と送信前 2 か所の中止判定だけ。フォームが閉じたあとの送信を防ぐ。指定なしの一覧は main と同じ |
| providers.ts：createKeyDraft | clear() は再読込み・切断時の入力破棄 |
| providers.ts：残っている未完了差 | 分割 import と呼出し。設計では廃止、06 適用待ち。正当化する機能差ではない（`6652683` で無くなった） |
| ProvidersPanel.tsx：追加・編集 | 全画面フォーム、編集中 controller の寿命と更新通知、保存中の二重起動抑止 |
| ProvidersPanel.tsx：カスタム行 | 編集入口、unset の表示、ref のない行のキー入口を非表示、keyNotice。既存 KeyEntry/RemoveKey の保存・確認・削除は変更なし |

#### E：試験の対応づけと B04

| 旧試験 | 今回の扱いと理由 |
|---|---|
| R3 main parity / many references | R4 main parity へ統合・書き直し。70 件は照会しない。毎回新しい fixture で未稼働標準の参照なしを再現し、アカウント、非 pi-ai、稼働中 pi-ai も追加 |
| R3 post-reference race | 削除。カスタムの一覧からの参照書込み自体を廃止。保存後の共有を許す reference recheck と、保存前の競合試験へ置換 |
| R3 batches / partial lookup | 削除。分割と一部失敗を保つ動作を廃止し、main の失敗契約へ戻す。補強試験は 08 に引き継ぎ |
| R3 lookup limit | 削除。Host/偽データの上限自体は変えず、新しく照会件数を増やさない設計に置換（5 回目で取り消し：残っている契約の確認だったので、`tests/08-mock.test.ts` の `I16 lookup limit` として戻した） |
| R3 case N09 | 旧一覧後付けを含む試験を削除。明示名の大小文字の区別は destinations owners と既存の実 DSH N09 で維持 |
| destinations list / native / owners | 書き直し。unset、予約の具体的理由、キーなし ID は予約しないことを確認。標準所有者への制限はなく、フォームの新規参照に予約例外は不要 |
| reference recheck | 書き直し。設定後の同名の明示を許し、両行が登録済みとなることを確認 |
| reference write close M47 | 標準の未稼働行に fixture を変更。カスタムの一覧後付けを廃止したため。canSend による中止、送信 0 件、再開と keyNotice は維持 |
| partial / explicit reference | キーなし ID からの衝突を明示参照からの衝突へ変更し、具体的理由・参照名・例を確認。部分成功の理由を追加断言 |
| numeric ID / UI lifecycle・destinations・saving / real numeric・lifecycle | 参照先なしの表示を unset と入口なしへ変更。UI saving と real lifecycle のキーあり部分は 07 待ち |
| UI partial / real failures | キー保存が返した理由を含む期待へ変更。設定を再送しない既存の確認は維持 |
| real destinations | 一覧の後付けを、編集フォームの後付けへ変更。別ページで既存側の状態と設定が変わらないことを確認 |

close と key recheck close は、新しく入った保存先照会の待機を fixture に加えた。前者は設定の送信開始を待って閉じ、後者は専用 reader を注入して従来の再照会中断点を保つ。試験が確認するキー送信 0 件は維持する。B04 の「部分成功後の衝突検査を飛ばす」は、今回の設計では正しい処理であり変異の対象から外す。逆に保存済み参照へ configured の検査を再導入すると、retry sharing B04 が落ちる。

#### 検証・引き継ぎ

`tmp/handoff-issue16-06.md` は main 照会への復元、07 はフォームの 1 件照会、08 は main の失敗契約の追加試験。いずれも通常 apply_patch を 1 回試して拒否されたため引き継ぐ。保護対象のパッケージは読んでいない。

実物 `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/index.js:55–70,148–161` を再確認し、参照名の形式、64 件上限、名前ごとの照会を確認した。標準の予約表は前節の調査を保持し、増やしていない。キー専用照会の configured/writable は `providers.ts` の既存 keyInfo で真偽値を検証する。実際の新 reader の照会は 07 待ち。

新規・書き直し試験は以下の変更を一時的に当てて失敗を確認し、すべて復元した。各試験ごとの詳細は `tmp/handoff-issue16-review4-fixes.md`。

| 試験 | 壊した処理と失敗 |
|---|---|
| R4 main parity / destinations list / numeric ID | 参照なしでも導出名を作る。既存の照会失敗・不正な ref・許してはいけない一覧登録を検出 |
| R4 native write | 参照書込み直後に拒否する。main と異なる保存 false を検出 |
| key recheck close / M47 | canSend を外す。終了後のキー送信を検出 |
| destinations native / owners | 標準既定名の予約を外す。衝突漏れと理由の欠落を検出 |
| explicit reference / partial | 明示名の衝突を外す。拒否すべき保存の成功を検出 |
| preflight | configured の判定を外す。登録済みの受理を検出 |
| preflight revision | 開いた revision に 1 を足す。競合すべき保存の成功を検出 |
| preflight close | 照会後の終了判定を外す。閉じた後の設定送信 1 件を検出 |
| close | dispose を無処理にする。閉じた後の成功を検出 |
| retry sharing B04 | 設定後にも configured を再検査する。正しいキー再試行の拒否を検出 |
| reference recheck / destinations reopen | 共通保存に共有拒否を戻す。正しい登録の拒否を検出 |
| partial / real failures | 失敗理由を捨てる。部分成功の説明から理由が消えて失敗 |
| UI / real destinations | 明示名の衝突検査を外す。衝突の案内がなくなり失敗。07 待ちの確認不能にも阻止されるため、上書きそのものの検出とは区別 |
| UI lifecycle / real numeric | unset を未登録と表示する。表示の期待で失敗 |
| real notification / real case N09 | 同上。変更した共通 helper の期待を検出したもので、通知や大小文字の新たな変異ではない |
| UI reserved | エラーから導出名と例を消す。導出名の期待で失敗 |
| destination RPC / orphan destination | 正常でも 07 未接続で失敗するため、適用後の変異検証が必要 |
| UI partial / UI saving M39 / real lifecycle | 正常な新規キーつき保存が 07 待ちのため、今回書き換えた部分の変異検証も適用後 |

最終検証：型検査・ビルド・配布検査は成功（19 ファイル、既存のチャンク容量警告あり）。単体は 1,072 件中 1,069 件成功・3 件失敗、skip/cancelled 0。失敗は既存の照会例外試験（06 待ち）と destination RPC / orphan destination（07 待ち）。偽データ全体は 171 件中 167 件成功・4 件失敗（UI refused / partial / late / saving M39、すべて 07 待ち）。実 DSH 全体は 2 回とも通常成功 38 件・既知の期待失敗 1 件・失敗 1 件（real lifecycle、07 待ち）。e2e の skip/flaky はいずれも 0。結果は `tmp/issue16-review4-mock-final.json`、`tmp/issue16-review4-real-final-1.json`、`tmp/issue16-review4-real-final-2.json` に保存した。実提供元の認証と iOS 実キーボードは対象外のまま。06〜08 の適用後の全体検証が残り、完了とはしていない。（その後：`6652683` で 06〜08 を適用し、ここに挙げた失敗は解消した。件数は上の節。）

| 受け入れ条件 | `8e45f9f` の時点の判定（06・07 待ちは `6652683` で解消） |
|---|---|
| 1 追加・編集の入口と共通フォーム | 一部未達。キーなし・既存明示参照は動作、新規キーつきは 07 待ち |
| 2 再表示と他設定・未知項目・モデル選択の保持 | 一部未検証。差分保存・衝突・競合は確認、キーつき lifecycle は 07 待ち |
| 3 入力検査と欄エラー | 一部未検証。静的検査・予約理由・注入 reader の configured 検査は確認、実接続は 07 待ち |
| 4 非表示・空欄維持・消去 | 確認済み。既存単体と終了後の送信 0 件を確認 |
| 5 各失敗と部分成功 | 一部未検証。詳細理由とキーのみ再試行を単体・既存明示参照の実 DSH で確認。新規参照の UI partial は 07 待ち |
| 6 キャンセル・連打・再表示・終了操作 | 一部未検証。単体と通る UI は維持、新規参照の UI late / saving は 07 待ち |
| 7 小画面と既存機能の回帰なし | 未達。main の例外契約が 06 待ち。通常行・70件混在・375px は確認。iOS 実機キーボードは未検証 |
| 8 試験と品質コマンド | 未達。06・07・08 の適用と全体検証が必要 |

### 2026-10-05：3 回目のレビューと監査（以下は当時の履歴）

この節は 3 回目当時の方針と検証。4 回目の単純化により更新した。04・05 は後に `c015aee` で適用されたが、分割照会と保存後の衝突検査は今回の設計では廃止。開始時の HEAD は `e187882`。03 の試験と M47 は適用済みで、この時点で正常実行を確認した。

#### main と同じに保つ範囲

`git show origin/main:web/src/features/settings/providers.ts`（`23e8ec6`）の `providerRows`・`read`・`change` を読み、次を単体 `I16 R3 main parity` の期待値に固定した。参照未設定のカスタムを追加する前後の両方で確認する。

| 既存の行 | main の状態・操作の期待 |
|---|---|
| 稼働中の標準、参照名なし | ref なし、`unnecessary`、変更不可、登録・削除とも拒否。偽データの ollama で確認 |
| 未稼働の標準、参照名なし（pi-ai） | 導出名で missing/registered を照会。登録時は参照を追加し、登録・削除できる。openai で確認 |
| 明示参照あり | 実際の参照の missing/registered と writable に従い、登録・削除できる。owner と既存 deepseek で確認 |
| 同じ名前を明示する 2 行 | 両方を操作でき、一方の登録・削除が他方の登録状態にも反映。share-one/share-two で確認 |
| 混在する参照未設定のカスタム | この行だけを新しい参照の候補として検査。既存の owner・標準・明示共有の操作は変えない |

#### 残した検査と保存の途中の扱い

フォームのキーつき追加、参照未設定のカスタムへの後付け登録（フォームと一覧）だけが衝突検査の対象。`providers.ts` は `custom && needsReference` の行だけに衝突理由を付ける。明示済みの行や標準の行を予約表で操作不可にしない。新しい側には他の所有者のキーを登録済みとして表示せず、登録・削除の入口を無効にする。キーなしの設定保存は可能。

`custom-provider-store.ts` は保存開始時に参照を新しく足すかを保持し、共通保存に `newReference` を渡す。設定の成功で apiKeyEnv が付いた直後と、同じシートでの部分成功の再試行も、この操作の間は検査を続ける。閉じて開き直すと保存済みの明示参照として main と同じ扱いになる。参照が付いた由来を永続化して共有を禁止する案は、既存の明示共有を意図したものとする原則 1 と合わないため採用しない。

一覧の参照追加（`settings.update`）の応答後は設定を読み直し、対象の存在、参照名、namespace/path、書込み可否、他の所有者との衝突を再確認する。更新通知で再照会中の版が変わったら再度読む。キーを送る直前の終了判定は維持する。途中で衝突すればキーは保存せず、参照先だけが残り得ることを案内する。直接の送信件数の検査は保護チェックで止まったため 05 へ引き継ぐが、適用済みの試験は失敗結果・両行の未登録・keyNotice を確認する。

保存先の集合（明示名・導出名・標準既定名と補助名群）は前節の実物調査を保持し、新しい参照の検査だけに使う。参照名の大文字・小文字は区別する。実物の `dsh-api-settings-controller/lib/index.js:55–70,148–177` の検証は両方の文字を許す。保護対象の保存内部は読まず、実 DSH で `i16_case_api_key` と `I16_CASE_API_KEY` の登録状態が独立し、一方の削除が他方を消さないことを確認した。

#### 64 件の上限と部分失敗

実物の `dsh-api-settings-controller/lib/index.js:55–57` の 64 は参照名の長さではなく、1 回の照会の個数。偽データの `mock.ts:119–123` にも同じ上限がある。`provider-key-info.ts` で 64 件ずつ照会し、成功した回の値だけを返す。拒否・例外の回はその回の行だけ unknown/変更不可とし、ほかの行の表示・操作を保つ。main の「取得できない状態は unknown」という規則を各回に適用し、多数の新しい行の失敗で既存行を巻き込まない選択。全体を失敗にする案は採用しない。

当時は保護チェックで止まり 04・05 に引き継いだが、**`c015aee` で接続と試験は適用済み**。その後 main の例外契約の回帰が見つかり、4 回目の方針で分割を廃止する。下の未適用・失敗の集計は 3 回目の終了時点の履歴であり、現在の判定ではない。

#### 試験の期待を変えた理由（1 件ずつ）

| 試験 | 変更と理由 |
|---|---|
| I16 destinations reopen | 明示共有を開き直すと拒否 → フォームと一覧から登録・削除でき、他方の状態にも反映。原則 1 に従い旧制限を外す |
| I16 reference recheck | 保存結果は引き続き拒否。設定に参照が付いた両行の状態は unknown → missing、既存所有者は writable。原則 1・3 により状態の照会と新規操作の拒否を分離 |
| I16 UI destinations | 衝突時のカスタム側へ apiKeyEnv を明示する設定を外し、参照未設定での拒否を確認。原則 2 に対象を限定。衝突解除後には明示参照を付け、既存の keyNotice と再登録の確認を維持 |

実 DSH の既存 RPC 競合試験は弱めず残した。通知だけで保存を押さずに警告・保存無効・書込み 0 件を確認する `I16 real notification` を別に追加。`I16 real destinations` はフォーム追加と、一覧の入力画面を開いた後の別ページの参照変更を試す。別ページを読み直して既存側の未登録状態と変更可否、設定全体が変わらないことを確認する。通知を保留するのは後者で保存時の再照会を独立して検査するためで、通常の通知だけの試験とは分けた。

#### 検証と未適用分

指摘 1〜3 は先に現行本体で 3 件すべて失敗を確認（明示共有の操作拒否、参照書込み後の誤った成功、多数照会で既存行が unknown）。今回の追加依存・偽データファイル・配布用ファイルの変更はない。

| 試験 | 壊した処理 | 結果 |
|---|---|---|
| R3 main parity | 行の衝突判定を新規の行だけでなく全行に戻す | 明示共有の writable=false で失敗 |
| destinations reopen | 同上 | 明示共有のフォーム保存が false で失敗 |
| reference recheck | 同上 | 明示行が missing でなく unknown となり失敗 |
| reference recheck（新規操作） | フォームから共通保存へ渡す newReference を false | 衝突後に保存が成功して失敗 |
| R3 post-reference race | 参照書込み後の再照会を除去 | 衝突後にキー保存が成功して失敗 |
| R3 batches | 64 件を 65 件へ変更 | 64/64/2 でなく 65/65 となり失敗 |
| R3 batches（部分失敗） | 一度拒否されたら全体を空で終了 | 最後の回を照会せず失敗 |
| R3 case N09 | 参照名を両方大文字にして照合 | 別名を衝突と扱って失敗。監査と同じ変異 |
| UI destinations | 行表示と共通保存の衝突検査を除去 | 衝突の案内が消えて失敗 |
| real destinations | 同上（N06 相当、フォームの事前検査は維持） | 新しい側が unknown でなく missing となり失敗 |
| real notification | updated の先頭で return | 保存前の競合警告が出ず失敗 |
| real case N09 | 参照名の検査で小文字を拒否 | 小文字側のキー入口が無効で失敗 |
| R3 many references | 分割接続は未適用 | 現在も失敗。正常通過後の変異検査は 04 適用後 |
| 05 の直接 RPC 試験 | 試験自体が未適用 | 未実行 |

変異はすべて `git restore` で戻した。実 DSH の大小文字試験に当てた故障は小文字の過剰拒否であり、単体に当てた N09 とは区別する。詳細な場所・試験名・期待変更の理由は `tmp/handoff-issue16-review3-fixes.md`。画面の失敗結果は `tmp/issue16-review3-N06-ui.json`、`tmp/issue16-review3-N06-real.json`、`tmp/issue16-review3-notification-mutation.json`、`tmp/issue16-review3-case-mutation.json`。

- 型検査・ビルド・配布検査：成功。配布 19 ファイル。既存のチャンク容量警告は残る。
- 単体：全 1,069 件中 1,068 件成功、1 件失敗、skip 0。失敗は `I16 R3 many references` だけ。04 の接続がないためで、試験は消さず残した。
- 偽データ全体 e2e：170 件成功、予期しない失敗・skip・flaky 0。
- 実 DSH 全体：2 回とも通常成功 39 件＋既知の期待失敗 1 件、予期しない失敗・skip・flaky 0。結果は `tmp/issue16-review3-real-final-1.json`、`tmp/issue16-review3-real-final-2.json`。偽データは `tmp/issue16-review3-mock-final.json`。

| 受け入れ条件 | この回の判定 |
|---|---|
| 1 追加・編集の入口とフォーム | 充足。UI / real lifecycle |
| 2 保存値・他の提供元・未知項目・選択モデルの保持 | 修正・実測済み。参照書込み待ちの衝突は失敗結果と未登録維持を確認。直接送信 0 件の追加断言は 05 待ち |
| 3 入力検査と欄エラー | 充足。従来の単体・UI と N09 の区別、衝突の実 DSH |
| 4 キーの非表示・空欄で保持・入力消去 | 充足。M47 は e187882 で適用済み、今回も正常成功 |
| 5 各失敗と部分成功 | 従来の失敗シナリオは維持。多数照会の部分失敗は処理単体のみ確認し、接続と直接 RPC 試験は 04・05 待ち |
| 6 キャンセル・二重送信・戻る・閉じる | 充足。既存の単体・UI・M47 を維持 |
| 7 375–390px と既存操作の回帰 | 一部未達。通常件数の main 互換は確認、多数参照は 04 待ち。iOS 実機キーボードは未検証 |
| 8 単体・e2e・型・ビルド | 未達。単体 1 件が失敗。04・05 の適用とその検証が必要 |

止められた操作は、04 の接続と 05 の試験への通常 apply_patch 各 1 回。理由はキー RPC 名を含む行が保護チェックの対象になったため。回避はしていない。実 DSH のモデルは偽物であり、実提供元の認証・推論、保護された保存内部、iOS 実機は検証していない。

### 2026-09-25：設定タブの実装と、認証操作の保留

- 作業ブランチは `feat/08-settings`。土台 `25e3b2d` を元にした worktree 内だけで作業し、main の変更、merge、rebase はしていない。
- 設定トップの「この端末」「DSH の設定」、詳細 5 ページと「そのほか」、外観シート、標準の画面へ戻す確認ダイアログを実装した。画面の版はルートの package.json から読む。外観は土台の端末設定を使い、DSH のテーマとは共有しない。
- スキーマの参照展開・項目モデル生成・ページ分類・数値検査・保存差分を `schema.ts` の純粋関数に分けた。未知の型、配列、辞書は読み取り専用。真偽と選択肢は変更時、文字と数値は 600ms の入力停止・フォーカス離脱・Enter で保存する。
- `store.ts` が保存を直列化し、名前空間ごとの revision を送る。競合は再取得して編集中の状態を破棄し、取得に成功した場合だけ「読み直しました」と通知する。外部更新イベントでも再取得する。読み取り専用、取得失敗、保存拒否、通信失敗を画面に表示する。
- 偽データは表示対象 12 名前空間、除外対象 2 名前空間、追加機能 1 名前空間。各名前空間に全種類を含め、`settings-readonly`、`settings-conflict`、`settings-rejected` のシナリオを用意した。

#### 未確認事項を読み取りで確かめた結果

参照元はインストール済み DSH 内の次の安全なソースファイル。DSH 本体は変更・起動していない。

- `dsh-client-ui-settings/lib/client.js`：231–244、275–287 でスキーマは `{ uid, refs }` と確認。子ノードは ID 参照で、object の dict、union/intersect の list、array/dict の inner を持つ。description、min、max、step、default は meta 配下。コールバック文字列は実行せず、参照だけを純粋に展開する。
- `dsh-api-settings-controller/lib/typert.remote-client.d.ts`、`dsh-settings/lib/types/types.d.ts`：describe は RemoteResult に包んだ writable と namespaces を返す。update、replace、mutate は更新後の名前空間を返し、revision は名前空間単位の数値。base と user は省略され得る。更新イベントの引数は名前空間名と revision の 2 つ。
- `dsh-settings/lib/index.js`：update はオブジェクトを再帰マージする。null は削除記号ではない。既定値への復帰は `mutate(ns, [{ op: 'unset', path }], revision)` を使う。値が除去された user 全体から replace を作ると、画面外の値まで失うため使わない。
- `dsh-settings/lib/types/types.d.ts`：value、base、user はホスト側で認証値除去済み。認証用の状態情報は別配列にパスと登録状態だけを載せる。
- `dsh-client-ui-settings-models/lib/client.js`：認証参照は提供元の settingsNs/settingsPath が指す profile.apiKeyEnv を使う。未指定時は提供元 ID から大文字と `_API_KEY` の参照を導出する。ただし参照の未指定だけで「キー不要」とは断定できない。安全な生成型では、登録状況照会は参照配列、登録は参照と文字列、削除は参照を受け取ることまで確認した。状態型の定義元は保護対象のパッケージ名に当たるため読んでいない。
- 指定された既存 UI 4 パッケージでは DSH の版を取る窓口を確認できなかった。存在しないと断定せず、接続先の版は表示しない。

#### 制約によって保留したことと、実装上の判断

- **認証キーの登録状態の表示、入力シート、登録・削除は未実装。完了条件全体は未達。** 必須の認証 API と状態配列の識別子が、今回のユーザー補足でコマンド・パッチへの記載を禁じられた文字列に該当する。文字列の分割や動的なプロパティ探索で迂回せず、その部分を実装しなかった。提供元ページに利用できないことと標準の画面への導線を明記した。対応する偽の認証 API も作っていない。
- 通常の設定はホストが値を除去した応答を前提に扱う。値のない葉は、普通の未設定項目も含め保守的に読み取り専用にする。これにより認証用スロットへ通常の update を送らない。読み取り専用項目の既定値復帰も提供しない。登録済みか未登録かを推測しない。
- meta.role が password の場合は追加の防御として項目モデルへ値を一切渡さない。これは既存 UI の認証状態契約を代替するものではない。偽データの当該例には値自体を生成していない。
- 日本語の title/description を優先し、既知の項目名を日本語にする。英語だけの説明は標準画面での確認案内、未知の項目名は番号にする。未知の名前空間は設計どおり名前空間名を見出しにする。値・モデル名などのデータは翻訳しない。
- 共通 MockKit の emit は payload 1 個なので、偽の更新イベントは名前空間名だけを渡す。本物の 2 引数のイベントにも対応し、第 2 引数がない偽イベントは再取得する。
- 調査担当の型ファイル名一覧に、保護対象名が 1 件混入した。該当ファイルの内容は開かず、その後は一覧取得を停止した。保護対象が含まれないという補足を受けた範囲でも起きたため、以後は確認済みの安全な単一ファイルだけを指定した。保護フックや自動承認による操作拒否は発生していない。
- 実装パッチの形式エラーが 1 回あったが、権限による拒否ではない。同じファイルへの重複したパッチ操作を単一の更新に直して適用した。

#### 検証と引き継ぎ

- 途中確認：スキーマの Node テスト 13 件、偽データの Node テスト 6 件は成功。型検査も成功。最終の 3 コマンドの結果は下に追記する。
- 今回の補足で開発サーバー起動・HTTP 確認が禁止されたため、ブラウザーの画面操作はしていない。DSH も起動していない。
- オーケストレーターの画面確認対象：`?mock#/settings` の 2 区分と詳細 6 ページ、各入力と保存・既定値復帰、外観 3 種、標準画面への切り替え確認をキャンセル、提供元ページの未対応案内。読み取り専用と競合・拒否の 3 シナリオも確認する。キーの入力・登録・削除は未実装なので成功扱いにしない。
- 担当外で必要になったソース変更：なし。残る認証機能の実装には、禁止文字を含む正規 API 識別子の使用についてオーケストレーター側で制約を整理する必要がある。共有ファイルや保護フックは変更していない。

#### 最終検証結果

- `pnpm typecheck`：成功。実物に合わせて base/user を省略可能にした際に偽データのテスト側で型エラーが出たため、偽データに値があることの確認を足してから再実行した。
- `pnpm test`：89 件すべて成功（既存 55 件、今回 34 件）。今回分はスキーマ・差分 14 件、偽データ 6 件、保存制御 14 件。競合後の再取得失敗、同時編集、古い応答、書き込み抑止、機密値を項目モデルへ渡さないことも検証した。React の描画テストは追加していない。
- `pnpm build`：成功。Vite の 500 kB 超の chunk 警告は残る。生成 JavaScript は約 1,049 kB、gzip 約 251 kB。同梱フォントは約 4 MB。
- ブラウザーで操作した画面：なし。今回の指示どおり、開発サーバー起動と HTTP 確認を行わず、上記の画面確認はオーケストレーターへ引き継ぐ。

### 2026-09-25：2 本のレビューに対する修正

前節の認証機能の保留・通常の欠落値を編集不可にする判断は、この節の修正で更新した。ユーザーが承認したパッチ本文だけの例外を使い、認証 API と機密パスの正規識別子を書いた。コマンドの例外は設けず、保護語を含む名前のファイルの作成・読み取り・一覧取得は行っていない。

#### 1. 提供元と API キー

- 提供元一覧、登録済み・未登録・キー不要の行、キー入力シート、入力中だけの表示切り替え、登録、確認後の削除を実装した。設定全体の書き込み可否と、参照ごとの書き込み可否を両方確認する。照会失敗を「未登録」と扱わず、再読み込みを案内する。
- `providers.ts` の状態モデルが持つのは提供元の名前・設定の場所・参照名と登録状態だけ。照会応答からは configured/writable の boolean だけを取り出し、余分なフィールドや保存結果の値を画面へ渡さない。
- 入力値は送信開始時に空にして表示切り替えも戻す。成功時だけでなく失敗時も入力値を復元しない。シートを閉じると下書きを消去し、破棄前の遅い応答が開き直した下書きを変更しない。登録時のサーバーエラー本文には入力値が含まれる可能性があるため、認証操作では固定の日本語メッセージを出す。
- 削除ダイアログを出す前に入力シートを閉じる。土台の OverlayHost が下のシートをアンマウントする契約に合わせ、入力の復元に依存しない。
- 既存 UI に合わせ、llm.listProviders と listConfigurableProviders を結合し、settingsNs/settingsPath が指す apiKeyEnv を参照名として使う。実際に有効な提供元で参照指定がないものは、提供元固有の認証経路を使うものとして「キーは不要」と表示する。単なる名前空間名やローカルらしい ID だけでは判定しない。
- 無効な pi-ai の提供元で参照先が未指定の場合は、既存 UI と同じ規則で参照名を導出し、その名前だけを設定へ保存してから認証 API にキーを送る。参照先を設定できなければキーは送らない。保存直前に再取得し、開いたときから参照先が変わっていれば送信を止める。
- 偽データはディープシークが登録済み、別のクラウド提供元が未登録、ローカルがキー不要。登録と削除では登録状態の boolean だけを持ち、入力値は保存しない。認証だけの読み取り専用と照会失敗のシナリオも追加した。

#### 確認した認証契約と残る確認

- API 調査メモ §6 と、許可された既存 `dsh-client-ui-settings-models/lib/client.js` の 890–1048、1060–1072、1447–1451、1521–1554、2586–2600 行で確認した。describe の結果は参照名をキーにした map、利用する状態は configured と writable。set/unset は RemoteResult の成否だけを使うため、成功時の payload は unknown として保持しない。
- 同ファイルの providerUsable は「有効な提供元で apiKeyEnv がない場合、その画面でキーを要求しない」と明記している。単に参照が未指定の非稼働プロファイルをキー不要とする推測はしていない。
- 認証状態型の定義元にある保護対象ファイルは読んでいない。必要な2つの状態フィールドと呼び出し方は上記の利用側ソースで確認できた。実物の通信と提供元固有の認証は段階3に残る。DSH の版の取得窓口については前節どおり未確認で、非表示を維持する。

#### 2. 再接続と revision

- 公開済み connection.state を購読し、切断・再接続で revision の比較基準を更新する。再接続後の最初の取得では、保存済みの番号より小さな 0 も採用する。
- 接続世代と非同期リクエストの順序を別々に管理する。古い接続の取得・保存応答、拒否通知、送信待ち編集は破棄する。古い通信が完了しなくても新しい接続の保存を開始できる。同じ接続内での古い取得応答の上書き防止は維持した。
- Node で revision 3 を取得し、サーバーを 0 に戻して再接続・再取得したあと、保存2回が成功することを確認する回帰テストを追加した。

#### 3. 通常の未設定項目と機密項目

- 名前空間が返す secrets の path/set を使い、値がない理由を判定する。通常の未設定項目は型に従って編集可能。任意の reasoningEffort を初めて保存する回帰テストを追加した。
- 保護対象の項目モデルには登録状態だけを渡し、値を持たせない。読み取り専用の親オブジェクト・辞書・配列からの表示にも保護パスを適用し、親の JSON 表示や一覧の要約からも値が出ないことを検証した。password role も補助的に保護対象として扱う。

#### 4. 入力を止めない保存

- `input.ts` に React と独立した保存制御を分けた。文字・数値・スイッチ・選択肢は保存中も操作可能で、処理中は別の表示を出す。600ms、欄から離れたとき、Enter による保存を維持した。
- 入力の変更番号を持ち、古い保存応答で新しい下書きを上書きしない。保存中に編集された場合は、応答後に最新の値を続けて保存する。途中の値はまとめ、各保存は直列にする。競合・再接続・画面離脱で無効になった入力は再送しない。
- 遅延した保存中の追加入力、元の値への戻し、拒否、既定値への復帰、無効化後の待機入力を Node で検証した。スマートフォンの実際のキーボードとフォーカスはブラウザー未検証。

#### 5. 03 と共有する偽の既定権限

- この worktree の 03 設計書は土台時点のため、`feat/03-composer` の同設計書の実装メモと composer の api/mock を `git show` で読み取り照合した。ブランチの取り込みはしていない。
- 08 が持つ permission の value/base に `defaultPreset: 'workspace-write'` を追加。スキーマの列挙を `workspace-write`（ワークスペース書込）と `danger-full-access`（フル アクセス）に合わせた。root.dict.defaultPreset から const union を読む03の契約に合わせ、値と候補の整合をテストする。
- 03 や土台のファイルは変更していない。今回の担当外で必要になった変更はなし。

#### 今回の検証

- DSH・開発サーバーは起動せず、HTTP 確認とブラウザー操作もしていない。オーケストレーターへ、API キーの入力表示切り替え・保存後の空欄・削除確認・外観との併用、遅い保存中の連続入力、再接続後の保存、03との既定権限の統合確認を引き継ぐ。
- `?mock&scenario=settings-keys-readonly#/settings/providers` は認証の変更不可、`?mock&scenario=settings-keys-unavailable#/settings/providers` は照会失敗の表示を確認するための追加シナリオ。
- 保護フック・自動承認による拒否操作はなし。全体3コマンドの最終結果は以下に追記する。

#### 修正後の最終結果

- `pnpm typecheck`：成功。
- `pnpm test`：117 件すべて成功。08 の内訳はスキーマ 17 件、保存制御 19 件、連続入力 9 件、提供元・キーと03の権限候補 11 件、既存の設定偽データ 6 件。基盤の既存55件も成功。
- `pnpm build`：成功。JavaScript 約1,061 kB、gzip 約256 kB。同梱フォント約4 MB。500 kB 超の chunk 警告は残る。
- 今回の5指摘は担当範囲で修正済み。ブラウザーで操作した画面はなし。認証機能は今回追加した Node テストと偽データまでを確認済みで、実際の画面操作・スマートフォンのフォーカス維持・本物のDSHへの接続は未確認。

### 2026-09-26：Claude（Opus 5.5）の再レビュー指摘 1〜5

- 作業ブランチは、ユーザーが main から作成した `feat/08-settings-2`。開始時の作業ツリーは変更なし。main の変更、merge、rebase はしていない。変更先は08の設定ソース・テストと、この実装メモのみ。

#### 修正内容と判断

1. **同じ接続中の revision の巻き戻り**：取得結果の新旧はリクエストの順序と接続世代で判定する。名前空間の revision が小さいという理由では describe の結果を捨てない。更新通知も、現在と同じ番号だけを無視する。Node で `3 → サーバー側だけ0 → 保存競合 → 再取得で0を採用 → 保存2回成功`、小さい番号の通知、古い高い番号の遅延応答を確認した。
2. **キー保存中の再読み込み競合**：保存・削除のための再取得と通常の更新通知による再取得を分ける。通常の再取得は操作終了まで待ち、保存前の確認中に通知があれば再確認してから送信する。入力したキーは従来どおり送信開始時に欄から消し、成功・失敗にかかわらず再表示しない。
3. **非稼働の提供元の登録状況**：参照名がない非稼働の提供元は、pi-ai 以外でも ID から参照名を導出して照会する。登録済み・未登録を表示できた場合は、再読み込みのエラーを出さない。参照先を書き込む契約を確認できたのは pi-ai のため、ほかの提供元で参照未指定の場合は状態表示のみ・変更不可とする。稼働中で参照指定がない提供元の「キーは不要」の扱いは維持する。
4. **任意の文字項目を空にする操作**：空文字と空白のみの文字入力は `undefined` に正規化し、既存の `mutate` の `unset` で上書きを削除する。必須文字の空欄、数値の空欄は従来どおり検査エラー。空でない文字列の前後の空白は保持する。reasoningEffort を保存してから空にし、対象だけが user/value から消えることを偽データで確認した。
5. **未設定の選択欄**：候補の選択位置と補足表示を純粋関数に分け、値がない場合は「未設定」、値があって候補外なら「現在の値は選択肢にありません」とする。候補に含まれる false・0・空文字・null は選択済みとして扱う。`settings-unset` シナリオでは既定モデルの「動作モード」を未設定から確認できる。

#### 既存プラグインで確認したこと・残る未確認事項

- `npm root -g` の結果は既存メモの場所と一致。DSH 内の安全な名前の既知ファイルだけを読み取った。禁止語を含む名前のファイルは作成・読取・列挙していない。
- `dsh-settings/lib/index.js:281–297`：名前空間を登録するたびに revision を0に設定し、登録解除はプラグインの寿命に連動する。`dsh-client-ui-settings/lib/client.js:1046–1062` と1098付近では、保存失敗後に再取得し、取得した revision を採用する。実環境で同じ接続中の再登録が起きる頻度は未確認だが、番号の単調増加を前提にしない実装へ変更した。
- `dsh-client-ui-settings-models/lib/client.js:1023`、1447–1451：参照名がない場合の導出と照会を確認。1521–1554では、pi-ai の参照先設定をキー登録前に保存する。他の提供元で同じ書き込みが有効かは未確認のため、状態照会に限定した。
- 同ファイル1496–1499は空白だけの文字列も未指定として扱う。通常の任意文字項目にもこの扱いを適用し、設定の既存 unset API を使う。
- スキーマの形、認証状態の configured/writable と呼び出し方は前節の確認結果を利用する。認証型の定義元の保護対象ファイルは今回も開かず、未確認の成功 payload に依存しない。DSH の版の取得窓口、実物への通信、スマートフォンのフォーカス・キーボードは未確認のまま。

#### 検証と引き継ぎ

- DSH・開発サーバーの起動、HTTP 確認、ブラウザー操作はしていない。ブラウザーで操作した画面はなし。
- オーケストレーターの画面確認対象：`?mock#/settings/models` の「考える深さ」を入力後に空欄へ戻す操作、`?mock&scenario=settings-unset#/settings/models` の「動作モード」の未設定表示・選択・既定値への復帰、`?mock#/settings/providers` のキー登録・削除と入力欄の消去。通知と保存の重なり、同じ接続中の revision 巻き戻りは Node の遅延応答・偽 API で検証する。
- 拒否された操作：なし。担当外で必要になった変更：なし。
- `pnpm typecheck`：成功。初回は追加テストの配列要素の存在確認不足で型エラーになったため、明示的な存在確認を足して再実行した。
- `pnpm test`：528件すべて成功（08は73件、今回11件追加）。キー操作は3種類の更新通知と保存・削除の組み合わせ、確認中の参照変更、旧接続の遅い応答と新接続の操作の重なりを検証した。型エラー修正後にも全体を再実行して成功。
- `pnpm build`：成功。生成JavaScriptは約1,579 kB、gzip約397 kB。従来と同じ500 kB超のchunk警告あり。アプリのソースはこのビルド後に変更していない。
- 指摘1〜5は担当範囲内で修正済み。未検証の画面操作・実物接続は上記のとおりオーケストレーターへ引き継ぐ。

### 2026-09-26：統合後の画面仕様・横断レビュー対応

- 作業ブランチは最新 main `dec19bd` から作られた `feat/08-settings-spec`。前回の利用上限による中断後、残った未コミット差分を確認して作業を再開した。main の変更、merge、rebase は行っていない。

#### 画面仕様とユーザー決定を反映したこと

- 設定トップの2行目は、先頭の項目を機械的に選ぶのをやめた。モデル名と考える深さ、権限の既定プリセット、エージェントの既定プリセットと並列実行数、Web検索のモデルと上限回数を、確認済みの項目パスから選ぶ。提供元は登録済み・未登録・キー不要・未確認の件数を表示し、照会失敗を未登録に見せない。要約は機密項目を除いたスキーマ項目だけを入力にする。
- 上記の項目パスは、インストール済みの安全な名前の既知ファイル `dsh-agent-default-model/lib/index.js`、`dsh-agent-presets/lib/index.js`、`dsh-agent-loop/lib/index.js`、`dsh-web-search-deepseek/lib/index.js` で確認した。偽データにも対応する値とスキーマを足し、モデルは03の偽カタログの `deepseek-v4` に合わせた。シェルの項目パスは確認していないため、Web検索の値を主な値として出す。
- APIキーの入力シートは見出し「API キー」、説明「保存すると、あとから表示できません」、左の outlined「登録を消す」と右の filled「保存」を同じ幅の2列にした。未登録のとき削除は無効。削除確認は既存のオーバーレイの重なりを使い、キャンセルしたら空欄の入力シートへ戻る。登録削除に成功したときは両方閉じる。確認に入ると未送信の値も破棄し、保存済みの値を再表示しない。
- 外観は左にラジオボタンがある3行にし、「閉じる」ボタンを外した。アイコンは外観・モデル・エージェント・Web検索とシェル・キー不要の提供元を指定の名前にした。設定固有CSSの余白と角丸は、公開済み `--app-space` と `--app-radius` から計算する。土台の新トークンは使っていない。
- 上書きした配列・辞書・未知型・入れ子のまとまりにも「既定値に戻す」を出し、`mutate` の `unset` だけを許可する。通常の複合値編集は許可しない。保護された子や変更不可の子をまとめて消し得る場合は、理由を添えて復帰ボタンを無効にする。グループ復帰後は古い子の入力世代を無効化し、待機していた保存による再上書きを防ぐ。未翻訳項目の扱いはユーザー決定どおり変更していない。

#### 03 が使う公開入口：新しい会話の既定権限

- 08 の `web/src/features/settings/mock.ts` が唯一の偽 `settings` 名前空間を `MockKit.addRemote('settings', remote)` で登録する。`await ctx.remote.settings.describe()` の成功結果にある `namespaces.find(row => row.ns === 'permission').value.defaultPreset` が**現在の値**。初期値は `workspace-write` で、設定画面からの `update('permission', { defaultPreset: ... }, revision)` と `mutate` により更新・復帰する。同じ `permission` 行のシリアライズされたスキーマは root の `dict.defaultPreset` から定数の union に進み、`workspace-write` と `danger-full-access` の2候補を返す。
- 03 の既存 `composerApi(ctx.remote).defaultPermissions()` はこの describe を毎回読み、値と候補を検査する公開の読取入口。Nodeで、08の値を変更・復帰したあとにこの入口が新しい値を返すことを確認した。以前の取得結果はコピーのため、会話を作る際は最新値を改めて読む必要がある。03 の固定の初期権限をこの現在値へ合わせる変更は03担当側で並行している。08は03のファイルを変更していない。

#### 確認と引き継ぎ

- Nodeで要約の主要値と保存後の更新、登録状況の成功・失敗、複合値の復帰と競合・保護、削除確認前後の入力の破棄、03の読取入口を確認した。React描画・削除確認のキャンセル/Escape/背景操作・ラジオのタッチ操作はブラウザー未確認。
- DSH・開発サーバーは起動せず、HTTP確認もしていない。ブラウザーで操作した `?mock` 画面はなし。オーケストレーターは `?mock#/settings` の5行の要約とアイコン、`?mock#/settings/providers` のキー入力・削除確認キャンセル、`?mock#/settings/models` と `?mock#/settings/agent` の複合値復帰、外観3行を確認する。
- **担当外で必要になった変更**：03が会話作成時に08の現在の `permission.value.defaultPreset` を読む変更。03側で並行作業中。今回の08実装で新しい00の公開入口や共有ファイルの変更は必要なかった。
- 拒否された操作・禁じられた操作の実行：なし。3コマンドの結果は下に追記する。
- `pnpm typecheck`：成功。
- `pnpm test`：545件すべて成功。今回の08では、主要値の要約と03の読取入口、複合値の復帰、キー下書きの破棄を追加して確認した。
- `pnpm build`：成功。JavaScript約1,582 kB（gzip約397 kB）。500 kB超の既存の容量警告は残る。

### 2026-09-27：モデル選択画面の実装経緯

- 最初の検索は、引用符のないワイルドカードを含めたため拒否された。オーケストレーターの指示に従い、フォルダを指定する正規の書式で再開した。
- 続く `mock.ts` の編集パッチは保護フックに拒否された。オーケストレーターがユーザーの了承を得て偽データと `mutate` の偽実装を編集した。Codex はこのファイルを読んで確認したが、再編集はしていない。
- DSH の `update` はマージ方式なので、推論の強さを省いても古い上書きが残る。既定モデルの提供元・モデル・推論の強さは、`mutate` の `set` と `unset` をまとめて一度で保存する。サブエージェントの許可リストは、直列化された保存処理の中で直近の値を読んで追加・削除する。
- `#/settings/models` の二つの名前空間だけを専用部品にし、ほかのページは汎用スキーマ表示を維持した。対応モデルだけに推論の強さを表示し、一覧外の保存値も保持する。保存・復帰・読取専用・一覧取得失敗の表示を追加した。設定トップの要約は従来のモデル ID のまま。
- `pnpm typecheck` 成功、`pnpm test` は710件成功、`pnpm build` 成功、Playwright 全件は77件成功。新規のブラウザー試験3件を `--repeat-each 3` で計9件成功。幅390pxで横幅も確認した。
- DSH 本体は起動していない。実物への保存と、一部の提供元だけモデル一覧の取得に失敗する場合の画面操作は段階3で確認する。ビルド時には既存の500 kB超のチャンク警告が残る。

### 2026-09-27：モデル選択画面のレビュー対応

- DSH 0.1.5-rc.1 はサブエージェントの許可リストが空のまま有効化する変更を拒否する。無効中もモデルを選べるようにし、先に1件以上保存してから有効化する。有効中は最後の1件を外せない。保存待ちの操作も直列キュー内で最新値を再確認する。
- 推論の強さに選べる「既定（モデルに任せる）」を置き、選択時は `reasoningEffort` の `unset` を保存する。候補外の保存値は一覧外と表示して保持する。モデル一覧の再読込失敗中は、残っている一覧と保存値を表示しながら編集操作を無効にする。推論欄がない場合の区切り線と余白は `hidden` の表示規則で消した。
- `mock.ts` に本物と同じ空リストの検査を追加したのは、オーケストレーターである。ユーザーの了承を得て編集され、Codex はこのファイルを編集していない。単体試験と幅375pxのブラウザー試験で、有効化の順序、最後の1件、推論の既定への復帰、欄を隠す表示を確認した。
- `pnpm typecheck` 成功、`pnpm test` 712件成功、`pnpm build` 成功、Playwright 全件77件成功。変更したブラウザー試験3件は `--repeat-each 3` で計9件成功。DSH 本体は起動しておらず、実物への保存とモデル一覧の再読込失敗をブラウザーで起こす操作は未確認。
