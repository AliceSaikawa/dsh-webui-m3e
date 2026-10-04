# 段階 5 RPC 移行の報告

対象は DSH 0.2.0-rc.2。実 DSH は統合試験の隔離したホームと偽 LLM だけで確認した。
保護された設定 mock の反映と、保護の仕組みに止められた API キー関連の放送・エラー表の変更が残るため、段階全体は未完了。

## 1. 変更箇所

| ファイル | 要点 |
| --- | --- |
| `web/src/features/composer/api.ts`、`Composer.tsx`、`Sheets.tsx`、`use-permission-catalog.ts` | 権限投影の現在値と候補 RPC を結合。既定値は設定と候補カタログから読み、新規会話へ適用。候補の放送、設定の更新、再接続で再取得。モデル一覧も提供元更新で再取得。 |
| `web/src/features/composer/mock.ts`、`web/src/dsh/mock/context.ts` | 権限投影は現在値だけ。独立した候補 RPC を提供。共有 context はこの投影の最小変更のみ。 |
| `web/src/features/session-tools/files.ts`、`FileScreen.tsx`、`FilesScreen.tsx`、`mock-files.ts` | バイト範囲の入れ子と Uint8Array、監視対象パスとストリームハンドル、ファイルの範囲検証。 |
| `web/src/features/settings/schema.ts`、`store.ts`、`field-access.ts`、`use-settings.ts`、`ModelsPanel.tsx`、`SchemaFields.tsx`、`SettingsScreen.tsx`、`SettingsDetailScreen.tsx` | 新しい ns・selectedDefault・live の反映時期へ移行。autoGenerate を尊重し、既存の専用ページは維持。権限の既定値はカタログの defaultOptions と mutate を使用。 |
| `web/src/features/settings/providers.ts` | アカウントはモデルを利用できる場合のみ表示し、API キー参照を生成しない。 |
| `web/src/features/settings/mock-validation.ts` | 保護された mock の担当者が使う、公開 schema にないパス・値の型の検査。現時点では保護ファイルへの接続待ち。 |
| `web/src/dsh/remote-events.ts`、`remote-result.ts`、`interactions-store.ts` | 権限カタログの放送、利用不能モデル・ファイル監視・実行中アーカイブ等の日本語案内、通知の追加任意属性。 |
| `tests/`、`e2e-dsh/rpc.spec.ts` | 既存入力を新しい RPC 形式へ移行。新規の実 DSH 試験は独自の会話とワークスペースを作成。 |

## 2. 実物の型・コードとの照合

以下の `NEW/` は `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/`。
「同じ」は型・呼び出す側のコードの照合結果であり、実機で全経路を実行した意味ではない。

