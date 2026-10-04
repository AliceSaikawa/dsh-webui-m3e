# 段階3・修正3：試験の強化と変異の再検証

対象は `feat/dsh-0.2.0`、開始時の HEAD は `cfe1106`。R1〜R4と、監査で生存した20件を対応した。本体の恒久的な変更はない。変更した実装は `web/src/dsh/mock/context.ts` の fork と `web/src/dsh/mock/search.ts` の検索だけで、ほかは試験と偽LLMである。

`e2e-dsh/fake-llm.ts` には、最初の応答ステップと最終返答を別々に待機させる `holdTurn` を追加した。文字列とtool_useを同じ応答で返し、実DSHが返したtool_resultを含む要求を記録する。従来の単純応答・承認・質問・停止のシナリオは維持した。変更した各試験ファイルの内容は下表に記す。

## 指摘ごとの対応と再検証

「失敗」は、その指摘の対象試験自身が assertion で失敗したことを示す。ファイル内の別の試験だけの失敗や、時間切れを検出成功とは数えていない。M番号・D番号などは元の監査の変異ID。行番号は今回の修正後のファイルを基準とし、変異は毎回 `git restore -- <ファイル>` で復元した。編集中の正しい変更を先に index に保存し、復元後の内容が適用前と同じことも確認した。

表の `00-*` などは `tests/<名前>.test.ts`、`mock/` は `web/src/dsh/mock/`、`composer/` と `session-tools/` は `web/src/features/` 配下、その他のcontrollerファイルは `web/src/dsh/` 配下を指す。

