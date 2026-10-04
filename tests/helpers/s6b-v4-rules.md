# S6B: native V4 の規則と fixture 検査の対応

対象は DSH **0.2.0-rc.2**。`dsh-session/lib/index.js` の検査をファイル順に読み、commands / compaction の invariant 全文、`dsh-session-format-v3-to-v4/README.md` の Native V4 admission と、その実装の native admission / relationships を照合した。

`s6b-v4.ts` は正常 fixture の全履歴用。一般の Session リーダーではない。対象外の記録を無視せず `fixtureTypes` で拒否する。既存の `s6b-fixtures.test.ts` の ID・件数・連番・実行境界・ツール宣言・コマンド・retry・checkpoint 検査も残す。`e2e-dsh/fixture-contract.spec.ts` は、インストール済み実物の row admission、V4 restorer、Session、commands/compaction invariant も直接実行し、194履歴の受理と30不正入力の拒否を照合する。companion には、Session が追加する end-seed でなく元の履歴を渡す。

ソースの位置は、この版の各パッケージの `lib/` 内。表の S は `dsh-session/index.js`、V は `dsh-session-format-v3-to-v4/index.js`、C は `dsh-commands/invariant.js`、K は `dsh-compaction/invariant.js`。

| 順 | 実物の規則・根拠 | コミットした検査との対応 |
|---|---|---|
| 1 | S 239–260: developer event と role の一致。tool-addition/removal は developer 専用。非空 toolName、inline tool 禁止。addition がある時だけ headerSeq | `roles`、`content`、developer 分岐。N1、X08、未知 producer の正常例 |
| 2 | S 262–270: request data/header は object、header.system 禁止、空 tools / adapterDefaults は省略 | `requestHeader`。N3、X01、X02 |
| 3 | S 271–275: tool/result.error があれば message.isError は true | role=tool 分岐。N2、X20（boolean の規則は V 459–481 も） |
| 4 | S 286–308: sequence は非負 safe integer、-0 禁止。surface の種類、必須 marker、log-only の marker/refs 禁止、replace のキーは op/startSeq/endSeq だけ | `count`、`earlier`、surface 分岐。X13、X14 |
| 5 | S 311–328: refs は非空・重複なし・過去の seq。assistant に refs 禁止。replace は除いた全ノードを引用 | surface 分岐。X12、X24。密な seq と合わせて参照の存在も保証 |
| 6 | S 331–348: developer.headerSeq は以前の request/header。追加名ごとに定義が一つ、description は string、parameters は object、deferLoading は存在時 true | developer 分岐と `requestHeader`。X06。現在の fixture に developer addition はないが、この共通規則は実装済み |
| 7 | S 361–375、422–451: replace の両端は現在の surface にあり、その順序で包含範囲を指定 | 現在 surface の配列を更新して検査。X24。全過去 append の集合で代用しない |
| 8 | S 391–409: tool/result の置換は現在の結果一つだけ、content 以外を変えない | role=tool の replace 分岐。現 fixture は未使用だが実装済み |
| 9 | S 416–420、V 601–623: 先頭 system を保護。system の初出は先頭、先頭の置換は system 一つだけ | `protectedHead`。compaction の span でも除外 |
| 10 | S 1037–1073、V 946–980: 保存 header の version/id/createdAt/isSeeded/delegationDepth、任意 cwd/parentSession/origin/agentPreset、許可キー | **単体には写さない**。fixture は SessionWireEvent と投影であり、保存 header を作らない。新しい native 照合 spec は正規 header を渡し native 検査する |
| 11 | S 1110–1139、1328–1337: JSON のみ、event envelope の許可キー、type/seq/time/data、ignorable=true、0 から密な seq | `json` と envelope 検査。X21。type は明示した fixture 種類だけを許可 |
| 12 | S 1141–1163、1171–1178: config の非空 provider/model、任意非空 reasoningEffort、reason の4語、startsSeries=true、adapterDefaults の2キー・true・対応 config | `requestHeader`。X01–X06 |
| 13 | S 1166–1169: assistant の turn/step と stream array | assistant 分岐。開いている turn/step との一致は lifecycle で追加確認 |
| 14 | S 1191–1222: message の id、role、content array、source object/kind。system-prompt / model(provider,model) / tool(callId) の閉じた語彙 | role 分岐、既存必須フィールド試験。user/developer の未知 producer は非空の任意語彙を許容。旧 plugin wrapper のみ拒否（V 124–151、X18） |
| 15 | V 156–213、286–361: 退役 tool-result と developer 専用 block を各解釈位置で拒否。stream の block-start/end、summary/rawOutput、PTC content も対象 | `content` を各位置で呼ぶ。X07、X08。ネストした任意 JSON の同名キーは拒否しない正常例もある |
| 16 | V 219–281: system content の既知 text/reasoning/tool-call/image の型・画像 MIME/bytes/寸法/name | `systemContent`。X19。未知の拡張 block は保持 |
| 17 | V 746–782: turn/step は1から連続、重複開始不可、終了の owner が一致、未解決 tool を残して終了不可。system/developer/attempt は open step、header/context は open turn | lifecycle switch と既存境界試験。未完の実行中 tail を許可。空の completed/forked turn は正当であり別の表示試験で保持 |
| 18 | V 626–650: assistant の宣言、tool の開始名/引数、結果の対応。置換結果は open turn | lifecycle switch と既存全履歴検査。**開始前の合成 repair 例外は写さない**。fixture にないため、通常の開始がない結果は拒否する（下表） |
| 19 | V 651–675: PTC の subCallId が一意、開始と結果が一組、root/parent/name/arguments が不変、親が同じ root に属する | dispatch 分岐。X17 |
| 20 | V 677–699: retry の provider/turn/step、policy chain の連続番号と同じ retryId、retry-started の事前 schedule・座標・一度だけの開始 | retry 分岐、既存取消 retry 試験。X16 |
| 21 | C 14–30、V 795–807: command/run ID 再利用禁止、done の前に run、sourceEventSeq は成功時の以前の非 command | commands 分岐と既存コマンド試験。X15、X22。fixture では重複完了と未完コマンドも拒否する（native より強い正常データ要件） |
| 22 | K 22–67: 非空 compactionId/sourceCommandId、checkpoint は進行中の同一 compaction と command | `compactOwner` と checkpoint 分岐。N4、X09 |
| 23 | K 34–48、V 728–739: summary/prune の range は現在 surface の完全な連続範囲、先頭 system を含まない | `span`。X10、X24。prune は transaction 不要 |
| 24 | K 81–105、109–161: turn:null はターン間、番号付きは現在の turn。開始の重複不可、summary は1回、end の ID/command/turn が一致、成功なら summary 必須、turn 境界をまたがない | compact lifecycle 分岐。N4–N6、X09、X23。合成 end-seed を足して欠落 end を免除しない |
| 25 | K 142–143: shadowedTokenCount は非負 safe integer | `count` と既存 checkpoint 試験。X11 |

