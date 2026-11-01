# HISTORY

Proposal から決定までの記録。公開 API・データ契約・保存形式・依存物・ビルド/配布方式・状態遷移・並行性/所有権・共有状態の不変条件に関わる変更は、実装の前にここへ Proposal を追加する。handoff が「ADR として残す」とした判断（権限追加、保存方式、依存ライブラリ、対象プラン、言語、規約上の判断、UI 操作への切替）もここに記録する。

書式: `## P-XXXX: <題名>` の下に、状態・目的・影響範囲・互換性・代替案・受け入れ条件を書く。決定時は「決定」節を追記する。

## D-0001: キックオフ時の所有者決定（2026-10-22）

状態: 決定

- リポジトリ: `nbx-liz/LizyChatTidy`（public）。
- マージ: lizy-reviewer（Codex による managed review）の判定が APPROVE かつ CI が緑なら連続マージする。
- ライセンス: MIT（権利者 nbx-liz）。
- 文書: handoff v0.1.1 を `docs/handoff/` に凍結保存し、BLUEPRINT.md を正本、HISTORY.md を Proposal 記録とする。
- KEEP の永続保存: P1（DEV08）で暗号化保存まで実装する。メモリのみへの縮退はしない。
- ビルド構成: P-0002 を参照。

## P-0001: 参考型定義からの契約変更（KEEP キー、取り込み契約、Adapter 分割）

状態: 提案（2026-10-22）

### 目的

`docs/handoff/contracts.reference.ts` と handoff 本文の間にある 4 つの食い違いを、実装前に解消する。

1. `KeepSnapshot.protectedRefs: ConversationRef[]` は accountKey/workspaceKey を必須とするため、主体が未検証の会話（handoff §08: 現在のアカウントと結び付けられない公式エクスポート由来の会話）に KEEP を付けられない。必須機能 FR05 が P1 の読み取り専用経路で成立しない。
2. handoff §05 の Import Worker に対応する契約がなく、DEV05 に型の目標がない。
3. `WebHistoryAdapter` が読み取り（`collect`）と破壊的操作（`commitOne`）を同じ型に持つため、読み取り専用のビルドにも削除メソッドが含まれる。
4. `FeatureGate` が technical・termsAndPermission・safety の 3 判定しか持たず、handoff §02 が別判定とする Chrome Web Store の審査適合を表せない。

### 変更内容

1. **KEEP キー**: `KeepEntry { provider, conversationId, scope: {accountKey, workspaceKey} | null }` とする。対象は、`provider` と `conversationId` が一致し、`scope` が `null` または対象の主体と一致する KEEP があれば保護される（BLUEPRINT §5）。`KeepSnapshot.protectedRefs` は `entries: readonly KeepEntry[]` に置き換える。
2. **取り込み契約**:
   ```ts
   interface ImportLimits {
     readonly maxCompressedBytes: number;
     readonly maxUncompressedBytes: number;
     readonly maxEntries: number;
     readonly maxJsonDepth: number;
     readonly maxMillis: number;
   }
   type ImportIssue = { readonly code: string; readonly entry: string | null };
   interface ImportResult {
     readonly status: "complete" | "partial" | "failed" | "cancelled";
     readonly records: readonly ConversationRecord[];
     readonly coverage: Coverage;
     readonly issues: readonly ImportIssue[]; // 取り込めなかった項目。黙って捨てない
   }
   interface ExportImporter {
     readonly provider: Provider;
     readonly version: string;
     parse(file: Blob, limits: ImportLimits, signal: AbortSignal): Promise<ImportResult>;
   }
   ```
   - 上限超過・未知形式・壊れたエントリー・中止は、部分結果を削除機能へ渡さない（AT10）。削除計画の候補にできるのは `status: "complete"` かつ `issues` が空の取り込みに由来する会話だけで、Domain の計画生成がこれを検査する。それ以外の結果は閲覧と KEEP にだけ使う。
   - 分岐した会話本文を連結しない。`ConversationRecord` は分岐構造を保持する（具体的な型は DEV05 で実データの形式を確認してから決める）。
3. **Adapter の分割**: `WebHistoryAdapter` を能力ごとに分ける。
   - `ReadAdapter`: `inspectScope`, `collect`
   - `AssistAdapter`: `openConversation`
   - `DeleteAdapter`: `preflight`, `commitOne`

   各 Adapter は自分の能力の `FeatureGate` を返す。`DeleteAdapter` はビルド時の有効化フラグで同梱を切り替え、gate が allowed でない配布版には実装コード自体を含めない。
4. **gate の判定項目**: `FeatureGate` に `storePolicy: GateStatus` を加え、technical・termsAndPermission・storePolicy・safety の 4 判定とする。`allowed` の根拠にしてはならないもの（個人利用、手動開始、OSS 公開、チェックボックスでの同意）は BLUEPRINT §10 に定める。

### 影響範囲

P1 以降のすべての型定義（`src/` の契約）、DEV05・DEV06・DEV08・DEV09・DEV11。既存の実装はない。

### 互換性

実装前のため移行対象はない。handoff の参考型定義とは非互換になるが、handoff は凍結資料であり、正本は BLUEPRINT と `src/` の型とする。

### 代替案

- KEEP: (a) エクスポート由来の会話には KEEP を付けられないとし、「整理のみ」の範囲を狭める → FR05 が必須である以上、採らない。(b) エクスポートごとに仮の主体キーを発行する → 後で Web 画面から主体が検証された同じ会話に KEEP が引き継がれず、保護が漏れる方向に働くため採らない。
- Adapter: 単一の型のまま、gate で `commitOne` を実行時に拒否する → 読み取り専用版にも削除コードが残り、gate の判定誤りがそのまま削除につながるため採らない。

### 受け入れ条件（試験観点）

- `scope: null` の KEEP が、任意の主体の同じ `provider` + `conversationId` を保護する。異なる `conversationId`・異なる `provider` は保護しない（境界の照合は完全一致）。
- 主体付きの KEEP は、主体が異なる同じ `conversationId` を保護しない。
- 上限超過、壊れたエントリーを含む ZIP、途中で中止した取り込みのいずれでも、`status` が `complete` 以外または `issues` が空でなく、その `records` から削除計画を生成できない。
- 分岐を持つ合成会話を取り込んだとき、分岐が連結されず別々に保持・検索される。
- Delete 無効のビルド成果物に `commitOne` の実装が含まれないことを、ビルド成果物の検査で確認する。
- `storePolicy` だけが `allowed` でない能力は配布版で無効になる。
- KEEP と確定の順序（BLUEPRINT §7）: 最終の KEEP 読み取りの後、確定指示の送出前に KEEP を追加すると、その件は確定されない（合成 Adapter で検証）。

Firing rate: unmeasurable before implementation (ビルド成果物も実サービスの主体情報もまだ存在しない; DEV03 の能力表と最初の配布ビルドができた時点で、Delete 同梱の有無と `scope: null` KEEP の件数を測定できる)

### 一部決定（2026-11-01、DEV05）

変更内容 2（取り込み契約）を P-0005 で具体化して実装した。`ImportResult` に構造レポート `report` を加えた。`ImportIssue.code` は閉じた列挙とした。変更内容 1・3・4 は未実装のまま提案状態とする。

### 一部決定（2026-11-01、DEV08）

変更内容 1（KEEP のキー）を P-0007 で実装した。`KeepEntry` と判定関数 `isProtected` は `src/keep/keepRules.ts` にある。変更内容 3・4 は未実装のまま提案状態とする。

## P-0002: ビルド構成と開発ツール

状態: 提案（2026-10-22）。構成の選択肢は D-0001 で所有者が決定済み。本 Proposal は版の固定方針を記録する。

### 目的

handoff §05 が開発時に固定するとした TypeScript/React/ビルドツールを決め、§12 の再ビルド追跡に耐える構成にする。

### 変更内容

- Vite + React + TypeScript（strict）。manifest は手書きし、Vite の複数エントリー（管理画面、Service Worker、Content Script、Import Worker）でビルドする。拡張向けフレームワーク（WXT、CRXJS）は使わない。
- テスト: Vitest（Domain・Adapter の合成 DOM 試験）、Playwright（拡張の統合試験）。
- Lint/format: Biome。パッケージ管理: pnpm（lockfile を commit し、CI は frozen-lockfile）。
- 依存の版は導入時に完全固定し、追加・更新は PR で理由を書く。
- `docs/handoff/` は Lint・型検査の対象から外す。

### 影響範囲

リポジトリの雛形（DEV04）、CI、配布 ZIP の生成手順（DEV14）。

### 互換性

新規。既存の成果物はない。

### 代替案

- WXT: HMR とマニフェスト生成が便利だが依存ツリーが大きく、監査と再ビルドの追跡が重くなる。
- @crxjs/vite-plugin: 中間的だが、プラグインの保守状況に配布手順が依存する。

### 受け入れ条件（試験観点）

- クリーン環境で `pnpm install --frozen-lockfile` からビルドでき、manifest に BLUEPRINT §4 の不採用権限が含まれない。
- CI で Biome、型検査、Vitest が実行され、失敗で赤になる。

### 決定（2026-10-22、DEV04 の雛形で実装）

本 Proposal の構成で実装した。導入時に固定した版（公開から 2 週間以上経った安定版から選んだ）: vite 8.3.3、@vitejs/plugin-react 6.1.2、react / react-dom 19.3.0、typescript 7.0.2、vitest 5.0.3、@biomejs/biome 2.5.15、@types/chrome 0.3.4、@types/react / @types/react-dom 19.3.0。パッケージ管理は pnpm 12.14.0（`packageManager` で固定）、Node.js 24。Playwright は統合試験を加える PR で導入する。

## P-0003: 個人用ビルドの自動一括削除と内部 Web API 方式

状態: 提案（2026-10-22）。次の事項は所有者が決定済み（2026-10-22）: 自動一括削除を個人利用のために作る、規約上のリスクを所有者が受容する、OpenAI・Anthropic へ許可を問い合わせない、ストア等で一般公開しない、方式は内部 Web API（M1）とし画面操作の自動化は採らない、ChatGPT に限り INV-02 を弱める。本 Proposal はそれに伴う BLUEPRINT の改訂範囲を記録する。

### 目的

所有者の目的は、サービス上に残す会話（KEEP）を選び、それ以外を条件でまとめて削除することである。削除対象は多く、KEEP もそれなりに多い。公式機能には選択式の一括削除がない（ChatGPT は全削除だけ、Claude Code on the web は 1 件ずつ。`docs/p0/alt-methods.md`）。人手による 1 件ずつの操作、全削除とローカル保管、既存の第三者ツールの利用（データ持ち出しの危険）は所有者が退けた。目的を満たすのは自動確定だけであり、その方式と安全条件を決める。

規約上の位置（`docs/p0/DEV02-evidence.md`）: OpenAI 利用規約の「自動的・プログラムによるデータ抽出」「レート制限・保護措置の回避」、Anthropic Consumer Terms の「API キーまたは明示の許可による場合を除く自動的手段でのアクセス」は、本機能を制限し得る。所有者はこれを受容し、事業者の許可があるとは表示しない。

### 方式の調査

既存ツールの調査（`docs/p0/existing-tools-chatgpt.md`, `docs/p0/existing-tools-claude.md`）では、方式は 3 つに分かれる。

- M1: サービス自身の画面が使う内部 Web エンドポイントを、ログイン中のページから呼ぶ。小規模な OSS ツールの大半が採る。
- M2: DOM のクリック自動化。利用者が最も多い ChatGPT 拡張が採るが、UI 変更のたびに壊れ、「完了」と表示して削除できていない報告が繰り返されている。
- M3: OS の UI 自動化。1 件約 16 秒。

### 変更内容（BLUEPRINT）

1. §1: 自動一括削除を「承認済み計画を 1 件ずつ内部 API で確定する」と定義し、個人用ビルドに限ると明記する。
2. §2: FR09 の条件を §10 の有効化条件とする。「作らない機能」の「非公開 API に依存した取得、認証情報の抽出」を、「対象サービス以外のオリジンへの通信、リモートで定義・更新されるエンドポイント、INV-02 の範囲を超える認証情報の抽出」に置き換える。
3. INV-02 を明示的に弱める。ChatGPT Adapter の Content Script に限り、`/api/auth/session` のアクセストークンをメモリ内に保持し、固定テンプレートの同一オリジン要求にだけ使うことを認める。保存・ログ・拡張内の他コンテキスト・他オリジンへの受け渡しは禁止し、実行の終了・停止・ページ移動・主体不一致で破棄する。Cookie の読み取りは例外なく禁止する。これは精緻化ではなく取得の許容であり、不変条件の弱化として扱う。
4. INV-15: 配布版の定義を加え、個人用ビルドの条件で有効にした能力を含むビルドを配布しないとする。
5. INV-16: サービスの API 応答も未信頼入力に含める。
6. INV-17（新設）: 要求を Adapter ごとの固定のメソッドとパステンプレートに限る。ID の正規形式の検証、同一オリジン限定、リダイレクト拒否、一覧全体・プロジェクト単位・アカウント単位のエンドポイントと複数 ID の一括削除エンドポイント（例: Claude の `delete_many`）の不使用、汎用の送信経路の禁止、応答の実行時検証。
7. INV-18（新設）: 要求は ISOLATED world の Content Script から送り、MAIN world を使わない。Content Script は計画・キュー・ループを持たず、Controller の 1 回分の指示（計画前の読み取り指示、または計画対象 1 件への削除指示）だけを実行する。
8. INV-19（新設）: 結果を確かめられない事象（429 に限らない）で以降の書き込みをすべて止める。自動再送・方式の切り替え・`Retry-After` による自動再開をしない。要求間隔は一覧取得・照合にも適用する。
9. §4: 「サービスへの要求の経路」を加える。activeTab の付与の持続範囲を DEV03 で実測する。
10. §5: 「内部 API による一覧取得」を加える。削除前に一覧を取り終えること、完全性を走査の安定性の確認済み契約と矛盾のなさがそろった場合だけ `complete` とすること（契約がなければ常に `partial`/`unknown` で、列挙された ID の削除だけを行う）、一覧に含まれる会話の種類の明示、レコードの実行時検証とスキーマ違反のレコードの計画からの除外、`partial` な一覧からの計画と表示の制約、主体をサービスの応答から確認し Cookie から決めないこと。
11. §6: 状態 `inventory` を加え、計画の対象を取得完了後に固定した ID 集合に限る。
12. §7: 主体の直前再確認、対象 ID 1 件の直前の読み取りによる fingerprint 照合、固定テンプレートの要求であることを確定条件にする。画面の確認画面の条件を置き換える。結果の分類 `verified-in-ui` を `verified` に改め、書き込み応答と独立した再照合の両方を要件とする。「削除の意味」節を加え、目標を公式 UI と同等の削除とし、完全消去を保証しない。
13. §8: 結果画面の文言を「サービス上で削除を確認」に改める。
14. §9: ページスクリプトによる改ざん、要求の改変、アクセストークンの漏えいを脅威に加える。拡張の要求とページ自体の通信を区別して約束する。
15. §10: 判定値 `ownerAcceptedRisk` と `notApplicable` を加え、個人用ビルドの有効化条件を定める。technical と safety は緩めない。合成試験の異常系と実サービスでの検証項目を定める。出荷停止条件を改める。
16. §11, §12: 配布の制約と、内部 API に関する未確定事項を加える。