| M3E の使用箇所 / RPC | 結果 | 根拠と実機確認 |
| --- | --- | --- |
| composer/api.ts commands.list | 同じ | `NEW/dsh-commands/lib/typert.remote-client.d.ts`。`lib/types/types.d.ts:54` の任意 definitionId を型へ追加。 |
| composer/api.ts fileReferences.list | 同じ | `NEW/dsh-api-session-controller/lib/typert.remote-client.d.ts`。会話 ID・検索語・signal の位置は同じ。 |
| composer/api.ts modelCatalog / selectModel | 同じ | 同上と `lib/index.js:500-546`。routableProviders はモデルのある group だけ。設定画面で実機の2モデルを表示。 |
| home/directory.ts list / createDirectory | 同じ | `NEW/dsh-api-workspace-controller/lib/typert.remote-client.d.ts`。既存試験も維持。 |
| session-tools/operations.ts goals.get / pause / resume / complete / clear | 同じ・実動未検証 | `NEW/dsh-goal/lib/typert.remote-client.d.ts:11-17`。この段階で新しい実機試験は足していない。 |
| goal-activation.ts goal/activation-changed | 同じ・実動未検証 | `NEW/dsh-api-remotes/lib/index.js:62`。ID・revision を照合して反映する既存処理を維持。 |
| session-tools/files.ts list / read / stat | 同じ | `NEW/dsh-api-workspace-files/lib/typert.remote-client.d.ts:16-20`、`lib/index.js:416-513`。実機の一覧・テキスト・画像で確認。 |
| session-tools/files.ts readBytes | 直した | 同上、`lib/types/types.d.ts:64-84`、`lib/index.js:446-476,535-558`。range の入れ子と native bytes を実機確認。 |
| FileScreen / FilesScreen changes | 直した | 同上、`lib/index.js:523-525`。対象パス必須。`NEW/dsh-typert-protocol/lib/types/types.d.ts:100-129` の RemoteStreamHandle。実ファイルの変更通知まで確認。 |
| settings describe / update / mutate | 直した | `NEW/dsh-api-settings-controller/lib/typert.remote-client.d.ts`、`NEW/dsh-settings/lib/types/types.d.ts:18-50`、`lib/index.js:118-147,418-443,505-520`。volatile だけが公開・編集可能。実機の保存・再読込と非公開パス拒否を確認。 |
| settings の ns | 直した | subagent は `NEW/dsh-client-ui-settings-subagent/lib/client.js:515`、shell は `NEW/dsh-client-ui-settings-shell/lib/client.js:115-126`、preset は `NEW/dsh-client-ui-agent-preset/lib/client.js:1060-1072`。 |
| 権限候補・既定値・保存 | 直した | `NEW/dsh-permission-presets/lib/types/types.d.ts:12-40`、`lib/index.js:158,179-185,249`、`NEW/dsh-client-ui-permission-presets/lib/client.js:42,571,655`。カタログ、文字列 schema、mutate、放送。既定値が value にない場合は catalog.defaultPreset を使う。実機で設定から新規会話への適用と会話内切替を確認。 |
| settings 提供元一覧 | 同じ、一部直した | `NEW/dsh-llm/lib/typert.remote-client.d.ts:15-17`、`NEW/dsh-client-ui-settings-models/lib/client.js:938-940,1037-1067`。未ログインの account は非表示。ログイン済み実機は未検証。 |
| settings API キー3メソッド | 同じ | 呼び出す側の `NEW/dsh-api-settings-controller/lib/index.js:76-82,156-208` と `NEW/dsh-client-ui-settings-models/lib/client.js:2784-2792` を確認。戻り値の状態は configured/source?/writable、set/unset は void。隔離ホームで架空値の登録・削除と環境由来の読み取り専用表示を実測。保存実装の保護されたファイルは未読。 |
| remote-events.ts | 一部直した・一部未反映 | commands/change、llm/adapters-updated、settings/document-updated は同じ。権限カタログ変更を追加。標準 Models の4種の購読は `NEW/dsh-client-ui-settings-models/lib/client.js:4046-4051`。API キーレコードの更新放送の追加は保護の仕組みに止められた。 |
| interactions-store.ts 承認・質問の返答 | 同じ・任意属性を追加 | `NEW/dsh-user-approval/lib/types/types.d.ts:54`、`NEW/dsh-user-questions/lib/types/types.d.ts:28,129`。displayReason、intent.callId、wait を受け止める型を追加。待ち続ける既定の質問は従来の waterfall 返答を維持。期限付き待機・attachWait は未対応。 |
| remote-result.ts | 一部直した・一部未反映 | `NEW/dsh-typert-protocol/lib/types/types.d.ts:63-83` の RemoteResult / RemoteFailure は同じ。モデル一覧不能・投影不能・writer-held・監視不能・実行中アーカイブの日本語案内を追加。API キー不足のコード追加は保護の仕組みに止められた。 |

実測で調査メモと異なった点：

- 旧 `readBytes(sid,path,{offset,length})` は実物で拒否されず、指定を無視してファイル全体を返した。新 spec はこの実測と負数 offset の拒否を別々に確認する。M3E は新形式のみを使う。mock は作業指示のとおり旧形を明示的に拒否し、旧呼び出しを見逃さないよう実物より厳しくしている。
- listConfigurableProviders には pi-ai の組み込み提供元も入る。「提供元は2つ」という前提で全件数を固定していない。今回の modelCatalog の利用可能 group は deepseek-official だけだった。
- shell の公開値は timeoutMs、maxTimeoutMs、maxOutputBytes、maxSpillBytes、graceMs。旧設定の非公開項目を補って表示する処理は入れていない。
- llm-deepseek、llm-deepseek-account、llm-pi-ai は autoGenerate が false。汎用フォームに出さず、既存のモデル・提供元・API キーの専用表示を使う。
- permission と agent-preset-registry の value は今回空だった。権限は候補カタログの既定値を使用し、プリセットに古い default 値を捏造しない。

## 3. 検証

| 検証 | 結果 |
| --- | --- |
| pnpm typecheck | 保護された設定 mock の3エラー。autoGenerate 欠落2件、applies の restart 1件。 |
| pnpm test | 839件中835件成功・4件失敗。下記の保護 mock 待ち。 |
| pnpm build | 成功。既存の500 kB超チャンク警告のみ。 |
| 偽データ e2e（5194） | 124件中120件成功・4件失敗、4.5分。下記の保護 mock 待ち。 |
| 偽データの失敗4件のみ再実行 | 4件とも同じ要素欠落で再現。負荷による一時的な遅延ではない。タイムアウトは変更していない。 |
| 実 DSH 全件・連続1回目 | 通常成功23件（従来17＋追加6）と既知の期待失敗1件。終了コード0、Playwright表示は24 passed、1.5分。 |
| 実 DSH 全件・連続2回目 | 通常成功23件と既知の期待失敗1件。終了コード0、Playwright表示は24 passed、1.6分。追加6件は2回とも成功。 |

