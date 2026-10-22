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