### 契約の変更（P-0001 への追加）

- `GateStatus` に `ownerAcceptedRisk`（termsAndPermission 専用）と `notApplicable`（storePolicy 専用）を加える。どちらも `allowed` と等価に扱わない。
- 結果の分類 `verified-in-ui` を `verified` に改める。
- `DeleteAdapter` に、確定とは別の照合操作 `reconcileOne` を加える。`preflight` は対象 ID 1 件の読み取りと主体の確認を含む。
- Content Script への指示は読み取り指示と削除指示の 2 種類とする。どちらも対象の文書、期限、一回限りの実行 ID を持つ。読み取り指示は INV-17 の読み取り用テンプレートだけを使う。削除指示はさらに主体、計画 digest、対象 ID を持ち、操作ごとに発行条件が異なる。preflight の読み取りは承認と計画の対象であることを条件とし、確定は §7 のすべての条件を、照合はその対象に確定を送った後であることを条件とする。書き込み用テンプレートを使えるのは確定だけである（BLUEPRINT §4）。

### 受け入れ試験の読み替え（handoff の AT は改訂しない）

handoff の受け入れ試験は画面操作を前提に書かれている。内部 API の Adapter では、実装 PR の試験計画で次のように読み替える。

- AT18（DOM 変更・曖昧な対象）: 未知の応答形式、エンドポイントの不在・変更、正規形式でない ID、対象が 1 件に定まらない応答で、推測せず停止する。画面操作の削除へ切り替えない。
- AT25（タイムアウト・通信断）: INV-19 の各事象に広げる。
- AT26（成功の証拠）: 非表示化・アクセス失敗・削除成功の fixture を API 応答で作り、§7「結果の判定」の `verified` の要件で判定する。
- AT16, AT17, AT19〜AT24, AT31 はそのまま適用し、内部 API の Adapter と ISOLATED world の Content Script で検証する。

### 影響範囲

BLUEPRINT §1〜§12、P-0001 の `FeatureGate` と `DeleteAdapter`、DEV03（PoC の記録項目）、DEV09〜DEV12、受け入れ試験 AT18・AT25・AT26 の読み替え。既存の実装はない。

### 互換性

実装前のため移行対象はない。handoff の「非公開 API に依存した取得をしない」「認証情報を抽出しない」方針とは意図的に非互換になる。handoff は凍結資料として改訂しない。

### 代替案

- M2（DOM のクリック自動化）: トークンを読まずに済むが、誤った行を操作して KEEP の会話を消す事故を構造的に防げず、偽の成功の実例がある。所有者が非現実的と判断した。
- M3（OS の UI 自動化）: 遅く、M2 と同じ誤操作の問題を持つ。
- 人手による 1 件ずつの操作、全削除とローカル保管、既存ツールの利用、事業者への許可申請: 所有者が退けた。
- MAIN world での実行: ページのスクリプトが `fetch` を差し替えれば、トークンの読み取り・送信先の改変・応答の偽装ができる。
- Service Worker からの送信: 要求が拡張オリジンになり、Cookie と Origin の扱いの別検証が要る。activeTab の一時付与が切れた後は常設の host 権限が要る可能性がある（未実測）。
- INV-02 を「精緻化」として扱う案: 取得を言い換えることになるため採らない。
- ChatGPT でトークンを読まない M1: Cookie だけで動く削除経路は確認されていない。DEV03 で見つかれば INV-02 の例外を取り除く。

### 受け入れ条件（試験観点）

合成試験・統合試験:

- 総数と矛盾して短く終わる一覧、ページ境界で並びが変わる一覧、重複、不正なレコードで、完全性が `partial` になり、「全件」「すべて削除した」と表示されない。不正なレコードは列挙され、手動で選んでも計画の候補にならない（計画の生成で拒否される）。
- 走査の安定性の契約が確認されていない Adapter では、矛盾のない一覧（例: 取得中に 1 件削除・1 件追加されて総数が変わらない場合）でも `complete` にならない。
- 計画が存在しない `inventory` では読み取り指示だけが発行され、書き込みのテンプレートを使う指示は拒否される。
- 削除指示のうち preflight と照合は書き込みのテンプレートを使えない。確定は §7 の条件をすべて満たした場合だけ発行される。確定の後、承認が切れても照合は発行でき、照合できなければ当該件は `uncertain` のままになる。
- 計画の実行中に一覧へ現れた新しい会話は削除されない。
- `../conversations` のようにパス区切りを含む ID、正規形式でない ID では要求が送られない。テンプレート外のメソッド・パス・ヘッダーは拒否される。リダイレクト応答では `uncertain` になり停止する。
- 429、5xx、タイムアウト、通信エラー、想定外のスキーマ、認証・主体の変化、照合用の読み取りの失敗のそれぞれで、以降の書き込みが止まり、当該件が `uncertain` になり、自動再送されない。`Retry-After` は表示だけで自動再開しない。
- 主体（アカウント・ワークスペース・組織）が切り替わると承認が無効になる。
- Controller の終了、管理画面の閉鎖、ページ移動の後に確定指示が送られない。偽造・重複・期限切れ・別フレームの指示は拒否される。
- 書き込み応答だけ、または一覧からの消失だけでは `verified` にならない。
- 稼働中・稼働状態不明の Claude Code セッションは除外される。
- アクセストークンが storage、ログ、拡張内メッセージに現れないことを、統合試験での監視とビルド成果物の検査で確認する。MAIN world への注入がビルド成果物に含まれない。
- KEEP と確定の順序の試験（P-0001）が内部 API の Adapter でも成立する。

実サービス（所有者が使い捨て会話で実施）: BLUEPRINT §10「検証」の 7 項目を ChatGPT と Claude Code それぞれで確認し、観測できなかった項目の能力を未検証のまま無効にする。

Firing rate: unmeasurable before implementation (内部 API の Adapter も実サービスでの観測もまだない; DEV03 の PoC と所有者の使い捨て会話での検証で、個人用ビルドの有効化条件の成立、INV-19 の停止の発生、`partial` 判定の割合を測定できる)

## D-0002: 対象範囲と対応環境の所有者決定（2026-10-22）

状態: 決定

handoff が ADR として残すとした「対象プラン」「言語」の判断を記録する。詳細の表は `docs/p0/DEV01-scope.md`。所有者の回答（2026-10-22）は ChatGPT の範囲、対応環境、UI 言語、進め方であり、Claude 側の限定は下記のとおり D-0001 からの導出である。

- ChatGPT: 所有者の個人アカウント（Plus または Pro）の個人ワークスペースだけを対象にする。組織ワークスペース（Team / Business / Enterprise / Edu）は対象外とし、主体を個人ワークスペースと確認できない場合は自動削除を無効にする。
- Claude Code on the web: 所有者の Max プラン（Consumer Terms）の組織だけを対象にする。Team / Enterprise の組織は対象外。この項目は所有者に直接確認したものではなく、D-0001 の「Claude Max（Consumer Terms）」から導出した。Team / Enterprise には Commercial Terms が適用され（S13、`docs/p0/DEV02-evidence.md` §4.3）、P-0003 で受容した規約リスクの評価範囲の外にある。
- 対応環境の目標: Google Chrome 安定版の Windows、macOS、Linux。検証状態は DEV13 で記録し、実測前に対応済みとは宣言しない。
- UI 言語: サービス側は日本語 UI を検証の前提にする。拡張の表示は日本語。削除の判定は UI 文言に依存させない（P-0003）。
- 進め方: DEV01 → DEV04（拡張の雛形）→ DEV03（合成データでの Adapter PoC と実画面検証の手順書）の順に進め、所有者による実画面検証の手前で止める。

## P-0004: 実行コンテキスト・メッセージ・権限（DEV04）

状態: 提案（2026-10-22）

### 目的

BLUEPRINT §4 が DEV04 で決めるとした、Controller と Import Worker の実行コンテキスト、拡張内メッセージ、権限を決める。handoff が ADR として残すとした権限の判断もここに記録する。

### 変更内容

1. 管理画面は拡張専用タブ（`app.html`）に置き、Controller はそのタブのページ内で動かす（UI とは別モジュール）。承認・計画は Controller のメモリにだけ置くため、タブを閉じれば承認も消え、INV-08 が構造的に成り立つ。Service Worker は終了し得るため Controller を置かない。
2. Service Worker は、拡張アイコンのクリックで管理画面タブを開き、クリックされたタブの ID を管理画面の URL に渡すだけとする。状態を持たず、メッセージを受け付けない。
3. Import Worker は管理画面から起動する Dedicated Web Worker とする（実装は DEV05）。
4. Content Script は manifest で宣言せず、Controller が `chrome.scripting.executeScript` で対象タブの ISOLATED world に注入する（INV-18）。注入は、対象タブの URL が対応ページ（`https://chatgpt.com` のオリジン、または `https://claude.ai` の `/code` 以下）と完全一致で判定できた場合だけ行う。対象外のサイトには注入しない。注入の権限は、利用者が対象タブで拡張アイコンを押したときの activeTab の一時付与に頼る。管理画面タブ（別タブ）からこの付与で対象タブへ注入・送信できることは未実測であり、Chrome 上の統合試験と DEV03 で確かめる。成り立たない場合は、対象オリジンに限った任意の host 権限を別の Proposal で検討する。
5. メッセージは Controller から Content Script への要求と、その応答だけとする。Content Script から始まるメッセージを Controller も Service Worker も受け付けない（`runtime.onMessage` を登録しない）。Content Script は、送信元が自拡張の拡張ページ（`sender.id` が自拡張、`sender.tab` がない、`sender.url` が自拡張のオリジン）であること、版・種類・キーの完全一致、期限、一回限りの実行 ID を検証する（INV-11）。型は手書きの実行時検証で確かめ、検証ライブラリの依存を加えない。
6. 権限は `activeTab` と `scripting` だけとする。`storage` は KEEP の保存を実装する DEV08 で追加する。host permissions、`content_scripts`、`web_accessible_resources`、`externally_connectable` は持たない。
7. 拡張ページの CSP を既定より狭め、`connect-src 'none'` などで拡張ページからのネットワーク通信を禁じる（INV-01）。サービスへの要求は Content Script から送る（P-0003）。
8. ビルドは Vite で 3 回に分ける: 管理画面（HTML エントリー）、Content Script（単一ファイルの IIFE）、Service Worker（単一ファイルの IIFE）。`executeScript` で注入するファイルと classic の Service Worker は import を持てないため。
9. ビルド成果物の検査（`scripts/check-dist.mjs`）を CI で実行する: manifest の権限と禁止項目、CSP の必須ディレクティブ、HTML の外部参照、`MAIN` world の指定、`onMessage` の登録が Content Script だけであること、Content Script と Service Worker が import を持たないこと。この検査は、依存の更新やビルド設定の変更で成果物が誤って規則に反することを検出する多層防御である。敵対的に作られた入力をすべて検出する仕組みではなく、実行時の防御は CSP と、拡張が対応するコードを持たないことによる。判定できない形は違反として扱う（安全側に倒す）。
10. `minimum_chrome_version` は `120` とする。実測で裏付けたものではなく、DEV13 で確かめる。

### 影響範囲

BLUEPRINT §4、雛形のすべてのエントリー、CI。

### 互換性

新規。既存の成果物はない。

### 代替案

- Controller を Service Worker に置く: 終了で状態を失い、承認の失効と再開の扱いが複雑になる。管理画面タブに置けば、タブの寿命と承認の寿命が一致する。
- Controller を Offscreen Document に置く: 利用者から見えない場所で処理が続き得るうえ、理由付きの作成が要る。
- `content_scripts` の宣言: 対象サイトを開くたびに自動で注入され、利用者が開始していないページにもコードが入る。
- 常設の host permissions: activeTab の一時付与で足りるかを先に実測する（BLUEPRINT §4）。
- 検証ライブラリ（zod 等）: 依存が増える。メッセージの種類が少ない間は手書きの検証で足りる。

### 受け入れ条件（試験観点）

- 対象ページの判定: 類似ホスト、別スキーム、別ポート、サブドメイン、userinfo、通常の Claude チャット、`/codex` のようなパスの接頭辞一致を拒否する（単体試験）。
- メッセージ検証: 余分なキー、欠けたキー、別の版・種類、UUID v4 でない実行 ID、整数でない期限、プレーンオブジェクトでない値を拒否する（単体試験）。
- Content Script: 他の Content Script やタブからの送信、別拡張からの送信、期限切れ、再利用された実行 ID、対応ページ以外での実行を拒否する（単体試験）。
- Controller: 対象タブなし、対応外のページ、URL を読めないタブ、注入の失敗、応答の不一致をそれぞれ区別して報告し、接続済みにしない（単体試験）。
- ビルド成果物: 上記 9 の検査が CI で通り、違反を入れると失敗する（検査の単体試験）。
- AT17・AT27・AT31 の Chrome 上での統合試験（Playwright）は、本 Proposal の範囲外とし、後続の PR で行う。それまでこれらの試験を合格扱いにしない。