連続実行は2回とも `env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts`。
JSON 結果を `tmp/dsh-integration/s5-rpc-run1.json` と `s5-rpc-run2.json` に保存した。
既知の期待失敗は `real-dsh.spec.ts:241` の切断表示で、今回変更していない。

設定 mock の反映まで失敗する単体試験：

- `tests/08-mock.test.ts:21`（ページ分類、autoGenerate / applies / 新 ns）
- `tests/08-mock.test.ts:70`（selectedDefault と新 ns による設定要約）
- `tests/08-store.test.ts:585`（新 ns のサブエージェントモデルの直列保存）
- `tests/08-store.test.ts:602`（新 ns のサブエージェントモデルの有効化）

同じ原因で失敗する偽データ e2e：

- `e2e/edge-cases.spec.ts:99`（API キーだけ読み取り専用でも通常設定は編集可能：autoGenerate 未設定で通常設定が出ない）
- `e2e/mock.spec.ts:389`（そのほかの設定ページ：autoGenerate 未設定で出ない）
- `e2e/settings-models.spec.ts:53`（旧 ns なのでサブエージェント欄が出ない）
- `e2e/settings-models.spec.ts:87`（同上、読み取り専用の確認）

### 変更した試験の破壊確認

通常実装をステージしてから一時変更を当て、同じ試験を実行し、`git restore` でステージの実装へ戻した。180件の対象試験の一時実行は148成功・32失敗・中断0。そのうち4件は元から保護 mock 待ちであり、破壊確認の成功には数えない。
型補助関数への autoGenerate 属性追加だけで挙動の期待値を変えていない既存ケースは、通常の回帰試験として実行した。

| 試験（tests/ 以下） | 一時的に壊した箇所 | 結果 |
| --- | --- | --- |
| 00-session-references:179 実行中アーカイブ | remote-result のコードを不一致にする | 日本語案内の一致で失敗 |
| 03-api:62 既定権限 | permissionDefaultsOf の現在値を不正な値へ置換 | 既定値の一致で失敗 |
| 03-api:83 初期投影 | composer/mock の投影へ旧 options を混入 | 投影の一致で失敗 |
| 03-api:172 先行拡張の投影保持 | composer/mock で初期投影を上書き | 先行拡張の値の一致で失敗 |
| 08-default-permissions:9 保存・復帰 | permissionDefaultsOf の現在値を不正な値へ置換 | 保存前の既定値で失敗 |
| 08-providers:414 権限候補 | schemaFields の候補を空配列へ置換 | 候補の一致で失敗 |
| 08-rpc-contract:14 ページ分類 | groupNamespaces で分類結果へ追加しない | ページ内の ns 一致で失敗 |
| 08-rpc-contract:26 カタログと mutate | schemaFields の候補を空配列へ置換 | 選択肢の一致で失敗 |
| 08-rpc-contract:49 アカウント | providerRows で利用可否フィルターを削除 | 利用不可の行が出て失敗 |
| 08-rpc-contract:60 非公開パス検査 | validMockPatch を常に true にする | 非公開パスの拒否で失敗 |
| 08-settings:287 新 ns 分類 | groupNamespaces で分類結果へ追加しない | 5ページとその他の一致で失敗 |
| 08-summary:31 権限要約 | schemaFields の候補を空配列へ置換 | 日本語表示名の一致で失敗 |
| 08-summary:41 プリセット要約 | selectedDefault を旧 default へ戻す | プリセット要約の一致で失敗 |
| 09-file-errors:27 バイト上限拒否 | mock の長さ上限判定を削除 | エラー応答の検査で失敗 |
| 09-file-errors:62 上限ちょうどの画像 | readImageFile の結合データをゼロにする | 画像の先頭バイトで失敗 |
| 09-file-errors:85 大きさ不明の画像 | 上限到達を別種の Error にする | ImageFileTooLarge の検査で失敗 |
| 09-file-errors:103 途中で拡大する画像 | 途中の上限超過を別種の Error にする | ImageFileTooLarge の検査で失敗 |
| 09-file-errors:119 先頭で版違い | 版違いを別種の Error にする | FileVersionChanged の検査で失敗 |
| 09-file-errors:139 返却範囲超過 | 範囲超過を別種の Error にする | ImageFileTooLarge の検査で失敗 |
| 09-files:89 バイト結合 | readImageFile の結合データをゼロにする | [1,2,3] の内容一致で失敗 |
| 09-mock:70 画像範囲 | mock の eof を常に true にする | 先頭範囲の eof で失敗 |
| 09-mock:86 変更通知 | close で watcher を削除しない | 解放後の購読数で失敗 |
| 09-mock:116 return / abort | close で watcher を削除しない | 解放後の購読数で失敗 |
| 09-rpc-contract:6 新バイト形式 | mock の eof を常に true にする | 部分範囲の eof で失敗 |
| 09-rpc-contract:27 対象の監視 | close で watcher を削除しない | dispose 後の購読数で失敗 |
| 09-rpc-contract:49 エラー案内 | 実行中アーカイブのコードを不一致にする | 理由と次の操作の案内で失敗 |
| 99-integration-mock:77 既定権限の統合 | permissionDefaultsOf の現在値を不正な値へ置換 | 設定の既定値の一致で失敗 |
| 08-mock:21、08-store:585、08-store:602 | 保護 mock 待ちで通常状態から失敗 | 破壊確認は未完了。担当者の差分適用後に必要 |