## 写さない領域と理由

| 規則 | 理由と無検査で入らないための扱い |
|---|---|
| session/title、session/title-llm-request の人間入力引用・専用 producer（V 836–856） | fixture 履歴にない。`fixtureTypes` が拒否。summary の displayTitle は保存 title event ではない |
| agent/inbox/spliced、team/message/queued の内部 message slot | 履歴にない。対応待ちや queue は投影/RPC の fixture。新たに履歴へ足したら種類の guard で失敗する |
| subagent/catalog の version・childId 一意性（V 926–944、1027–1043） | fixture の子一覧は投影であって履歴 event ではない。履歴への追加は拒否 |
| inherited cut / 最後の inherited marker / orphan compaction の seed 失効（S 1340–1354、K 69–79、V 982–1007） | 今回の完全履歴はすべて非継承。session/end-seed 自体を guard で拒否。存在しない marker を自動挿入しない |
| delivery-accepted の世代・所有 Session・throughSeq（V 1009–1043） | 外部ログ配信の履歴を使わない。guard で拒否 |
| image/offload の plugin projection（S 438–439） | 画像は直接 attachment の fixture。offload event は guard で拒否 |
| fork / interrupted の TOOL_NOT_STARTED の厳密な synthetic ID・本文・引用（V 370–396、825–835） | この種類の結果を fixture は生成しない。全結果に通常の開始を要求。forked **空ターンの表示**はこの結果形式とは別 |
| 未知 ignorable event の opaque 保持 | 正常 fixture の種類は既知に限定。新たなものは guard で拒否。未知 user/developer producer と未知 content は native 同様に受理 |
| provider stream の全 schema、任意 tool JSON schema、ユーザー/ツール本文の全 generated schema | Session 自体も完全検査しない（S 1308–1310、README Native fields）。stream array と明示された退役/専用タグ検査だけを写す |
| V0–V3 migration、codec の物理 framing、回復モード | V4 wire fixture なので変換・物理保存・破損回復を行わない |

## 722692c との表示比較

`s6b-display.test.ts` は旧コミットの web/src の fixture と selector を `git show` で読み取った値を `fixtures/s6b-display-722692c.json` に固定した。Date.now は 2026-09-25 09:00 JST。8 シナリオから全53会話を対象にする。一覧、chat 行、trace 見出し/行、モデル/考える深さの初期値を比較。非表示の seq/ID/絶対 event 時刻、trace 詳細の input は対象外。所要時間・本文・エラー・行順・深さ・usage は比較する。

次だけを明示的に旧期待へ加える。広い除外や実際の値を期待に流用する処理はない。

- approval: 不正な開始番号2を1に修正（2・3→1・2、統計の最大ターン数も3→2）、未宣言 read_file を assistant content に宣言。人工的な空ターンも、本体の空ターン非表示も使わない。
- chat-long / samples / spec-check / session-tools 子: 必須 step/start の追加で、以前未計測だった assistant の時間が計測可能になる。長い会話の**ターン合計は元の3秒に復元**。
- chat-spec-check: 別のモデル呼び出しを別 step にし、以前上書きで消えた read_file の宣言行を保持。tool/call の必須引数を復元。
- chat-injected-context: system/message を受け入れるための step を記録し、そのステップの assistant 行が表示される。
- chat-long-streaming: 実物と同じモデル消費後の lastUsed 更新により、一覧のアイコンが generic から DeepSeek になる。

それ以外（全 chat 行、初期モデル/考える深さ、trace-example の合計時間を含む）は旧値と一致する。これらの差を隠すための本体変更は行わない。見出し番号などを旧画面どおりに装うには仕様上の別判断が必要であり、この修正では実物として成立する履歴を優先する。