Firing rate: unmeasurable before implementation (対象ページの判定と送信元の検証は実ブラウザーの実入力がまだない; Playwright の統合試験と所有者の実画面確認で、対象ページで注入が成立した割合と拒否の発生を測定できる)

## D-0003: ChatGPT を優先し Claude Code を後回しにする（2026-11-01）

状態: 決定（D-0002 の進め方を改める）

- 所有者の決定（2026-11-01）: 当面は Claude Code on the web を必要としないため、ChatGPT を最優先にする。Claude Code の Adapter と実画面検証は後回しにする。対象範囲（BLUEPRINT §1）からは外さない。
- 進める順序: DEV05（公式エクスポートの取り込み）→ DEV07（一覧・検索・プレビュー）→ DEV08（KEEP と暗号化保存）→ DEV09（削除計画と承認）→ DEV04 の Chrome 上の統合試験。統合試験には、所有者が Playwright のブラウザーを一度導入する必要がある。
- ChatGPT 上で削除を確定する最後の段階（ログイン中のセッションを使う部分）は、この順序に含めない。未実装のまま記録し、扱いは所有者が後で決める。
- マージの規則は D-0001 のまま（lizy-reviewer の APPROVE かつ CI が緑）。

## P-0005: ChatGPT 公式エクスポートの取り込み（DEV05）

状態: 提案（2026-11-01）

Gate-category: none

### 目的

P-0001 の取り込み契約（`ExportImporter` / `ImportResult` / `ImportLimits`）を、ChatGPT の公式エクスポート（ZIP）について具体化する。P-0001 が DEV05 に先送りした「分岐を保持する `ConversationRecord` の具体的な型」、受け付ける ZIP の範囲、上限の既定値、Import Worker との通信を決める。

形式の前提: BLUEPRINT §5 のとおり、エクスポートの ZIP 内形式は所有者の実データで確かめるまで固定の事実として扱わない。一方で CLAUDE.md により実エクスポートを開発者・AI エージェントへ渡さない。このため本 Proposal は、公開情報から知られている形（ルートの `conversations.json` が会話の配列で、各会話が `mapping` にノードの木を持つ）に対して実行時検証で失敗側に倒れるパーサーを作り、あわせて本文を含まない**構造レポート**を出す。所有者は自分の実エクスポートで構造レポートを確認し、形式の差分は後続の PR で直す。構造レポートが得られるまで、実エクスポートでの動作は未確認とする。

### 変更内容

1. **ZIP の読み取り（依存を増やさない）**: ZIP のコンテナは自前で読み、展開はブラウザー標準の `DecompressionStream("deflate-raw")` を使う（Chrome 103 以降、Node.js 24 で利用可能）。ZIP ライブラリは加えない（D-0001 の依存最小化）。受け付ける範囲は次のとおり閉じた部分集合とし、外れるものは理由のコードを付けて失敗にする。黙って読み飛ばさない。
   - 終端レコード（EOCD）はファイル末尾にあり、コメント長が残りのバイト数と一致するものだけを認める。この条件を満たす候補が 2 つ以上あれば（コメント内に別のディレクトリを隠した形）失敗にする。ZIP64、複数ディスク、中央ディレクトリの前後に余分なデータがある形は受け付けない。
   - 中央ディレクトリは宣言された件数・大きさをちょうど使い切ること。同じ名前のエントリーが 2 つあれば失敗（どちらを読むか曖昧なため）。
   - ローカルレコードは中央ディレクトリより前のバイト列を隙間なく敷き詰めること。最初のレコードはオフセット 0 から始まり、各レコード（ヘッダー・名前・拡張フィールド・圧縮データ、フラグのビット 3 があれば 12 または 16 バイトのデータ記述子）は、次のレコードまたは中央ディレクトリの開始位置でちょうど終わる。重なり・隙間（一覧にないレコードを隠せる）は失敗にする。データ記述子の形（署名の有無）は、CRC の値ではなくこの配置から決める。すべてのローカルヘッダーを中央ディレクトリと照合する。
   - 読むエントリー（後述の `conversations.json`）は、暗号化されていないこと、方式が無圧縮（0）か deflate（8）であること。ローカルヘッダーの名前のバイト列・フラグ・方式が中央ディレクトリと完全に一致すること。CRC-32 と大きさが、ローカルヘッダー（フラグのビット 3 があればデータ記述子）で中央ディレクトリと一致すること。ZIP64 の標識があれば失敗にする。データ（と記述子）は次のレコードの開始位置より前に収まること。展開後の大きさが宣言と一致し、CRC-32 が一致すること。
   - 名前の復号では先頭の BOM を取り除かない（BOM 付きの名前を既知の名前と一致させない）。
   - 展開中に出力バイト数を数え、上限を超えた時点で打ち切る。宣言された大きさは信用しない。
   - ファイル名をパスとして使わない。読むエントリーは名前の完全一致で選ぶ。
2. **エントリーの分類**: ルートの `conversations.json` だけを解析する。既知の付属物（`chat.html`、`user.json`、`message_feedback.json`、`shared_conversations.json`、画像・音声・PDF 等の添付ファイル）は解析せず、`coverage.excludedScopes` に分類名を記録する。どれにも当たらないエントリーは `unknown-entry` の問題項目にして取り込みを `partial` にする（会話を含むかもしれないファイルを黙って範囲外にしないため）。既知の一覧は推測を含むため、構造レポートで実データの一覧が分かった時点で改める。
3. **会話の検証と分岐の保持**:
   - 会話 ID は UUID の正規形式（小文字 16 進、8-4-4-4-12）に限る。`id` と `conversation_id` が両方あり異なる場合、どちらもない場合、形式外の場合はその会話を取り込まず、問題項目に列挙する。
   - `create_time` / `update_time` は Unix 秒の有限数で 2015-01-01 から 2100-01-01 の範囲だけを日時にする。欠けていれば `null`（日時不明。AT05）、型や範囲が不正なら `null` にして問題項目に列挙する。
   - `mapping` は、キーとノードの `id` が一致し、親子の参照が相互に整合し、根から全ノードにちょうど 1 回ずつ到達できる木であることを検証する（循環・孤立・二重の親を拒否）。`current_node` は木に含まれるか `null`。満たさない会話は取り込まず列挙する。
   - 本文は分岐を連結しない。取り込み後の会話は、ノードの配列（`id`、`parentId`、`childIds`、`message`）と `currentNodeId` を持つ。分岐ごとの検索・プレビューは DEV07 で、この木から根→葉の経路として作る。
   - メッセージ本文は文字列として取り出す。`text` と `code` は全文、`multimodal_text` は文字列の部分だけを取り、画像等のオブジェクトの部分があれば本文の取得範囲を `partial` にする。既知の種類の形に反するもの（`content` がオブジェクトでない、`content_type` が文字列でない、`text` の `parts` が文字列の配列でない、`multimodal_text` の部分が文字列でもオブジェクトでもない、`code` の `text` が文字列でない）は `invalid-content` として列挙し、取り込みを `partial` にする。それ以外の種類（思考過程・ツール出力等）は本文を取らず、メッセージと会話の本文の取得範囲を `none` / `partial` にする。これは問題項目にしない。取り込みの状態は会話の列挙の完全性を表し、本文の取得範囲は会話ごとの `observation.contentCoverage` と構造レポートの `messageCoverage` が表す（DEV07 は未取得の本文を検索不一致と断定しない。INV-14）。役割は `user` / `assistant` / `system` / `tool` 以外を `unknown` にする。
   - 同じエクスポート内で同じ会話 ID が 2 回以上現れたら、その ID の会話はすべて取り込まず `duplicate-id` として列挙する。ID の重複は、木や本文の検証で拒否される会話も含めて、ID を識別できたすべての会話で数える。
   - 主体はエクスポートから検証しない。取り込んだ会話の主体は常に `unverified`（表示名 `null`）とし、`user.json` のメールアドレス等は読まない（INV-06）。
4. **上限の既定値**: `maxCompressedBytes` 2 GiB、`maxUncompressedBytes` 256 MiB（解析するエントリーの展開後の合計）、`maxEntries` 100,000、`maxJsonDepth` 64、`maxMillis` 120,000。実データでの大きさが分かっていないため暫定値とし、構造レポートの値で見直す。`JSON.parse` は深さを制限しないため、解析の前に文字列のエスケープを考慮した括弧の深さの事前走査を行う。
5. **結果の状態**: 上限超過・ZIP の形式外・`conversations.json` の欠落や構文エラー・最上位が配列でない場合は `failed`、中止は `cancelled` とし、どちらも `records` を空にする（部分結果を渡さない。AT10）。会話単位の問題か未知のエントリーがあれば `partial`、なければ `complete`。`coverage` の宣言範囲は「このエクスポートの `conversations.json`」であり、アカウント上の全会話とは主張しない（`reportedTotal` は `null`）。
6. **構造レポート**: `ImportResult` に `report` を加える。内容は、エントリーの分類ごとの件数と大きさ、未知エントリーの拡張子ごとの件数、会話とメッセージの項目名ごとの出現数、`content_type` と役割ごとの出現数、メッセージの本文の取得範囲ごとの出現数、ノード数、分岐（葉）の数、木の最大の深さ。タイトル・本文・ID・ファイル名・メールアドレスは含めない（INV-03）。項目名・`content_type`・役割は、固定の語彙（`src/import/chatgptSchema.ts`）に含まれるものだけをそのまま数え、それ以外は文字列を残さず `(other)` として数える。所有者が画面で確認し、必要なら転記して形式の差分を報告できる。
7. **Import Worker**: 解析は管理画面から起動する Dedicated Web Worker で行う（P-0004）。管理画面は `{ kind: "start", file, limits }` を送り、Worker は `{ kind: "result", result }` を 1 回返す。中止と時間切れは管理画面側で `Worker.terminate()` して確実に止め、それぞれ `cancelled` / `failed`（`limit-time`）にする。`JSON.parse` の途中では協調的な中止ができないため、終了による停止を正とする。解析の本体は Worker に依存しない純粋な関数とし、単体試験で直接検証する。
8. **再取り込み**: 管理画面は取り込みの結果を 1 つだけ保持し、新しい取り込みは前の結果を丸ごと置き換え（統合しない）、取り込みの版番号を 1 増やす。取り込みの途中で新しい取り込みを始めたら前の Worker を止める。DEV09 の削除計画はこの版番号に結び付け、版が変われば承認を無効にする（AT07。承認は DEV09 で実装）。

### 影響範囲

`src/import/`（新設）、管理画面、ビルド成果物（Worker のチャンクが加わる）、BLUEPRINT §5・§12。P-0001 の取り込み契約に `report` を加える。

### 互換性

新規。既存の取り込み機能はない。P-0001 の `ImportResult` に項目を 1 つ加える。

### 代替案

- ZIP ライブラリ（fflate 等）を加える: 実装量は減るが依存が増え、監査の範囲が広がる。展開は標準の `DecompressionStream` で足り、自前で読むのは構造の単純な中央ディレクトリだけである。
- ファイル全体をメモリに読んで展開する: 添付物の多いエクスポートでは無駄に大きい。`Blob.slice` で末尾・中央ディレクトリ・対象エントリーだけを読む。
- 未知のエントリーを範囲外として無視する: 会話を含むファイルが追加された場合に黙って取りこぼし、`complete` と誤って示す（DC1）。
- 会話本文を分岐ごとに平坦化して保持する: 分岐の関係と現在のノードが失われ、DEV07 で分岐ごとの表示ができない。

### 受け入れ条件（試験観点）

合成 ZIP（試験コードが生成する）で次を確認する。

- 正常なエクスポートが `complete` になり、会話数・日時・タイトル・本文・分岐が正しく取り込まれる。分岐を持つ会話で分岐が連結されず、葉ごとに経路が分かれる（P-0001）。
- 日時のない会話の日時が `null` になる（AT05）。
- 圧縮後・展開後・エントリー数・JSON の深さ・時間の各上限の超過、ZIP でないファイル、ZIP64・複数ディスク・暗号化・未対応の方式・CRC の不一致・展開後の大きさの不一致・切り詰められたエントリー・同名エントリー・`conversations.json` の欠落・構文エラーで `failed` になり、`records` が空で理由のコードが示される（AT10）。
- 中止で `cancelled` になり、`records` が空になる（AT10）。
- 他のレコードの中に置かれたレコード、コメント内に隠した 2 つ目の EOCD、ローカルヘッダーだけの暗号化フラグ・ZIP64 標識・CRC や大きさの不一致、BOM 付きのローカル名、中央ディレクトリと食い違うデータ記述子で失敗する。正しいデータ記述子（署名あり・なし）は読める。
- 形の崩れたメッセージ本文が `invalid-content` として列挙され、`complete` にならない。重複 ID の片方が木の検証で拒否されても、もう片方も取り込まれない。
- 会話 ID の不正・不一致・欠落、重複 ID、壊れた木（循環・孤立・二重の親・存在しない `current_node`）、不正な日時、未知のエントリーで `partial` になり、該当項目が列挙され、`complete` にならない。
- `complete` 以外または問題項目のある結果を、削除計画の候補として扱わない判定関数が拒否する（P-0001。計画生成は DEV09）。
- 構造レポートに、合成データのタイトル・本文・会話 ID・添付ファイル名が含まれない。
- 再取り込みで前の結果が置き換わり、版番号が増える（AT07 の前半）。
- 文字列中の括弧は深さに数えず、実際の入れ子は数える。
- ビルド成果物の検査が Worker のチャンクを含めて通る。

Chrome 上の統合試験と所有者の実エクスポートでの確認は本 Proposal の範囲外であり、合格扱いにしない。

Firing rate: unmeasurable before implementation (上限・既知エントリーの一覧・UUID 形式の判定は、実エクスポートの大きさ・エントリー構成・ID 形式がまだ分かっていない; 所有者が実エクスポートで構造レポートを確認した時点で、各上限への到達、`unknown-entry` の発生、ID 形式外の件数を測定できる)

## P-0006: 一覧・検索・プレビュー（DEV07）

状態: 提案（2026-11-01）

Gate-category: none

### 目的

取り込んだ会話（P-0005）を管理画面で一覧・検索・プレビューできるようにする。検索の結果は DEV09 の削除計画が選択の起点として使うため、検索の意味（何を「一致」「不一致」とするか）を Domain の契約として固定する。