付随して未変更の 03-api:137 も不正な既定値を検出した。08-mock:70 の失敗は破壊前からあるため、検出実績には含めない。

新しい実機6項目も一時破壊時に全件失敗を確認した。DSH 本体は変更せず、M3E の実装と監視試験のファイル変更準備だけを一時的に変更した。

| 実機試験（e2e-dsh/rpc.spec.ts） | 一時的な変更 | 失敗した検査 |
| --- | --- | --- |
| :69 設定の保存 | settings/store.edit で bash-sandbox の保存を送らない | 「保存しました」が現れない |
| :96 モデル・提供元 | providerRows を空にする | DeepSeek の行が0件 |
| :113 権限の既定・適用・切替 | settings/store.edit で permission の保存を送らない | 「保存しました」が現れない |
| :141 ファイルの表示 | readTextFilePage で本文の返却を止める | テキスト本文が現れない |
| :167 対象パスの監視 | ready 後の writeFileSync を削除 | 変更通知を受け取れず60秒の規定時間で失敗 |
| :201 API キー | providerRows を空にする。別実行では保存を送らず成功扱いにする | 前者は行なしで失敗。後者は保存後も「未登録」のままで、登録済みの検査が失敗 |

## 4. 指示との差と理由

- この報告書だけを担当ファイル一覧の外へ追加した。根拠、検証の失敗、保護ファイルの引き継ぎをコミットに残すため。
- docs/ui-spec.md の実行中アーカイブは 0.2.0 で拒否される。自動停止や確認の動作は追加せず、止めてから再試行する日本語案内だけを追加した。
- 権限切替は現在の M3E の権限チップから既存のシートを開いて確認した。＋の中へ新しい入口は追加していない。
- 試験の期待値変更は名前空間・権限候補の取得元・native bytes・監視対象パス・指定されたアーカイブ案内に合わせたもの。既存試験の削除や skip、タイムアウト延長はしていない。

## 5. 未検証と引き継ぎ

- 保護された `web/src/features/settings/mock.ts` は無変更。新 ns、autoGenerate、live、更新時の revision 通知、公開パス検査、API キーの void 戻り値と更新放送の差分は最終回答に添付する。適用後に型検査、単体試験、偽データ e2e を再実行する必要がある。
- account のログイン、解除、失効、ログイン要求の画面は未対応。ログイン済み提供元の実機表示、実 API キーでの外部サービス接続は未検証。
- ゴールの実機操作、Windows の pwsh、監視非対応バックエンド、writer-held、投影不能、モデル不能の各エラーの実機発生は未検証。エラー表は単体試験で確認。
- API キー保存の内部実装・データ形式は保護対象のため未読。公開側の RPC と隔離ホームでの UI 動作から分かる範囲だけを検証した。
- API キーレコードの更新放送の引数は未検証。利用側は引数を使わず状態を再取得する設計として引き継ぐ。

## 6. 止められた操作

- API キー更新放送と不足エラーの識別子を含むパッチが、保護対象の語を含むという理由で自動承認審査に拒否された。別の方法で書き込まず、該当差分を最終回答へ残した。
- 設定 mock は明示的な編集禁止なので編集を試みていない。
- 複数行の Python 編集コマンドは不透明なシェルラッパーとして拒否された。共通ルールで許可される単純な apply_patch の形で、保護対象以外の編集を続けた。

## 7. コミット

本報告書を含む段階5のコミットは、最終回答にハッシュを記載する。
