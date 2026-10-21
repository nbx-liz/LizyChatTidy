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

`docs/handoff/contracts.reference.ts` と handoff 本文の間にある 3 つの食い違いを、実装前に解消する。

1. `KeepSnapshot.protectedRefs: ConversationRef[]` は accountKey/workspaceKey を必須とするため、主体が未検証の会話（handoff §08: 現在のアカウントと結び付けられない公式エクスポート由来の会話）に KEEP を付けられない。必須機能 FR05 が P1 の読み取り専用経路で成立しない。
2. handoff §05 の Import Worker に対応する契約がなく、DEV05 に型の目標がない。
3. `WebHistoryAdapter` が読み取り（`collect`）と破壊的操作（`commitOne`）を同じ型に持つため、読み取り専用のビルドにも削除メソッドが含まれる。

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
   上限超過・未知形式は部分結果を削除機能へ渡さずに中止する（AT10）。
3. **Adapter の分割**: `WebHistoryAdapter` を能力ごとに分ける。
   - `ReadAdapter`: `inspectScope`, `collect`
   - `AssistAdapter`: `openConversation`
   - `DeleteAdapter`: `preflight`, `commitOne`

   各 Adapter は自分の能力の `FeatureGate` を返す。`DeleteAdapter` はビルド時の有効化フラグで同梱を切り替え、gate が allowed でない配布版には実装コード自体を含めない。

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
- 上限を超える ZIP/JSON で `parse` が中止され、`records` を削除計画へ渡せない。
- Delete 無効のビルド成果物に `commitOne` の実装が含まれないことを、ビルド成果物の検査で確認する。

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