### 変更内容

1. **検索の判定（3 値）**: 検索語は前後の空白を除き、NFKC 正規化と小文字化をしてから、タイトルと取り込んだメッセージ本文に部分一致で照合する（全角・半角、大文字・小文字の違いを同一視する）。各会話の判定は次のいずれかとする。
   - `match`: タイトルか、取り込んだ本文のどこかに検索語がある。
   - `unknown`（画面では「判定不能」）: 検索語がなく、会話の本文の一部が取り込まれていない（`observation.contentCoverage` が `complete` でない）。未取得の本文に検索語があるかもしれないため、不一致と断定しない（INV-14、AT08）。
   - `no-match`: 検索語がなく、本文がすべて取り込まれている。
   画面は 3 つの件数を常に示し、どの区分の会話も一覧で見られる。`unknown` を `no-match` に含めない。タイトルのない会話はタイトルでは一致しないが、本文では照合する（一覧から落とさない）。
2. **一致の単位**: 一致はメッセージ（ノード）単位で記録し、プレビューで一致したメッセージを含む分岐を示す。分岐の経路を検索のために列挙しない（分岐の多い会話で計算量が増えるため）。
3. **日時の絞り込み**: 対象の日時（作成日時 `createdAt` または更新日時 `updatedAt`）と開始日・終了日（両端を含む。利用者の端末のタイムゾーンの日付として扱う）で絞り込む。対象の日時が不明な会話は日時の条件から除外し、除外した件数を表示する。利用者が「日時不明の会話を表示」を選んだ場合だけ、日時不明と明示して一覧に含める。日時不明の会話を古い会話として扱わない（AT05）。日時の条件を先に適用し、検索の区分はその残りで数える。開始日・終了日のどちらかが不正な入力（ブラウザーが不正と報告した入力、存在しない日付）であるか、開始日が終了日より後であれば、日時の条件を一切適用せず、その旨を表示する（不正な側を空欄とみなして片側だけで絞り込まない）。
4. **並び順**: 対象の日時の新しい順。日時不明は最後に置き、同順位は取り込みの順とする。
5. **索引**: 正規化した文字列の索引はメモリにだけ置く（INV-03）。取り込みの版番号（P-0005 の 8）ごとに作り直し、再取り込みの後に前の取り込みの会話を検索しない。
6. **一覧**: 固定の行の高さで仮想化し（手書き、依存を増やさない）、ARIA の listbox としてキーボードで操作できる（上下、Home/End、PageUp/PageDown、Enter でプレビュー、Esc でプレビューを閉じて一覧へフォーカスを戻す）。Enter はプレビューを開く以外の操作をしない（AT33）。行は、タイトル（なければ「（無題）」）、日時または「日時不明」、取得元「公式エクスポート」、本文の取得範囲（全文/一部のみ、記号と文字で示し、色だけに頼らない）を示す。一覧の見出しは「取得済み N 件 / 全件数不明」とする。
7. **プレビュー**: 本文は React のテキストノードとしてだけ描画する（`dangerouslySetInnerHTML`、Markdown の解釈、リンク化、画像を使わない。AT09）。分岐が複数ある会話は分岐を選べ、既定は現在のノードで終わる分岐とする。取り込んでいない種類のメッセージは、黙って省かず注記を表示する。
8. **画面の配置**: BLUEPRINT §8 の 3 列（左に検索と絞り込み、中央に一覧、右にプレビュー、下部に件数）とする。取り込み欄（P-0005）は上部に残す。
9. **スタイル**: 手書きの CSS 1 枚。外部フォント・画像・アイコンを読み込まない（INV-01）。明暗は `prefers-color-scheme` に従う。

見込まれる影響: P-0005 は思考過程・ツール出力などの非テキストのメッセージの本文を取り込まない。実エクスポートでそうしたメッセージを含む会話が多ければ、一致しない会話の多くが「不一致」ではなく「判定不能」になる。これは INV-14 に従った結果であり、割合は所有者の構造レポートの `messageCoverage` で確かめる。

### DEV07 に含めないもの

- KEEP の列（DEV08）、タグ（MVP 後の候補）、複数選択と削除計画（DEV09）、Web 画面からの一覧取得（DEV06。D-0003 の順序に含まれない）。行には KEEP と選択のための場所を空けておく。BLUEPRINT §8 は KEEP を一覧の必須表示とするが、DEV08 までは表示しない。

### 影響範囲

`src/browse/`（新設）、管理画面のコンポーネントとスタイル、BLUEPRINT §8。

### 互換性

新規。既存の画面の取り込み欄は残す。

### 代替案

- 検索の結果を一致/不一致の 2 値にする: 本文が一部しか取り込まれていない会話を不一致と断定し、INV-14 に反する。
- 仮想化ライブラリ（react-window 等）: 依存が増える。固定の行の高さなら計算は単純である。
- 分岐ごとに本文を連結して検索する: 分岐の多い会話で計算量とメモリが増え、どの分岐で一致したかの表示も変わらない。

### 受け入れ条件（試験観点）

- 本文の一部が取り込まれていない会話で検索語が見つからないとき `unknown` になり、`no-match` に数えられない（AT08）。本文がすべて取り込まれていれば `no-match` になる。
- 全角・半角、大文字・小文字の違いがあっても一致する。タイトルのない会話も本文で一致する。
- 日時の条件で日時不明の会話が除外され、その件数が示される。「日時不明の会話を表示」で一覧に含まれ、日時不明と示される（AT05）。両端の日付を含む。
- 再取り込みの後、前の取り込みの会話が検索結果に現れない。
- `<script>`、イベント属性、外部画像、`javascript:` の URL、Markdown の画像記法を含む本文をプレビューに描画した結果に、要素として現れず、文字列として現れる（AT09。サーバー描画の文字列で検査）。
- 仮想化の範囲計算（0 件、末尾、オーバースキャン）とキーボードの移動（端で止まる、空の一覧）が単体試験で正しい。
- 架空の 10,000 件で検索の所要時間を計測して記録する（基準値は実測後に合意する。BLUEPRINT §10）。
- 実ブラウザーでのキーボード・読み上げの確認（AT33）、Chrome 拡張としての統合試験は本 Proposal の範囲外とし、合格扱いにしない。画面の目視確認は開発用サーバーで行い、その結果だけを報告する。

検索・絞り込みの条件は利用者が指定する分類であり、`unknown` の判定も省略ではなく不一致と断定しないための分類である。再利用（cache）に当たるのは変更内容 5 の索引の再利用だけである。

Firing rate: unmeasurable before implementation (索引の再利用は管理画面の操作の実績がないと測れない; 所有者の取り込みで管理画面を使った時点で、同じ版番号での検索の回数と索引の作成回数の比として測定できる)

## P-0007: KEEP の暗号化保存と KEEP ストアの状態（DEV08）

状態: 提案（2026-11-01）。実装前に Codex の critique（1 ラウンド、指摘 9 件）を受けて改訂した。

Gate-category: state-machine, concurrency-ownership, shared-state-invariant

### 目的

KEEP（サービス上に残す会話）の印を、利用者の明示的な同意のもとで端末内に暗号化して保存する（D-0001: P1 で暗号化保存まで実装する）。KEEP の読み取り失敗・破損・鍵不一致・競合を「KEEP なし」と扱わない（INV-05）ための状態と、複数の管理画面タブからの書き込みの順序を決める。P-0001 の変更内容 1（KEEP のキー）を実装する。

### 変更内容

1. **権限と信頼境界**: manifest に `storage` を加える（P-0004 の 6 で DEV08 に先送りしたもの）。`storage.sync` は使わない（INV-01、AT29）。`chrome.storage.local` は既定で Content Script から読めるため、管理画面は起動時に `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` を呼び、その完了を待つ。失敗した場合と API がない場合は、KEEP ストアを `unavailable`（`access-level`）にして読み書きを一切せず、対象タブへの接続（Content Script の注入）も行わない（失敗側に閉じる。BLUEPRINT §4 の信頼境界）。制限が実際に Content Script の読み取りを拒むことは Chrome 上で未確認であり、DEV04 の統合試験で、Content Script からの読み取りが拒否されることを確かめる。
2. **保存形式**: `chrome.storage.local` の 1 つのキー（`lizychattidy.keep`）に 1 つの封筒を置き、書き込みは 1 回の `set` で行う（印とデータを分けて半端に書かれる形を作らない）。封筒は次の項目だけを持つ閉じた形とし、項目の過不足・型の違いは `corrupt` とする。
   - `format`: 文字列 `lizychattidy-keep`。
   - `schemaVersion`: 整数 1。
   - `storeId`: 作成時の 16 バイトの乱数（base64）。作り直しを区別する。
   - `kdf`: `{ name: "PBKDF2", hash: "SHA-256", iterations, salt }`。`iterations` は安全な整数で 100,000 以上 10,000,000 以下（範囲外は `corrupt`）、`salt` は 16 バイト。
   - `cipher`: `{ name: "AES-GCM", iv }`。`iv` は 12 バイト。
   - `revision`: 1 以上の安全な整数。
   - `ciphertext`: 暗号文。
   バイト列はすべて標準の base64（パディングあり）で表し、他の表記は `corrupt` とする。AAD は、`[format, schemaVersion, storeId, kdf.name, kdf.hash, kdf.iterations, kdf.salt, cipher.name, cipher.iv, revision]` の JSON 配列（この順、空白なし）の UTF-8 とする。見出しのどの項目を変えても認証に失敗する。平文は `{"revision": n, "entries": [...]}` の UTF-8 JSON で、`revision` は見出しと一致しなければならない。`revision` が安全な整数の上限に達したら書き込みを拒む。固定の試験ベクトルで符号化を固定する。
3. **保存する内容**: KEEP の要素（`provider`、`conversationId`、`scope`。P-0001）だけ。タイトル・本文・日時は保存しない（INV-03、AT28）。`conversationId` は Adapter の正規形式（ChatGPT は UUID の小文字形式。P-0005）で検証する。`scope` は `null` か `{ accountKey, workspaceKey }`（空でない文字列）。同じ要素の重複は `corrupt`。公式エクスポート由来の会話の KEEP は `scope: null` とする。
4. **鍵**: 利用者のパスフレーズ（NFC 正規化、12 文字以上）から WebCrypto の PBKDF2-SHA256 で AES-GCM 256 ビットの鍵を導出する。反復回数は作成時に 600,000（OWASP の PBKDF2-HMAC-SHA256 の推奨値）とする。salt と `storeId` は作成時に `crypto.getRandomValues` で作る。鍵は取り出し不可の `CryptoKey` として管理画面のメモリにだけ置き、鍵を導出した封筒の KDF の指定（名前・ハッシュ・反復回数・salt）と組で保持する。通常の書き込みはこの組をそのまま使い、反復回数や salt を変えない（鍵の作り直しは別の明示的な操作とし、DEV08 では作らない）。書き込みごとに新しい乱数の IV を使う。パスフレーズは導出の後に保持しない。Argon2 等は依存を加えることになるため使わない（D-0001）。
5. **状態と遷移**: KEEP ストアは次の状態を持つ。BLUEPRINT §5 の 4 状態に `absent` を加える。
   - `absent`: 封筒がない。利用者の明示的な作成（同意とパスフレーズ）でだけ `available` へ移る。自動では作らない。
   - `locked`: 封筒があり、構造は正しい。解錠は保存領域から封筒を読み直してから行う。正しく復号できれば `available`。認証に失敗したら `locked` のまま「パスフレーズが違うか、保存データが壊れています」と示す（AEAD では区別できない）。認証に成功したのに平文の構造が不正、または `revision` が一致しなければ `corrupt`。読み取りや暗号処理の失敗は `unavailable`。
   - `available`: 復号済み。`entries`、`revision`、直前に認証した封筒を持つ。KEEP の追加・解除ができる。
   - `corrupt`: 封筒の構造が不正、未知または新しい `schemaVersion`、KDF の範囲外、平文の構造が不正。上書きせず、利用者による削除だけを許す（AT13、AT14）。
   - `unavailable`: 理由のコードを持つ。`access-level`、`read-failed`、`write-failed`、`delete-failed`、`crypto-failed`、`lock-unavailable`、`lock-timeout`、`conflict`、`changed-elsewhere`、`regressed`（同じ保存先の `revision` が、この画面で認証済みの値より小さい）、`replaced`（この画面で認証済みの保存先と `storeId` が違う）。再読み込みで状態を判定し直す。`regressed` と `replaced` は、利用者が明示的に「この保存データを使う」を選んだ場合だけ、その封筒を受け入れる。
   - 許される操作: 作成は `absent` だけ、解錠は `locked` だけ、KEEP の変更と施錠は `available` だけ、受け入れは `regressed` / `replaced` だけ、再読み込みと削除は読み込み中以外のすべて。それ以外は拒否する。
6. **非同期の操作の無効化**: ストアは世代番号を持ち、施錠・再読み込み・削除・他のタブの変更・競合のたびに増やす。解錠・作成・書き込みは開始時の世代を記録し、保存領域へ書く直前と状態を公開する直前に世代が変わっていないことを確かめる。変わっていれば書かず、公開しない。同じタブ内の書き込みは 1 つずつ順に行う。施錠は世代を増やして新しい書き込みを止めた後、既に送った書き込みが終わるのを待ってから `locked` を公開する。
7. **排他と前提条件**: 作成・書き込み・削除は Web Locks（名前 `lizychattidy-keep`）の中で、保存されている封筒を読み直してから行う。時間切れ（10 秒）はロックの取得待ちにだけ適用する（`AbortSignal` で取得要求を取り消す）。取得後は時間切れを解除し、送った `set` / `remove` が終わるまでロックを持ち続ける。
   - 作成: ロックの中で封筒がないこと。あれば書かずに `unavailable`（`conflict`）。最初の `revision` は 1、`entries` は空。
   - 書き込み: ロックの中で読んだ封筒が、直前に認証した封筒と全項目で一致すること（`storeId`・`revision`・IV・暗号文を含む）。一致しない（作り直し、同じ `revision` の別の内容、不正な内容、消失を含む）なら書かずに `unavailable`（`conflict`）。書く内容は、操作の開始時に固定した `entries` に変更を加えたもので、`revision + 1`。`set` が失敗したら `unavailable`（`write-failed`）にし、一部だけ書く・内容を削って書くことをしない。
   - 削除: 利用者が確認したときに見ていた封筒（不正な形でもよい）を記録し、ロックの中で保存されている封筒がそれと一致すること。一致しなければ消さずに `unavailable`（`conflict`）にし、確認からやり直させる。既に消えていれば `absent`。
   - `storage.onChanged` で、自分が送った書き込み以外の変更を検出したら `unavailable`（`changed-elsewhere`）にする。