| 指摘 | 対象と強くした内容 | 当て直した変異（場所と内容） | 結果 |
|---|---|---|---|
| R1 | `00-subagent:82`。両modeで欠落・逆mode・親不一致・origin不一致・不存在を実行。openState、コード、元の選択・下書き、参照数を維持 | `mock/context.ts:618` の ready 内の `validateAddress` を省略 | 両modeの5ケースずつ、計10件が失敗 |
| R2 | `00-mock:276` と `00-session-references:156`。非空のジョブを登録し、初回通知を待って内容を確認してから削除 | M086：`mock/context.ts:1004` の `kit.setJobs(sessionId, [])` を削除。別途 `mock/jobs.ts:14` の空配列時のキー削除を削除 | 対応する2試験がそれぞれ失敗 |
| R3 | `00-mock-contract-audit:81`。不正なatSeqの例外を公開clientと同じTypeErrorにする | `mock/context.ts:738` のTypeErrorを従来の `gateway/bad-request` に戻す | 対象試験が例外の型の不一致で失敗 |
| R4 | `00-mock-contract-audit:188,200`。置換前のuser/assistantを除外し、現在の本文とtool-callの名前・引数を検索する | `mock/search.ts:13` の置換をappendに変更。別途 `:19` のtool-call抽出を削除、および引数だけ削除 | 表示対象の試験、ツール検索の試験が各変異で失敗 |
| M1-01 | `00-session-review-regressions:90`、home／シート取消。prepared、子のnavigation参照1件、未完了を確認 | M020：`conversation-selection.ts:69` のprepare冒頭でfalseを返す | このケースが「子の準備に入っている」で失敗 |
| M1-02 | 同ファイル、home／失敗。準備開始に加え、gateからの同じエラーが返ることも確認 | M020：同上 | このケースが準備開始の確認で失敗 |
| M1-03 | 同ファイル、inbox／シート取消。prepared、navigation参照1件、未完了を確認 | M020：同上 | このケースが準備開始の確認で失敗 |
| M1-04 | 同ファイル、inbox／失敗。準備開始とgateのエラーを確認 | M020：同上 | このケースが準備開始の確認で失敗 |
| M1-05 | `00-mock:237`。2会話と既知の履歴件数、user/assistantの存在を確認してからJSON往復 | M084：同試験の履歴収集ループを削除 | 対象試験が収集件数の不一致で失敗 |
| M1-06 | `00-conversation-selection:151`。pending中にmicrotaskを進め、未完了・retain 0回・元の参照1件を確認 | M004：`conversation-selection.ts:102` の一覧待機条件を常にfalseにする | 対象試験が未完了の確認で失敗 |
| M1-07 | `00-conversation-selection:171`。解除関数の1回の呼出しと、その後の通知が来ないことを確認 | M005：`conversation-selection.ts:104` のunsubscribeを削除 | 対象試験が解除回数の不一致で失敗 |
| M1-08 | `00-controller-review:97`。新応答の全values・ready・error:nullと、旧応答後の同一snapshot・通知0回を確認 | M033：`mock/context.ts:693` の中断済み応答で値を残してstateをerrorに戻す | 対象試験がsnapshot同一性の確認で失敗 |
| M1-09 | `00-mock:101`。fake timerで再接続境界を進め、replace通知1回・途中のstream・履歴を確認。確定後の重複なしも維持 | M079：`mock/context.ts:797` の再接続時のreplaceWindowを削除 | 対象試験がreplace通知0回で失敗 |
| M1-10 | `00-mock:276`。アーカイブ後にジョブを登録し、購読した実データが削除後に消えることを確認 | M086：`mock/context.ts:1004` のジョブ消去を削除 | 対象試験が残ったジョブ行を検出して失敗（R2と重複） |
| M2-01 | `03-delivery:364`。selectModel開始を待ち、呼出しがretain→modelだけで送信が未完了と確認してからmode／親を変更 | D07：同試験の `h.waitModel(gate.promise)` を削除 | 対象試験が余分なprompt／releaseを検出して失敗 |
| M2-02 | `03-delivery:606`。モデル準備開始・待機中を確認してから読み取り専用化／削除。後続permission・plan・promptの不実行を維持 | D30：同試験のモデル待機の設定を削除 | 対象試験が後続commandを検出して失敗 |
| M2-03 | `01-mock:247`。1つ目でフォルダが読め、archive対象IDが存在することを先に確認してから2つ目の不変性を確認 | H07：同試験のフォルダ作成とarchiveを両方削除 | 対象試験が1つ目のフォルダ不在で失敗 |
| M2-04 | `99-integration-mock:104`。homeとsession-tools由来の既知の子ID集合3件を確認してからカタログを照合 | Z01：同試験のbuildを拡張なしのcreateMockContextに変更 | 対象試験が空の子ID集合を検出して失敗 |
| M2-05 | `09-session-tools:38`。変換済みの子をchildAddressに渡し、両mode・id・label・diagnosticを確認 | ST01：`session-tools/presentation.ts:40` の変換結果modeをone-shotに固定 | 対象試験がcontinuableの喪失で失敗 |
| M2-06 | `03-delivery:508`。古いscopeの確認をretainに直し、呼出しがcreateだけであることを確認 | D26b：`composer/delivery.ts:132` の公開IDなしのRPCエラーでも架空IDをretain・release | 対象試験が余分なretainを検出して失敗 |
| M2-07 | `03-delivery:129`。既存の本文・画像・下書き確認を維持し、実際の偽controllerでhandoff→adopt、同一世代、delivery解放、mainView 1件を追加確認 | D11：`composer/delivery.ts:153` のhandoff呼出しを削除 | 対象試験が引き継ぎ参照の不在で失敗 |
| M2-08 | `06-navigation:63`。prepare→select→navigateに加え、終了時の所有者がmainView 1件だけであることを確認 | IN10：`conversation-selection.ts:90` のprepareのfinallyからreleaseを削除 | 対象試験がnavigation参照の残留で失敗 |
| M3-01 | `e2e-dsh/real-dsh.spec.ts:164`。最初のステップ・ツール後のステップでは未到着、ターン完了後の要求で追記が到着することを確認。既存確認を維持 | D08：`composer/submission.ts:29` のpromptを常にsteerにする | 実DSHの対象試験が、ツール後の要求に早く到着した追記を検出して失敗 |
| M3-02 | `e2e-dsh/real-dsh.spec.ts:197`。ツール結果を含む同じターンの次ステップに追記が到着し、最終返答はまだ未完了であることを確認。既存確認を維持 | D09：同じpromptを常にqueueにする | 実DSHの対象試験が、次ステップの追記不在で失敗 |

