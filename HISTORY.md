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
9. ビルド成果物の検査（`scripts/check-dist.mjs`）を CI で実行する: manifest の権限と禁止項目、HTML の外部参照、`MAIN` world の指定、`onMessage` の登録が Content Script だけであること。
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