8. **巻き戻しの検出**: 画面は、最後に認証した保存先の `storeId` と `revision` を、施錠と再読み込みをまたいで（画面を閉じるまで）メモリに保持する。保存先が同じで `revision` が小さければ `regressed`、`storeId` が違えば `replaced` とし、利用者の受け入れなしに使わない。
9. **KEEP の判定**: P-0001 の規則（`provider` と `conversationId` の完全一致、`scope` が `null` か主体が一致）を純粋な関数 `isProtected` とし、DEV09 の計画生成と確定直前の確認がこれを使う。
10. **画面**: 左の列の上部に KEEP ストアの欄（状態の説明、作成・解錠・施錠・削除・再読み込み・受け入れ）を置く。KEEP の付け外しはプレビューの専用ボタン（名前は「KEEP」で固定し、`aria-pressed` で状態を示す）で行い、一覧の行に「KEEP」の文字の印を出す。一覧で Enter はプレビューを開くだけのまま（AT33）。件数「KEEP N 件」を下部に示す。`available` 以外では件数も行の印も出さず「KEEP 未確認」と示す（読めない状態を 0 件と見せない。INV-05）。保存データの削除は確認の段階（チェックと別のボタン、初期フォーカスは取り消し側）を挟み、Enter の連打で確定しない。
11. **データの消去**（FR11、AT32）: 削除は保存領域のキーを消し、メモリの鍵・印・巻き戻しの記録を捨てる。拡張を削除すると `storage.local` も消える。OS 上の完全消去までは保証しない。
12. **ビルド成果物の検査**: `scripts/dist-policy.mjs` の権限の許可リストに `storage` を加え、拡張のスクリプトに `storage.sync` の参照があれば失敗にする（AT29 の多層防御）。

### 不変条件（試験で確かめる形）

- KINV-1: KEEP ストアが `available` になるのは、構造の正しい封筒を正しい鍵で復号し、平文の構造と `revision` が一致し、巻き戻し・差し替えの検出に当たらず、開始時から世代が変わっていない場合だけである — 読み取りの失敗、未知の版、不正な平文、鍵の不一致、途中の施錠・他のタブの変更のどれかの後に `available` になれば違反。
- KINV-2: 封筒は `absent` からの明示的な作成で、ロックの中で封筒がないことを確かめた場合にだけ生まれる — 起動時に自動で作る、`locked` / `corrupt` / `unavailable` から作成で上書きする、2 つのタブが同時に作成して両方が書く、のいずれかで違反。
- KINV-3: 書き込みは、ロックの中で読んだ封筒が直前に認証した封筒と全項目で一致したときだけ行い、`revision` をちょうど 1 増やす — 他のタブの書き込み・作り直し・同じ `revision` の差し替えの後に、古い内容で上書きすれば違反（更新の消失）。
- KINV-4: `corrupt` の封筒は利用者の削除以外で書き換えない — `corrupt` から KEEP の書き込み・作成が行われれば違反。
- KINV-5: 保存される平文は `revision` と `entries`（各要素は `provider` / `conversationId` / `scope` だけ）を含む — 復号した平文や見出しにタイトル・本文・日時が入れば違反。
- KINV-6: 鍵は取り出し不可で、施錠・削除・競合・再読み込みで捨てられ、施錠の公開の後に新しい書き込みが送られない。パスフレーズは状態に残らない — 施錠の後に `set` が呼ばれれば違反。
- KINV-7: `isProtected` は P-0001 の判定規則に従う — 異なる `provider`・`conversationId` を保護する、主体付きの KEEP が別の主体を保護する、`scope: null` の KEEP が同じ ID を保護しない、のいずれかで違反。
- KINV-8: アクセス制限が確立するまで、KEEP ストアは保存領域を読み書きせず、対象タブへ Content Script を注入しない — `setAccessLevel` の失敗・欠如の後に読み書きや注入が起これば違反。

失敗の経路: 正常、例外（WebCrypto・storage の例外）、書き込み途中の停止（1 回の `set` のため、封筒は古いか新しいかのどちらか）、時間切れ（ロックの取得待ち）、競合（他のタブ）、途中の施錠・再読み込みについて試験する。

### 限界（受容する）

- AEAD では、パスフレーズの誤りと暗号文の改ざん・破損を区別できない。どちらも `locked` のまま止まる。
- 画面を開き直した後（巻き戻しの記録がない状態）に、古い正しい封筒を書き戻されると検出できない。古い封筒が KEEP の少ない（空を含む）ものであれば、`available` で少ない KEEP として進む。保存領域に書き込める第三者（同じ端末の悪意あるソフト、強い権限の拡張）を想定した防御はしない（BLUEPRINT §9）。
- 保存領域全体の消去は初回と区別できない。自動作成をしないことで、気付かずに空の KEEP で進むことを防ぐ。
- パスフレーズを忘れると KEEP は復元できない。削除して作り直すことだけができる。
- `setAccessLevel` が Content Script の読み取りを実際に拒むことは未確認（変更内容 1。DEV04 で確かめる）。

### 影響範囲

`public/manifest.json`、`scripts/dist-policy.mjs` とその試験、`src/keep/`（新設）、管理画面、BLUEPRINT §4（権限）・§5。

### 互換性

新規。保存データの既存の版はない。将来の版の移行は、旧版を読めること・移行の失敗で KEEP を失ったまま進まないこと（AT14）を条件に、別の Proposal で決める。

### 代替案

- パスフレーズなし（拡張内に鍵を置く）: handoff と BLUEPRINT §5 が求める利用者による解錠と、鍵を暗号文と同じ場所に置かない条件に反する。
- Argon2 等のメモリハードな KDF: 依存が増える（D-0001）。PBKDF2 の反復回数で補う。
- KEEP をメモリだけに持つ: D-0001 で退けた。
- `storage.session`: ブラウザーの終了で消え、KEEP を残せない。
- IndexedDB: 端末内の保存である点は同じで、拡張の削除時の扱いと容量の扱いが `storage.local` の方が明確である。
- `revision` だけの比較: 作り直しや同じ `revision` の差し替えを見逃す（critique の指摘）。

### 受け入れ条件（試験観点）

- 状態の各遷移と、許されない遷移の拒否（KINV-1〜4、6、8）。
- 割り込みの順序: 解錠の途中の他のタブの変更、書き込みの途中の施錠、2 つのタブの同時作成、書き込みの競合、作り直し後の同じ `revision`、同じ `revision` の別の内容、削除の確認後の変更、ロックの取得待ちの時間切れ（取得後に長くかかる `set` の間はロックを放さない）、`set` / `get` / `remove` の失敗、不正な封筒・平文・未知の版・KDF の範囲外（AT13、AT14）、巻き戻しと差し替え。
- 誤ったパスフレーズで `locked` のまま。正しいパスフレーズで `available`。鍵が取り出し不可。書き込みが KDF の指定を保つ。見出しの各項目を変えると認証に失敗する。固定の試験ベクトル。
- 合成の取り込みで KEEP を付けた後に、保存された封筒を復号し、平文が許された項目だけであることを確かめる。タイトル・本文が見出し・平文・ログに現れない（AT28）。
- 削除の後に `absent` になり、保存領域にキーが残らない（AT32）。
- `isProtected` の判定（KINV-7、P-0001 の受け入れ条件）。
- ビルド成果物の検査が `storage` を許し、`storage.sync` の参照を拒否する（AT29）。
- 実ブラウザーでの操作、`setAccessLevel` の効果、Chrome 同期を有効にしたプロファイルでの確認は DEV04 の統合試験に回し、合格扱いにしない。

追加する条件（パスフレーズの長さ、KDF の範囲、ロックの取得の時間切れ、巻き戻しの検出）は入力の検証と停止の条件であり、change-gate の 6 つの目的（省く・短くする・再利用する・選ぶ・許す・条件付きで有効にする）に当たらない。

## P-0008: Chrome 統合試験（Playwright）の導入

状態: 提案（2026-11-01）

Gate-category: none

### 目的

P-0004〜P-0007 は、実ブラウザーでしか確かめられない主張を DEV04 の統合試験に回し、合格扱いにしなかった（`setAccessLevel` の効果、`connect-src 'none'` の下での無通信、複数タブ、実キー操作、ビルド成果物が実際に読み込めること）。この Proposal は、それらを自動で確かめる Chrome 統合試験を追加する。実画面での所有者の確認の代わりにはしない（CLAUDE.md の安全ルール）。

### 変更内容

1. `@playwright/test` を devDependency に追加し、版を固定する（P-0002 の方針: 完全一致の固定、公開から 2 週間以上、ロックファイル）。**1.64.0**（2026-10-07 公開）とする。同梱の `playwright-core/browsers.json` が要求する Chromium のリビジョンは 1248 で、開発機に導入済みのブラウザーと一致する。サンドボックス内ではブラウザーをダウンロードできないため、この一致を版の選択理由とする。
2. `playwright.config.ts` と `tests/e2e/` を追加する。`pnpm test:e2e` は `pnpm build` の後にヘッドレス（新ヘッドレス、`channel: "chromium"`）で拡張を読み込んで実行する。拡張は `launchPersistentContext` に `--disable-extensions-except` と `--load-extension` を渡して読み込み、拡張 ID はサービスワーカーの URL から得る。試験ごとに空のプロファイルを使う。
3. 試験の範囲（各項目は名前付きの試験）:
   - 管理画面 `app.html` がコンソールエラーなしで開き、`chrome-extension://` 以外へ要求を出さない（INV-01）。
   - KEEP ストアの作成・再読み込みでロック・誤ったパスフレーズ・解除、`storage.sync` が空であること（AT29）、`storage.local` の値に合成の取り込みのタイトル・本文が含まれないこと（AT28）。
   - `setAccessLevel` の効果: 出荷物を変えず、`dist/` の一時コピーに試験専用の Content Script と `tabs` 権限を足し、Content Script（ISOLATED world）から `chrome.storage.local` が読めないことを確かめる。管理画面を開かないプロファイルを対照とし、同じ試験用スクリプトが読めることを示す（試験の取りこぼしを避ける）。
   - 合成の ChatGPT エクスポート ZIP の取り込みから一覧まで（`src/import/testing/` の組み立てを読み取り専用で利用）、敵対的な文字列が文字として表示され実行されないこと（AT09）。
   - キー操作（AT33 の一部）: 一覧の矢印・Home・End、Enter でプレビュー、Esc で一覧へ戻る、削除確認での Enter の連打で保存先が消えないこと。
   - KEEP の付け外しと印・件数。
   - 複数タブ: 一方の変更で他方が「利用不可」になること（P-0007）。
   - 接続の入口（P-0004、AT17 / AT31 の一部）: 対象のタブがない場合、対応ページでない場合に何も注入されないこと。
4. CI に `e2e` ジョブを別に追加する。`pnpm exec playwright install --with-deps chromium` でブラウザーを導入し、ビルドしてからヘッドレスで実行する。失敗時だけ `actions/upload-artifact`（v4.6.2、コミット SHA で固定）でレポートを残す。既存のジョブは変えない。
5. 失敗時のレポートは `playwright-report/` と `test-results/`（`.gitignore` 済み）。合成データだけを使う。

### 影響範囲

`package.json`、`pnpm-lock.yaml`、`playwright.config.ts`、`tests/e2e/`、`.github/workflows/ci.yml`、`tsconfig.json`（試験の型検査）、`biome.json`（試験の検査）。`src/`・`public/`・出荷物は変えない。

### 互換性

出荷物に影響しない（devDependency と試験のみ）。CI に実行時間とブラウザーの導入が加わる。

### 代替案

- Puppeteer: 拡張の読み込みは可能だが、導入済みのブラウザー、ロックファイル運用、試験ランナーが `@playwright/test` の方が揃っている。依存も 1 つで済む。
- Vitest のブラウザーモード: 拡張のコンテキスト（`chrome.*`、サービスワーカー、Content Script の world）を作れない。
- 試験を追加しない（手動確認のみ）: P-0007 などが未確認と記録した主張が、変更のたびに回帰しても気付けない。

### できないこと（正直な範囲）

- ヘッドレス Chromium では、実際のスクリーンリーダーの読み上げは確かめられない。確かめるのは DOM の `aria-*`、フォーカス位置、キー操作の結果までで、AT33 のスクリーンリーダー部分は未実施のまま残る。
- 拡張のアイコンのクリック（`activeTab` の付与）は自動化できない。`activeTab` を付与された状態での注入は、`tabs` 権限を足した一時コピーで URL の判定までを確かめるにとどまり、本物の `activeTab` の経路ではない。対象サイト（chatgpt.com、claude.ai）の実画面は使わない。
- Chrome 同期を有効にしたプロファイルでの `storage.sync` の確認は、同期のないテスト用プロファイルでは確かめられない（`storage.sync` に何も書かれていないことのみ確認する）。
- 実行できなかった試験は、合格とせず、理由を付けて「未実施」（スキップ）と報告する。モックによる代替で実画面の試験を済ませたとは書かない。
- 条件付きのスキップ・選択は設けない（Firing rate の対象となる条件を追加しない）。

### 受け入れ条件（試験観点）

- `pnpm test:e2e` が空のプロファイルから、ビルド済みの拡張を読み込んで通る。
- 上記の範囲の各項目が名前付きの試験として存在し、実行できないものは理由付きのスキップとして残る。
- 対照の試験（アクセス制限なし）で試験用スクリプトが読めること。それが読めない場合は `setAccessLevel` の試験を合格としない。
- 既存の `pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`・`pnpm check:dist` が通る。
- CI の `e2e` ジョブが緑になる（初回の CI 実行は PR で確認する）。

## D-0004: ログイン中のセッションを使う部分の分担と並行の進め方（2026-11-01）