未対応・等価として除外した指摘はない。M1の7変異で10件、M2の8変異で8件、M3の2変異で2件を検出した。

R1の変異では、one-shot／continuableそれぞれのmissing-mode、wrong-mode、wrong-parent、wrong-origin、not-foundの各試験自身が失敗した。通常時には計10件とも成功した。R2の追加対象 `00-session-references` は、空配列時のpublishからキー削除を外す別の変異でも失敗した。

R4に伴う `07-search-mock:108` の入力変更は、追加したuser/messageに0.2.0の `surfaceOp: 'append'` を付けるもの。期待値は変更していない。この試験にも `mock/search.ts:7` で「途中で追加した本文」を表示対象から除外する変異を当て、`search-added` が返らず失敗することを確認した。

複数の試験を含むレビュー指摘と、追加で入力を直した試験の内訳は次のとおり。

| 試験ケース | 強化・変異 | 対象自身の結果 |
|---|---|---|
| B1 one-shot missing-mode | R1のmode別の試験。readyのアドレス検証を削除 | openとerrorの不一致で失敗 |
| B1 one-shot wrong-mode | 同上 | openとerrorの不一致で失敗 |
| B1 one-shot wrong-parent | 同上 | openとerrorの不一致で失敗 |
| B1 one-shot wrong-origin | 同上 | openとerrorの不一致で失敗 |
| B1 one-shot not-found | 同上 | session/not-foundとsubagent/not-foundの不一致で失敗 |
| B1 continuable missing-mode | R1で復旧。readyのアドレス検証を削除 | openとerrorの不一致で失敗 |
| B1 continuable wrong-mode | R1で復旧。readyのアドレス検証を削除 | openとerrorの不一致で失敗 |
| B1 continuable wrong-parent | R1のmode別展開で追加。readyのアドレス検証を削除 | openとerrorの不一致で失敗 |
| B1 continuable wrong-origin | 同上 | openとerrorの不一致で失敗 |
| B1 continuable not-found | 同上 | session/not-foundとsubagent/not-foundの不一致で失敗 |
| removeSessionの一括片付け | R2の非空ジョブの事前確認。M086で削除時のジョブ消去を削除 | rowsに残ったジョブを検出して失敗 |
| ジョブ一覧の共有購読と空の一覧 | R2の再購読後の事前確認。空一覧のキー消去を削除 | rowsに残ったkilledのジョブを検出して失敗 |
| searchの現在の表示対象 | R4で追加。置換範囲の除外を削除 | shadowed-needleの誤ヒットで失敗 |
| searchのtool-call | R4で追加。名前・引数の抽出を削除／引数だけ削除 | それぞれ対象語がヒットせず失敗 |
| 題名の変更・追加履歴・表示窓外の検索 | 07のsurfaceOpを修正。追加本文を検索対象から除外 | search-addedが返らず失敗 |

実行証跡は管理外の `tmp/stage3-strengthening/` にある。M1・M2は各IDのTAPと `m1.json`／`m2.json`、M3は `D08.json`／`D09.json`。R1〜R4の追加変異は実行時のツール出力にも残した。すべての変異は復元済み。

## 実物で確認したこと

以下の `NEW/` は `tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/`。

- `NEW/dsh-api-session-controller/lib/client.js:3347` はforkのatSeqを `SessionSeq()` に通す。同 `:103` は負の値、小数、負のゼロ、安全な整数でない値をTypeErrorで拒否する。
- `NEW/dsh-api-session-controller/lib/index.js:1953` の検索はuser/message・assistant/messageとsurface=currentを条件にする。
- `NEW/dsh-session-query/lib/index.js:576` はtextに加えてtool-callの名前・引数を抽出する。同 `:629` のclassifySurfaceはfoldSurfaceの現在のnodesだけをcurrentとする。
- `NEW/dsh-session/lib/index.js:439` はappend、`:465` はreplaceで現在のnodesを更新する。偽物も置換範囲を現在の並びから除くようにした。同 `:312` のsourceEventSeqsの検証に合わせ、試験の置換イベントは置換元の `[0, 1]` を明示した。
- `NEW/dsh-api-session-controller/lib/index.js:882` はsteerを `agent.steer`、それ以外を `agent.followup` に渡す。
- 実DSHの偽LLMへの要求で、最初の要求→段落とbashのtool_use→tool_resultを含む次の要求→最終返答、の順序を確認した。順番待ちの追記はその次の要求、割り込みの追記はtool_resultと同じ要求に入った。