状態: 決定（D-0003 の「削除を確定する最後の段階は扱いを後で決める」を決める）

- 所有者の決定（2026-11-01）: ログイン中の ChatGPT のセッションを使う部分、すなわち Web 画面からの一覧取得（DEV06）と削除の実行（DEV11 のうちサービスへ要求を送る部分）は、所有者が実装して用意する。Claude は、それらを差し込む枠組み（Adapter の契約、計画、承認、逐次実行、停止、結果の分類。P-0009）と、DEV03 の実画面検証の手順書を作る。認証情報やエンドポイントを扱うコードは Claude が書かない。
- この決定の帰結: Claude が書くコード（枠組み、試験、合成 Adapter）には、INV-17 のテンプレート、`/api/auth/session`、サービスのエンドポイントのパス、実サービスの ID・応答・証拠の形を含めない。合成 Adapter の ID・応答・証拠は、すべて試験のために作った架空のものとする。
- 並行の進め方: レーン A（P-0008、Playwright による Chrome 上の統合試験）とレーン B（P-0009、削除側の枠組み）を並行して進める。それぞれ lizy-reviewer の APPROVE かつ CI が緑でマージする（D-0001）。
- 所有者の手作業（実エクスポートでの確認、拡張の通し操作、DEV03 の確認）は、依頼中のエクスポートが届いた時点で 1 回の作業にまとめる。

## P-0009: 削除側の枠組み — 一覧の固定、削除計画、一回限りの承認、逐次実行（DEV09 の中核）

状態: 提案（2026-11-01）

Gate-category: state-machine, concurrency-ownership, shared-state-invariant

### 目的

D-0004 により、ログイン中のセッションを使う Read / Delete の実装は所有者が用意する。本 Proposal は、それを差し込む側の枠組みを決める。対象は、Adapter の契約（P-0001 の分割と P-0003 の `reconcileOne` の具体化）、一覧の固定（BLUEPRINT §5「内部 API による一覧取得」）、削除計画と承認（§6）、1 件ごとの手順と KEEP の順序（§7）、結果の分類と停止（§7「結果の判定」、INV-19）である。実サービスの Adapter がない間は、合成 Adapter（故障の注入つき）だけで試験する。

現状の事実（DC6 として明記する）: 取り込める会話は公式エクスポート由来だけで、その主体は常に未検証である（P-0005）。このため、所有者の ReadAdapter ができるまで、実データの計画は対象 0 件になり `ready` に進まない。枠組みが動くのは合成 Adapter の試験の中だけである。

### 変更内容

#### 1. Adapter の契約（Controller 側）

契約は管理画面の Controller 側のモジュール境界として定める。所有者の実装は、この契約の各メソッドの中で Content Script へ 1 回分の指示を送る（P-0004 の `sendToTab`）。合成 Adapter は同じ契約をプロセス内で実装する。型は安全境界ではないため、Adapter が返すものはすべて未信頼の入力として実行時に検証する（INV-16、§9）。

```ts
type GateStatus = "unreviewed" | "allowed" | "blocked" | "ownerAcceptedRisk" | "notApplicable";

interface FeatureGate {
  readonly technical: GateStatus;
  readonly termsAndPermission: GateStatus; // ownerAcceptedRisk はここだけ
  readonly storePolicy: GateStatus;        // notApplicable はここだけ
  readonly safety: GateStatus;
  readonly evidenceRefs: readonly string[];
  readonly reviewedAt: ISODateTime | null;
}

type BuildKind = "distribution" | "personal";

/** 各メソッドの呼び出しごとに枠組みが発行する。Adapter は execId を結果にそのまま返す。 */
interface CallContext {
  readonly execId: string;      // UUID v4、呼び出しごとに新しい値
  readonly expiresAt: number;   // epoch ms
  readonly signal: AbortSignal;
}

type SubjectEvidence =
  | {
      readonly status: "verified";
      readonly accountKey: string;
      readonly workspaceKey: string;
      readonly workspaceKind: "personal" | "organization" | "unknown";
      readonly evidenceRef: string;
    }
  | { readonly status: "unverified"; readonly reason: "not-observed" | "ambiguous" };

/** 書き込みの結果を確かめられない事象（INV-19）の閉じた分類。 */
type Anomaly =
  | { readonly code: "rate-limited"; readonly retryAfterSeconds: number | null }
  | {
      readonly code:
        | "server-error" | "timeout" | "network" | "unexpected-status" | "unexpected-schema"
        | "redirect" | "auth-changed" | "tab-lost" | "permission-lost";
    };

type Outcome<T> =
  | { readonly execId: string; readonly ok: true; readonly value: T }
  | { readonly execId: string; readonly ok: false; readonly anomaly: Anomaly };

interface InventoryRecord {
  readonly conversationId: string;   // isCanonicalId で検証
  readonly kind: string;             // descriptor.listedKinds のどれか
  readonly title: string | null;     // メモリのみ（INV-03）
  readonly createdAt: ISODateTime | null;
  readonly updatedAt: ISODateTime | null;
  readonly archived: boolean | null;
  readonly activity: "idle" | "running" | "unknown";
  readonly stateToken: string | null; // Adapter が定める更新状態の不透明な値
}

interface InventoryPage {
  readonly records: readonly unknown[]; // 1 件ずつ検証する。不正なものは列挙する
  readonly next: { readonly kind: "cursor"; readonly cursor: string } | { readonly kind: "end" };
  readonly reportedTotal: number | null;
}

type EvidenceKind = "item-read-deleted" | "item-read-not-found" | "list-absent";

interface AdapterDescriptor {
  readonly provider: "chatgpt" | "claude-code";
  readonly adapterId: string;
  readonly version: string;
  readonly listedKinds: readonly string[];         // 一覧に含まれる会話の種類
  readonly excludedKinds: readonly string[];       // 網羅を確認していない種類（範囲外として表示）
  readonly listing:
    | { readonly stableSnapshot: true; readonly evidenceRef: string; readonly order: "updatedAt-desc" | "none" }
    | { readonly stableSnapshot: false; readonly order: "updatedAt-desc" | "none" };
  readonly fingerprintFields: readonly ("title" | "updatedAt" | "archived" | "stateToken")[];
  readonly timeFields: { readonly createdAt: boolean; readonly updatedAt: boolean }; // 意味・単位を DEV03 で確かめたか
  readonly verificationRule: readonly EvidenceKind[]; // verified に要る証拠の組み合わせ
  readonly minIntervalMs: number;                     // 要求の間隔
}

interface ReadAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly gate: FeatureGate; // read の能力
  inspectScope(ctx: CallContext): Promise<unknown>;                       // Outcome<SubjectEvidence>
  listPage(ctx: CallContext, cursor: string | null): Promise<unknown>;    // Outcome<InventoryPage>
}

/** 削除指示に結び付く一回限りの札。枠組みが発行し、発行した時点で使用済みにする。 */
interface ItemTicket {
  readonly execId: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly subject: { readonly accountKey: string; readonly workspaceKey: string };
  readonly conversationId: string;
  readonly operation: "preflight" | "commit" | "reconcile";
  readonly probe: EvidenceKind | null; // reconcile のときだけ
  readonly expiresAt: number;
}

interface PreflightValue {
  readonly subject: SubjectEvidence;
  readonly item: { readonly kind: "present"; readonly record: unknown } | { readonly kind: "absent" };
}

interface DeleteAdapter {
  readonly descriptor: AdapterDescriptor; // ReadAdapter と同じ値でなければ開始しない
  readonly gate: FeatureGate;             // automaticDelete の能力
  preflight(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>;  // Outcome<PreflightValue>
  commitOne(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>;  // Outcome<{ accepted: true }>
  reconcileOne(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>; // Outcome<{ probe: EvidenceKind; satisfied: boolean }>
}
```

- **戻り値の検証**: すべての戻り値を `src/shared/messages.ts` と同じ方式（キーの完全一致、プレーンオブジェクト、閉じた列挙）で検証する。`execId` は呼び出しに渡した値と一致しなければならない。ID は `isCanonicalId`、日時は ISO 8601 の UTC（`Z` 終わり）で 2015-01-01 から 2100-01-01、`title` は 2,000 文字以下の文字列、`stateToken`・`cursor`・`evidenceRef` は 256 文字以下の印字可能な ASCII、`retryAfterSeconds` は 0 以上 86,400 以下の整数または `null`。Adapter の例外、期限（1 回の呼び出しにつき 30 秒、暫定）の超過、検証に通らない値、`execId` の不一致は、その呼び出しの異常（`timeout` または `unexpected-schema` と同じ扱い）とする。黙って読み飛ばさない。
- **descriptor の検証**: 開始前に一度だけ検証する。`fingerprintFields` は `updatedAt` か `stateToken` を含む（更新を検出できない Adapter は自動削除を無効にする。§7）。`verificationRule` は異なる 2 種類以上を含む（INV-10）。`minIntervalMs` は枠組みの下限 1,000 ミリ秒（暫定。値は DEV03 で決める。§12）以上 60,000 以下。どれかに反すれば Read と Delete を無効にする。
- **gate**: `capabilityEnabled(gate, buildKind)` を純粋な関数とする。配布版は 4 判定がすべて `allowed` の場合だけ有効。個人用ビルドは、technical と safety が `allowed`、termsAndPermission が `allowed` か `ownerAcceptedRisk`（このとき `evidenceRefs` が `HISTORY.md#P-0003` を含む）、storePolicy が `allowed` か `notApplicable` の場合だけ有効（§10）。`ownerAcceptedRisk` を他の判定に、`notApplicable` を storePolicy 以外に置いた gate は不正として無効にする。ビルドの種類は枠組みの引数で受け取る。個人用ビルドを作る切り替え（Vite の定義と、配布版に DeleteAdapter が含まれないことのビルド成果物の検査）は所有者の Adapter を組み込む Proposal で決める。それまで実際のビルドは常に `distribution` で、所有者の Adapter は有効にならない。
- **所有者の実装が保証すること**（枠組みでは確かめられず、DEV03 とレビューで確かめる）: 各メソッドは要求を高々 1 回だけ送る（枠組みが要求の間隔を呼び出し単位で守れるようにするため）。要求は INV-17 の固定テンプレートだけで、`preflight` と `reconcileOne` は読み取り用テンプレートだけを使い、書き込み用テンプレートを使うのは `commitOne` だけ。`ItemTicket` の主体と対象 ID を要求に入れ、他の ID を指さない。`accepted: true` は書き込み要求に想定どおりの応答があった場合だけ返し、それ以外はすべて `Anomaly` で返す。`satisfied: true` は、その probe が定める削除の証拠を観測した場合だけ返す。`InventoryRecord` の各項目の意味（特に `stateToken`、日時、`activity`）を Adapter の版と共に固定する。アクセストークンは INV-02 の範囲を出さない。

#### 2. 一覧の固定（`inventory`）

- 一覧の取得は `inspectScope` → `listPage` の繰り返しで、Controller がループを持つ（Content Script はループを持たない。INV-18）。取得中は削除しない。
- 結果は不変のスナップショット `InventorySnapshot { snapshotId, source, provider, adapter: {adapterId, version}, importVersion, subject, records, invalid, completeness, anomalies, capturedAt }` とする。`snapshotId` は UUID v4 で、取得のたびに新しい。`source` は `"web-api"` か `"official-export"` である。`web-api` では `adapter` は ReadAdapter の descriptor の値、`importVersion` は `null`。公式エクスポートの取り込み結果（P-0005）も同じ形に写し、`adapter` は `{ adapterId: "chatgpt-official-export", version: <ExportImporter.version> }`、`importVersion` は取り込みの版番号、`subject` は常に未検証とする。
- Controller が持つスナップショットは 1 つだけで、新しいスナップショット（どちらの由来でも）を作るとそれに置き換わる。`running` の間は新しいスナップショットを作らない。公式エクスポートの再取り込みは、現在のスナップショットが公式エクスポート由来の場合だけ置き換え（承認の無効化）に当たる。Web 由来のスナップショットの計画は、取り込みの状態とは独立である。
- 完全性は Domain が決める（Adapter の自己申告を使わない）。`complete` は、`listing.stableSnapshot` が `true` で、走査に次の異常が 1 つもない場合だけ。異常: 重複した ID、検証に通らないレコード、同じ `cursor` の再出現、`order: "updatedAt-desc"` の場合の並びの逆転（ページ境界を含む）、`reportedTotal` がページ間で変わる・件数と矛盾する終端、上限（ページ 10,000、レコード 100,000）への到達。異常があれば `partial`、契約がなく異常もなければ `unknown`。重複した ID は両方とも計画の候補にしない。
- 取得中の `Anomaly`（429 等）は取得を止め、スナップショットを作らない（`failed`）。`Retry-After` は表示だけ。
- 主体は `inspectScope` の `verified` だけを使い、取得の最初と最後の 2 回確かめて一致しなければ `failed`（取得中の主体の切り替え）。

#### 3. 削除計画（`draft` → `ready`）

- 選択は明示的な ID の集合だけを受け取る（`{ snapshotId, ids }`）。検索・日時・種類の絞り込みは画面側（P-0006）で行い、その結果の ID を渡す。計画の生成は条件を再評価しない（INV-04）。計画のエンジンは ID だけを受け取るため、日時の条件を `timeFields` が `true` のフィールドだけに許し、日時不明の会話を日時の条件で選ばないこと（§5）は強制できない。これは画面の責任とし、後の画面の Proposal で決める（それまでの試験の範囲外）。
- 各 ID は次の順に判定し、最初に当たった理由で除外して理由ごとの件数を記録する。`not-in-inventory`（スナップショットにない、または不正なレコード）、`duplicate`、`subject-unverified`（スナップショットの主体が `verified` でない。公式エクスポートは常にここ。INV-06）、`workspace-not-personal`（D-0002）、`active-or-unknown`（`activity` が `idle` でない。AT20）、`state-unknown`（`fingerprintFields` のどれかが `null`。AT19）、`keep-protected`（`isProtected(entries, { provider, conversationId, scope: subject })`。AT11）。
- KEEP が `available` でなければ計画を作らない（`keep-unavailable`。INV-05、AT13）。`subject-unverified` の判定は KEEP より前に置くが、KEEP の確認自体は省かない。
- 対象が 0 件なら計画を作らず `draft` のまま理由ごとの件数を示す。
- 計画 `DeletePlan`:
  ```ts
  type ExclusionReason =
    | "not-in-inventory" | "duplicate" | "subject-unverified" | "workspace-not-personal"
    | "active-or-unknown" | "state-unknown" | "keep-protected";
  interface DeletePlan {
    readonly schemaVersion: 1;
    readonly planId: string;            // UUID v4
    readonly parentPlanId: string | null; // 続きの計画（後述）のとき元の planId
    readonly createdAt: number;
    readonly approvableUntil: number;   // createdAt + 15 分
    readonly provider: "chatgpt" | "claude-code";
    readonly subject: { readonly accountKey: string; readonly workspaceKey: string };
    readonly adapter: { readonly adapterId: string; readonly version: string };
    readonly snapshot: { readonly snapshotId: string; readonly completeness: "complete" | "partial" | "unknown"; readonly capturedAt: number };
    readonly keep: { readonly storeId: string; readonly revision: number };
    readonly targets: readonly { readonly conversationId: string; readonly fingerprint: string }[]; // conversationId の昇順
    readonly excluded: Readonly<Record<ExclusionReason, number>>;
    readonly planDigest: string;
  }
  ```
  `fingerprint` は `fingerprintFields` の値を正準 JSON（キーの昇順、空白なし）にした UTF-8 の SHA-256（16 進）。`planDigest` は `planDigest` 以外の全項目の正準 JSON の SHA-256。WebCrypto の `subtle.digest` を使い、依存を加えない。計画は凍結し、変更は新しい計画を作ることだけで行う。
- `completeness` が `complete` でない計画では、「条件に合う会話をすべて削除」「KEEP 以外をすべて削除」と表示しない（INV-14）。表示は「取得した N 件のうち M 件」とする。

#### 4. 承認（`ready` → `approved`）

- `approve(planId, planDigest)` は、計画が現在の計画で、digest が一致し、`approvableUntil` 前で、KEEP が `available` で `storeId` が計画と同じで、Delete の gate が有効な場合だけ、`Approval { approvalId, planId, planDigest, issuedAt, expiresAt }` を発行する。`approvalId` は UUID v4、`expiresAt` は発行から 60 分（暫定）。承認は Controller のメモリにだけ置き、保存しない（§5、INV-08）。
- 一回限り: `start(approvalId)` が受け付けた時点で使用済みにする。同じ承認の 2 回目、別の計画の承認、期限切れは拒否する（AT21）。使用済みは「もう一度 `start` に使えない」ことを意味し、その承認は消費した実行を、期限切れか無効化の事象まで引き続き支配する（第 7 節の「承認が有効」はこの意味である）。
- 承認を無効にする事象: 新しい計画・新しいスナップショット・計画の破棄、スナップショットの置き換え（公式エクスポート由来のスナップショットでは再取り込みによる版番号の変化。BLUEPRINT §5、AT07）、Adapter の版の変化、主体の不一致、KEEP の状態が `available` でなくなること・`storeId` の変化・KeepStore の世代の変化（施錠、再読み込み、他のタブの変更、競合）、停止、管理画面の破棄、期限切れ。KEEP の `revision` の変化（通常の付け外し）は承認を無効にせず、各件の確定直前の再確認で扱う（§7、AT12）。
- 2 つの期限の関係: `approvableUntil`（15 分）は承認を発行できる期間で、選別時の状態の古さを抑える。`expiresAt`（60 分）は実行してよい期間で、各件の確定の前に確かめ、過ぎていれば `paused` にする。各件の状態の古さは直前の preflight の fingerprint 照合で別に確かめる。

#### 5. 実行の状態遷移

状態: `idle`、`inventory`、`draft`、`ready`、`approved`、`running`、`completed`、`paused`、`failed`、`uncertain`（§6 に `idle` を加える）。

| 遷移 | 条件 |
| --- | --- |
| `idle` → `draft` | 公式エクスポートの取り込み結果から、`canPlanDeletionFrom` が真の場合だけスナップショットを作った（P-0001。主体が未検証のため計画の対象は常に 0 件） |
| `idle` → `inventory` | Read の gate が有効、descriptor が正しい、KEEP の状態を問わない |
| `inventory` → `draft` | 取得が終わりスナップショットを固定した（`complete` / `partial` / `unknown` のどれでも） |
| `inventory` → `failed` | 取得中の `Anomaly`、主体の未検証・切り替え、Adapter の不正な値 |
| `inventory` → `idle` | 利用者の中止（送った要求は取り消さない） |
| `draft` → `ready` | 対象 1 件以上の計画を作った |
| `ready` → `approved` | 前節の承認の条件 |
| `ready` / `approved` → `draft` | 計画の破棄、`approvableUntil` の経過（`ready`）、承認の期限切れ・無効化（`approved`） |
| `approved` → `running` | `start(approvalId)` が承認を消費し、実行ロック（後述）を取得した |
| `running` → `completed` | 全対象が処理済みで、`uncertain` の件がない（`skipped` はあってよい） |
| `running` → `paused` | 利用者の停止、承認の期限切れ。どちらも次の件の最初の呼び出しの前に判定する |
| `running` → `failed` | KEEP の状態・世代・`storeId` の変化、gate の無効化、実行ロックの喪失、スナップショットの置き換え（いずれも書き込みの結果が不明な件はない） |
| `running` → `uncertain` | 1 件でも `uncertain` が生じた（INV-19） |
| `paused` / `uncertain` → `ready` | 続きの計画（後述）を作った |
| `draft` / `ready` / `approved` / `completed` / `paused` / `failed` / `uncertain` → `idle` | 破棄 |

- 許されない遷移はすべて拒否し、状態を変えない。例: `draft` → `running`、`ready` → `running`（承認なし）、同じ計画への 2 回目の `approve` で前の承認を残すこと（新しい承認を発行したら前の承認は無効）、`paused` → `running`（新しい承認なし）、使用済み・期限切れの承認での `start`、別のタブが実行ロックを持つ間の `start`、`running` 中の新しい一覧の取得・計画の作成。
- **続きの計画**: `paused` / `uncertain` から再開するときは、まず `uncertain` の各件に照合（`reconcileOne`）を利用者の操作で発行し（承認の期限切れ・停止の後も発行できる。§4）、`verified` になった件は確定済みにする。続きの計画は、元の計画の対象から処理済み（`verified` / `skipped` / `failed`）と、照合後も `uncertain` の件を除いた部分集合で、新しい `planId`・digest・`approvableUntil` を持ち、`parentPlanId` に元の計画を記録する。元のスナップショットと KEEP の現在の状態で第 3 節の判定をやり直し、対象を増やさない（INV-04）。新しい承認が要る。照合後も `uncertain` の件は手動確認へ案内し、続きの計画にも自動では入れない（INV-07）。
- **永続化しない**: 計画・承認・結果はメモリだけに置く。管理画面を閉じれば失われ、次に開いた画面は承認も `uncertain` の一覧も持たない（INV-08、AT24）。§4 の「再起動した Controller が再照合として照合を発行してもよい」は、照合する対象を覚えていないため本 Proposal では使わない。新しい一覧の取得からやり直す。

#### 6. 排他（INV-09、AT22）

`running` の間、Web Locks の `lizychattidy-run:<provider>` を `ifAvailable: true` で取得して持ち続ける。取得できなければ `start` を拒否する（`concurrent-run`）。主体ごとではなくサービスごとにするのは、同じブラウザーのプロファイルでは同じサービスのログイン中のセッションを共有するため、主体の証拠の正しさに排他を依存させないためである（より広い排他）。Web Locks がなければ開始しない。ロックは管理画面を閉じると解放される（INV-08 と一致）。KEEP の `lizychattidy-keep` とは別の名前で、実行ロックを持ったまま KEEP のロックを待つ順序だけを許す（逆順で取得しないことでデッドロックを避ける）。

#### 7. 1 件ごとの手順と KEEP の順序

各対象について、次を順に行う。各 Adapter の呼び出しの前に、前の呼び出しの開始から `minIntervalMs` 以上空ける（一覧取得・照合を含む。INV-19）。

1. 停止・承認の期限・実行ロックを確かめる。当たれば、この件に何も送らず `paused`（停止・期限）または `failed`（ロック）にする。
2. `preflight`（`ItemTicket` の operation は `preflight`）。主体を `accountKey` と `workspaceKey` の完全一致で計画と比べる（表示名は使わない。AT16）。不一致は承認を無効にし、この件を `uncertain`（`subject-changed`）にして `uncertain` へ（INV-19 の「主体の変化」）。`Anomaly` も同じく `uncertain`。`absent` は `skipped`（`absent-before-commit`）として次へ。`present` のレコードを第 1 節の規則で検証し、ID が対象と一致しなければ `uncertain`。`activity` が `idle` でなければ `skipped`（`active-or-unknown`）、fingerprint が計画と違えば `skipped`（`state-changed`）として次へ（AT19。§7 の 4「保留」）。
3. **KEEP の順序付きの区間**: KeepStore に新しい公開メソッド `withOrderedSnapshot(fn)` を加える。これは KeepStore 自身の直列キュー（`setKeep` と同じ `serial()`）の中で、Web Lock `lizychattidy-keep` を取り、保存されている封筒を読み直して直前に認証した封筒と全項目で一致することと、世代が変わっていないことを確かめてから、`{ entries, revision, storeId, generation }`（`available` でなければその状態）を同期の関数 `fn` に渡す。封筒が一致しなければ `setKeep` と同じく KeepStore を `unavailable`（`conflict`）にし、`fn` には `available` でない状態を渡す。ロックの取得の時間切れでは KeepStore の状態を変えず、`fn` に `lock-timeout` を渡す。`fn` は `await` せずに値を返し、`withOrderedSnapshot` は `fn` が返った時点でロックとキューの順番を放す。枠組みは `fn` の中で、KEEP が `available` で `storeId`・世代が計画の時点と同じであること、`isProtected` が偽であること、停止されていないこと、承認が有効であることを確かめ、すべて満たせば `commitOne` を呼んでその Promise を受け取る（これを「送出」とする）。応答は区間の外で待つ。
   - KEEP が `available` でない、または `storeId`・世代が違えば、この件を `failed`（`keep-unavailable`、何も送っていない）にして `failed` へ（INV-05、AT13）。
   - `isProtected` が真なら `skipped`（`keep-protected`）として次へ（AT12）。
   - 区間の中ではほかの KEEP の書き込みが走らないため、最終の KEEP 読み取りと送出の間に、同じタブの書き込みも（ロックにより）他のタブの書き込みも入らない。§7 の「最終の KEEP 読み取りで得た revision が送出の時点でも最新」は、区間の構造で満たす。送出の後に付けた KEEP は、その件の削除を取り消せない（画面での表示は UI の Proposal で行う。AT12 の後半）。
   - **§7 の文言との関係**: §7 は「KEEP の追加・解除は UI から直接ストアへ書かず、すべて Controller を経由する」とするが、DEV08 は画面から `KeepStore.setKeep` を直接呼ぶ。本 Proposal は、KeepStore の直列キューを §7 の「1 本の順序付きキュー」とし、すべての KEEP の書き込みと送出をそこで順序付ける。画面の呼び出し経路は変えない。実装 PR で §7 の文言を「KEEP の書き込みと確定の送出は、KeepStore の 1 本の直列キューで順序付ける」に改める。
4. `commitOne` の結果: `accepted: true` なら照合へ進む。それ以外（`Anomaly`、期限超過、例外、不正な値）はこの件を `uncertain` にして `uncertain` へ。自動で再送しない（INV-07、AT25）。`rate-limited` の `retryAfterSeconds` は「手動で再開してよい最も早い時刻」として表示するだけ。
5. 照合: `verificationRule` の各 probe について `reconcileOne`（読み取り用、1 probe につき 1 回）を発行する。すべてが `satisfied: true` なら `verified`。1 つでも `false`、`Anomaly`、不正な値なら `uncertain` にして `uncertain` へ（AT26: 非表示・アクセス失敗を成功にしない）。
6. 停止が押されたとき: 送出前なら以降の件に何も送らない。送出済みの件は応答を待ち、その件の照合までは行う（読み取りだけ）。その後 `paused`（または `uncertain`）にする（AT23）。

`commitOne` は、1 つの計画系列（元の計画と続きの計画）の中で同じ対象に高々 1 回だけ呼ぶ。`ItemTicket` は発行した時点で使用済みとして記録し、同じ `execId` を 2 回発行しない。

#### 8. 結果の分類

| 分類 | 意味 | 実行への影響 |
| --- | --- | --- |
| `verified` | 書き込みの応答が `accepted` で、`verificationRule` の照合をすべて満たした | 続ける |
| `skipped` | 安全の規則で除外した（`keep-protected`、`state-changed`、`active-or-unknown`、`absent-before-commit`）。何も書いていない | 続ける |
| `failed` | 前提が失われて処理できなかった（`keep-unavailable`、`gate-disabled`、`lock-lost`、`approval-invalid`）。何も書いていない | `failed` で止める |
| `uncertain` | 書き込みの結果を確かめられない、または INV-19 の事象が起きた（`subject-changed` と各 `Anomaly`、Adapter の不正な値を含む） | `uncertain` で止める |
| （未処理） | 停止・期限・止まった後で、何も送っていない | 続きの計画の候補 |

結果はメモリだけに置き、件数と理由のコードだけを画面に出す。診断は理由のコードと版だけとし、ID・タイトルを出さない（INV-03）。

#### 9. 範囲