## 3. 全体検証

| 確かめ方 | 1回目 | 2回目 |
|---|---|---|
| `pnpm typecheck` | 成功 | 成功 |
| `pnpm test` | 839件成功、失敗・skip 0件 | 839件成功、失敗・skip 0件 |
| `pnpm build` | 成功 | 成功 |
| `pnpm exec playwright test -c tmp/e2e-alt-port.config.ts` | 偽データ124件成功、失敗・skip・flaky 0件 | 偽データ124件成功、失敗・skip・flaky 0件 |
| `env M3E_DSH_VERSION=0.2.0-rc.2 pnpm exec playwright test -c e2e-dsh/playwright.config.ts` | 実DSH：通常17件成功＋既知の期待失敗1件 | 実DSH：通常17件成功＋既知の期待失敗1件 |

単体は開始時の832件から7件増えた（continuableの5ケース、検索の2ケース）。既存の試験数は減らしていない。PlaywrightのJSONでも両回ともunexpected・skipped・flakyが0件であることを確認した。実DSHの表示上の `18 passed` は期待失敗を含むため、上表では分けて記載した。

最後に検索の置換イベントの `sourceEventSeqs` を実物の条件に合わせたあと、表示対象の変異を再度当てて対象試験の失敗を確認し、復元後に `pnpm typecheck` と `pnpm test`（839件）も再実行して成功した。両回のビルドは既存の大きなchunkの警告のみ。全体検証で負荷によるタイムアウトや予期しない失敗はなかった。

e2eの結果は `tmp/stage3-strengthening/mock-full-1.json`、`mock-full-2.json`、`real-full-1.json`、`real-full-2.json` に保存した。最終差分で本体、package.json、ロックファイル、保護された設定の偽データに恒久的な変更がないことと、`git diff --cached --check` の成功も確認した。

## 4. 指示との差と理由

- 本体の不具合は見つからず、本体の恒久的変更はない。指定外の試験への監査は広げていない。
- 割り込みで「順番待ち」の表示を一切経ない、という例は実物と違った。実際の画面はnext-stepにも「順番待ち 1 件」と表示するため、追加確認を実測に合わせた。最終返答を保留したまま、ツール後の要求への追記到着と待機表示の消失を確認している。従来の確認は削除・緩和していない。
- 検証中のタイムアウト2回は、追加した確認をモデルの待機解除前に置いたために起きた。1回目は自分のメッセージ表示、2回目は待機表示の不在だった。対象試験とワークスペース作成の前提だけで再実行し、負荷による遅延ではなく上記の実際の動きと分かった。待ち時間は延ばしていない。
- 単体の再接続試験は実時間待ちをfake timerへ置き換え、生成途中のbaseline通知を確実に観測する。既存の確定・重複なしの確認を維持した。
- この報告書は担当範囲の `tests/` に置いた。共通ルールの明示指定どおり、サブエージェントは使っていない。

## 5. 未検証・引き継ぎ

実DSHの検証は0.2.0-rc.2、Chromium、隔離したDSH_HOME、偽LLMである。本物のLLM、iPhone/Safari、本番環境は対象外。再接続バナーの既知の期待失敗はそのまま残す。

## 6. 拒否された操作

追加変異をまとめたPythonの複合シェル呼出しが `Opaque shell wrappers are blocked unless Codex can split them into allowed commands` で拒否された。共通ルールの「コマンドの形」が許可する書き直しとして、単独のapply_patch、nodeの試験、git restoreに分割して完了した。禁止対象へのアクセスや権限の変更は行っていない。

## 7. コミット

この報告書を含む新規コミットに `AI-Task: dsh-0.2.0/3-session-contract` を付ける。ハッシュは最終報告に記す（報告書自身のハッシュを先に書くためのamendは行わない）。