- 含めるもの: `src/plan/`（契約の型、戻り値の検証、gate、一覧の組み立てと完全性、計画の生成、fingerprint と digest）、`src/run/`（承認、状態遷移、1 件ごとの手順、実行ロック、要求の間隔）、`src/keep/keepStore.ts` への `withOrderedSnapshot` と、計画に記録する `storeId`・世代の読み取りの追加、試験専用の合成 Adapter（`src/plan/testing/`）。
- 合成 Adapter は試験のための架空の ID・レコード・証拠だけを使い、呼び出しごとの結果を台本で与えて故障を注入する: 例外、遅延と期限超過、`execId` の不一致、余分なキー、主体の切り替え、fingerprint の変化、`activity` の変化、429（`Retry-After` つき）、5xx、リダイレクト、照合の不成立（非表示に相当）、一覧の異常（短い終端、重複、並びの逆転、`cursor` の再出現、不正なレコード）、スナップショット後に現れる会話（AT15）。呼び出しの記録（種類・順序・時刻）を試験で検査する。
- 含めないもの: 実サービスの Adapter、ネットワーク、認証情報、エンドポイント（D-0004）。Content Script と拡張内メッセージの変更（読み取り指示・削除指示の形と Content Script での検証は、所有者の Adapter を組み込む前に別の Proposal で決める）。個人用ビルドの切り替え。
- **画面は作らない（後の Proposal に回す）**: §8 の削除予定画面・処理中・結果画面には、主体、件数、KEEP 除外件数、未確認の対象、取得時刻、更新検知の限界、取り消し不可、送出後の KEEP の限界（AT12）、Enter の連打で承認と実行が連鎖しないこと（AT33）など、画面固有の約束が多く、それ自体を独立に見直す価値がある。`app.html` に置いても、実データでは対象が 0 件で動かない画面になる（DC4）。開発用ページでの合成の通し操作も、画面の Proposal と一緒に作る（同じ画面を二度レビューしないため）。本 Proposal の枠組みはどのエントリーからも import しないため、拡張のビルド成果物には含まれない。
- 所有者の Adapter に残るもの: `ReadAdapter` と `DeleteAdapter` の実装、INV-17 のテンプレート、INV-02 の範囲のトークンの扱い、`descriptor` の各値（`stableSnapshot` の根拠、`fingerprintFields`、`timeFields`、`verificationRule`、`minIntervalMs`）、gate の判定の記録。
- DEV03 に残るもの（Claude が手順書を書き、所有者が使い捨て会話で実施する）: 一覧の走査の安定性、`stateToken` と日時の意味、`activity` の意味、主体の確認方法、`verificationRule` の各 probe が公式 UI での削除後の状態と一致すること（§10「検証」の 1・2・6）、要求の間隔の値、activeTab の付与の持続範囲。

### 不変条件（試験で確かめる形）

- PINV-1: 計画の対象は、固定したスナップショットの正しいレコードの ID と選択の ID の共通部分の部分集合で、計画の後は増えない — スナップショットの後に一覧へ現れた会話、選択にない ID、続きの計画で元の計画にない ID が `commitOne` に渡れば違反（AT15、INV-04）。
- PINV-2: 計画の各対象は、計画の時点で、主体が `verified` かつ個人ワークスペースで計画の主体と一致し、`activity` が `idle`、fingerprint が `null` でなく、`available` の KEEP で保護されていない — 公式エクスポート由来、主体が未検証、KEEP が `available` でない時点で作った計画に対象が入れば違反（INV-05、INV-06、AT11、AT13）。
- PINV-3: `commitOne` は KEEP の順序付きの区間の中でだけ呼ばれ、そのとき KEEP は `available`、`storeId` と世代は計画と同じ、保存されている封筒は直前に認証したものと一致し、`isProtected` は偽である — 区間の外での呼び出し、区間の待ち中に入った KEEP の書き込みの後に古い KEEP で送出すること、他のタブの KEEP の書き込みとの交差のどれかが起これば違反（AT12、§7）。
- PINV-4: `commitOne` は、有効で未使用でない承認のもとで、1 つの計画系列の同じ対象に高々 1 回だけ呼ばれ、停止・期限切れ・承認の無効化・破棄の後には呼ばれない — 同じ対象への 2 回目の呼び出し、`uncertain` の件の自動の再送、停止の後の送出のどれかで違反（INV-07、AT21、AT23、AT25）。
- PINV-5: 承認は 1 つの `planId` と `planDigest` に結び付き、一度だけ消費され、第 4 節の事象のどれかの後に `start` を通らない — 2 回目の `start`、別の digest の計画での `start`、主体の不一致・スナップショットの置き換え・KEEP の世代の変化の後の `start` が通れば違反（AT21、AT07）。
- PINV-6: `verified` は、`accepted` の書き込み応答と、`verificationRule` のすべての probe の成立がそろった件だけに付く — 書き込み応答だけ、照合だけ、1 種類の証拠だけ、`not-found` だけで `verified` になれば違反（INV-10、AT26）。
- PINV-7: 1 件でも `uncertain` になったら、その実行で以降の `commitOne` を呼ばない。`Retry-After` で自動に再開しない — `uncertain` の後に別の対象への送出、時間の経過による再開が起これば違反（INV-19、AT25）。
- PINV-8: 同じサービスで `running` の実行は、ブラウザーのプロファイル全体で 1 つだけである — 2 つの Controller（2 つのタブ）が同時に `running` になれば違反（INV-09、AT22）。
- PINV-9: Adapter の戻り値は、検証を通ったものだけが判定に使われる。検証に通らない値、`execId` の不一致、例外、期限超過は異常として扱う — 不正な値が `skipped` や `verified` になる、黙って読み飛ばされる、のどれかで違反（INV-16、DC1）。
- PINV-10: Adapter の呼び出しの開始の間隔は、種類を問わず `minIntervalMs` 以上である — 一覧取得・preflight・照合を含めて間隔を割れば違反（INV-19）。
- PINV-11: Delete の各メソッドは、`capabilityEnabled(gate, buildKind)` が真のときだけ呼ばれる — `distribution` で `ownerAcceptedRisk` や `notApplicable` の gate の Adapter が呼ばれる、判定値を別の判定に置いた gate で有効になる、のどれかで違反（INV-15）。
- PINV-12: 計画・承認・結果は保存されず、Controller を破棄すると承認は使えず、新しい Controller は前の承認を受け付けない — 破棄の後の送出、新しいインスタンスでの前の `approvalId` の受け付けのどれかで違反（INV-08、AT24）。
- PINV-13: 完全性が `complete` になるのは、`stableSnapshot` の契約があり走査に異常がない場合だけである — 契約のない Adapter の矛盾のない一覧、重複・短い終端・並びの逆転を含む一覧が `complete` になれば違反（INV-14、§5）。
- PINV-14: KEEP の解除は、実行中の計画の対象を増やさない — 実行中に KEEP を外した会話が、元の計画になかったのに送出されれば違反（INV-04）。

### 失敗の経路

正常、利用者の停止（送出前・送出中）、例外（Adapter・WebCrypto・Web Locks）、期限超過（呼び出しごとの 30 秒、承認の期限、`approvableUntil`）、管理画面の破棄（`dispose`）、Adapter の不正な値、KEEP の状態の変化（送出前の区間の待ち中を含む）、他のタブの KEEP の書き込みと実行ロックの競合、主体の切り替え、INV-19 の各事象を、合成 Adapter と偽の時計・偽の Web Locks で試験する。

### 限界（受容する）

- 照合（preflight）から確定までの間のサービス側の更新は原子的に防げない（§7「削除の意味」）。
- 送出の後は、KEEP を付けても停止しても、その件の削除を取り消せない。
- 枠組みは、Adapter が 1 回の呼び出しで要求を 1 回だけ送ること、要求が固定テンプレートどおりであること、`accepted` と `satisfied` が真であることを確かめられない。これは所有者の実装の保証と DEV03 の実測に依存する。
- 照合の probe は 1 回の要求でなければならないため、一覧の複数ページの走査を要する証拠（「一覧のどこにも現れない」）は表せない。必要なら DEV03 の結果を見て別の Proposal で扱う。
- 管理画面を閉じると、`uncertain` の一覧と結果も失われる。利用者は新しい一覧から確かめ直す。
- 合成試験は実サービスでの挙動を示さない。AT11〜AT26 は合成 Adapter での試験として記録し、実画面の試験を合格扱いにしない。
- 実行ロックは同じブラウザーのプロファイルの中でだけ働く。別のプロファイル・別の端末からの同時実行は防げない。

### 影響範囲

`src/plan/`・`src/run/`（新設）、`src/keep/keepStore.ts`（公開メソッドの追加。既存の状態遷移は変えない）、試験。BLUEPRINT は実装 PR で次を改める: §6 に `idle`、各遷移、続きの計画を加える。§7「KEEP と確定の順序」の文言（第 7 節の 3）。§5「保存方針」の削除計画を「メモリのみ（保存しない）」に確定する。P-0001 の変更内容 3（Adapter の分割）と 4（gate の判定項目）を本 Proposal で具体化する。

### 互換性

新規。拡張のビルド成果物は変わらない（どのエントリーからも import しない）。KeepStore の既存の公開メソッドと保存形式は変えない。`docs/handoff/contracts.reference.ts` の `WebHistoryAdapter`・`verified-in-ui`・`inventory` のない `RunState`・`Preflight` の形とは非互換で、P-0001・P-0003 と本 Proposal が優先する。

### 代替案

- Adapter が `collect` で一覧全体を返す（参考型定義の形）: 要求の間隔とループの所在が Adapter の中に隠れ、Content Script にループを持たせない（INV-18）ことと、要求の間隔をすべての要求に適用すること（INV-19）を枠組みで守れない。
- 承認を `approved` のまま実行の期間ずっと使う（期限なし）: 開いたままの画面で古い承認が残る。期限で `paused` にし、続きの計画と新しい承認を求める。
- KEEP の `revision` が変わったら承認を無効にする: 実行と関係のない会話の KEEP の付け外しでも実行が止まる。対象を増やさない計画（INV-04）と送出直前の再確認（§7）で足りる。
- 送出の応答まで KEEP のキューを持ち続ける: 送出の後の KEEP は取り消しに効かないため順序の保証は増えず、応答の待ち（最長 30 秒）の間 KEEP の操作が止まる。
- 画面から KEEP の書き込みを Controller 経由に付け替える（§7 の文言どおり）: 順序の保証は KeepStore のキューで同じになり、画面の変更だけが増える。
- 主体ごとの実行ロック: 主体の証拠が誤っていたときに排他が外れる。サービスごとのロックは排他を広げる方向にだけ働く。
- `uncertain` の件を照合で `present` と確かめたら続きの計画に戻す: 結果が不明だった破壊的操作の再送に近く、INV-07 の境界があいまいになる。新しい一覧と新しい承認からだけ選び直せるようにする。

### 受け入れ条件（試験観点）

すべて合成 Adapter・偽の時計・偽の Web Locks・メモリの KEEP（`src/dev/memoryKeepDeps.ts` と同じ方式）による単体試験で行う。

- gate: 配布版と個人用ビルドの判定の表（各判定の各値）、判定値の置き場所の誤り、`HISTORY.md#P-0003` の参照の欠如（PINV-11）。
- 戻り値の検証: 余分なキー・欠けたキー・型の違い・正規形式でない ID・範囲外の日時・長すぎる文字列・`execId` の不一致・例外・期限超過がすべて異常になる（PINV-9）。descriptor の各条件の違反で Read と Delete が無効になる。
- 一覧: 契約なしの矛盾のない一覧が `unknown`、契約ありで異常のない一覧が `complete`、短い終端・重複・並びの逆転・`cursor` の再出現・不正なレコード・上限で `partial`、取得中の 429 で `failed` かつ `Retry-After` が表示用の値として残る、取得中の主体の切り替えで `failed`（PINV-13）。
- 計画: 除外の理由ごとの件数（AT11、AT19、AT20）、公式エクスポートのスナップショットから対象 0 件で `ready` に進まない、KEEP が `locked` / `corrupt` / `unavailable` で計画を作らない（AT13、AT14）、対象 0 件で `draft` のまま、digest が全項目に依存し対象の順序に依存しない、計画の後に現れた会話が対象にならない（AT15、PINV-1、PINV-2）。
- 承認: 二重の `start`、期限切れ、`approvableUntil` の後の `approve`、別の digest、新しい計画・スナップショットの置き換え（公式エクスポートの再取り込みを含む）・Adapter の版・KEEP の世代と `storeId` の変化・停止・破棄の後の `start` の拒否（AT21、PINV-5）。KEEP の `revision` の変化だけでは無効にならない。
- 状態遷移: 表の各遷移と、列挙した許されない遷移の拒否。
- KEEP の順序: 承認の後、送出の前に対象へ KEEP を付けるとその件が `skipped`（`keep-protected`）になる。区間の待ち中に同じタブの `setKeep` が先に並んでいれば、その結果を読んでから判定する。他のタブの書き込み（ロックの競合・`changed-elsewhere`）では送出しない。送出の後に付けた KEEP はその件の結果を変えない（AT12、PINV-3）。KEEP が送出前に `locked` になると `failed`（AT13）。実行中の KEEP の解除で対象が増えない（PINV-14）。
- 1 件ごとの手順: 主体の切り替え（表示名が同じ場合を含む）で承認が無効になり `uncertain`（AT16）、fingerprint の変化と `activity` の変化で `skipped` のまま次へ（AT19、AT20）、429・5xx・期限超過・通信エラー・リダイレクト・想定外のスキーマで `uncertain` になり以降の送出がない（AT25、PINV-7）、書き込み応答だけ・照合の一部だけで `verified` にならない（AT26、PINV-6）、同じ対象への `commitOne` は高々 1 回（PINV-4）。
- 停止と破棄: 送出前の停止で以降の呼び出しがない、送出中の停止でその件の照合までだけが行われる（AT23）、`dispose` の後に呼び出しがなく、新しい Controller が前の承認を受け付けない（AT24、PINV-12）。
- 排他: 2 つの Controller が同じサービスで `start` すると 1 つだけが `running` になる。Web Locks がなければ開始しない（AT22、PINV-8）。
- 要求の間隔: 偽の時計で、すべての呼び出しの開始の間隔が `minIntervalMs` 以上（PINV-10）。
- 拡張のビルド成果物の検査が変わらずに通り、成果物に `src/plan/`・`src/run/` のコードが含まれない。
- 実サービス・Chrome 上での試験は本 Proposal の範囲外であり、合格扱いにしない。

Firing rate: unmeasurable before implementation (gate による有効化、計画の除外の各規則、preflight での `skipped`、INV-19 の停止は、所有者の Adapter による実際の一覧と実行がまだないため測れない; 所有者の Adapter を組み込み DEV03 を使い捨て会話で行った時点で、個人用ビルドでの gate の成立、除外の理由ごとの割合、`skipped` と `uncertain` の発生率を測定できる)
