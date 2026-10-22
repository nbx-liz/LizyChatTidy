# ChatGPT 会話の「選択的一括削除」既存ツール調査

## 調査条件

- 調査日: 2026-10-22。read-only、公開ページのみ（WebSearch / WebFetch / `gh api` による公開 GitHub リポジトリの閲覧）。ログイン、インストール、実アカウントでの検証は一切していない。
- 対象: ChatGPT Web の会話を複数選択（チェックボックス / フィルタ / 日付 / キーワード）して一括削除し、残りはサービス上に残せるツール。
- 情報源: Chrome Web Store (CWS)、Firefox Add-ons (AMO)、Greasy Fork、GitHub、OpenAI Developer Community、ベンダーのブログ / プライバシーポリシー。
- 方式の判定グレード:
  - **確認**: 公開ソースを読んで判定した。リポジトリ内のパスと行番号を付けている（行番号は調査時点の default branch HEAD）。
  - **推定**: ベンダーの記述やレビュー、古いソースからの推定。
  - **不明**: 判断材料がない。
- 方式の分類:
  - M1: ChatGPT 内部 Web API (`/backend-api/...`) を直接呼ぶ。
  - M2: DOM 自動操作（メニュー → 削除 → 確認ボタンのクリック）。
  - M3: それ以外（OS レベルの UI 自動化など）。
- 取得できなかったページ: help.openai.com（403）、extensionauditor.com（403）、Greasy Fork の一部コードページ（502/503）。詳細は「未確認事項」に記載。

## ChatGPT のネイティブ機能の現状

**2026-10 時点で、ネイティブの選択的一括削除は確認できなかった。** 公式に存在するのは次の 2 つだけ。

- 1 件ずつの削除: サイドバーの「…」メニュー → Delete → 確認。
- 全件操作: Settings > Data controls の "Delete all chats" / "Archive all chats"。アーカイブ済みのチャットは同じ画面の "Manage" から個別に復元・削除できる。削除したチャットは 30 日以内にシステムから完全に消える（help.openai.com 記事 8809935 の検索スニペットより。本文は 403 で取得できなかった）。

OpenAI の公式回答:

- OpenAI_Support（2026-03-05、community thread 1295825）: "there isn't a way to selectively bulk manage specific chats from the sidebar"
- OpenAI_Support（2026-09-08、thread 1388732）: 現行の個別操作と全件操作は、選択的なバッチ操作・ソート・独自の保持期間をカバーしていないと回答。要望はプロダクトチームに伝えたが時期は未定、代替としてアーカイブを推奨。
- OpenAI_Support（2026-08-07、thread 845481）: この機能には "tricky edge cases" があるとして要望を受け付けるにとどめた。

ベンダーのガイドも同じ認識（GPT Master、2026-10-12 更新）: "Native ChatGPT has no checkboxes, no Shift-click, and no select-all"

**技術的に重要な点: ネイティブ UI 自身も M1 と同じリクエストを送っている。**

- 2026-07-14 の不具合報告（thread 1386839）で、Web UI の削除操作が `PATCH https://chatgpt.com/backend-api/conversation/<id>` に body `{"is_visible": false}` を送っていることが観測されている。このリクエストは約 30 秒後に `500 {"detail":"Request timeout"}` で失敗した。翌 07-15 に OpenAI_Support が「解決済み」と回答。
- 旧 Superpower のソースでは、全件削除が `PATCH /backend-api/conversations` に `{is_visible:false}` を送る実装になっている（`saeedezzati/superpower-chatgpt` の `scripts/content/api.js:617-631`。2024 年版で現行未確認）。

ここから、ChatGPT の「削除」はサーバー側で `is_visible=false` に切り替えるソフト削除であり、30 日後に完全削除される流れだと推定できる。

## 候補一覧表

| name | 入手先 | 利用者数・評価・更新日 | OSS | 機能 | 方式と根拠 | データの外部送信 | 備考 |
|---|---|---|---|---|---|---|---|
| **ChatGPT Bulk Delete (qcrao)** | CWS `effkgioceefcfaegehhfafjneeiabdjg` / AMO `chatgpt-bulk-delete` | CWS 約 70,000 人・3.1★(418)・2026-10-14 v7.1 / AMO 1,779 人・4.4★・2026-08-19 v6.9 | 公開。github.com/qcrao/bulk-delete-chatGPT（star 139、LICENSE 指定なし。AMO 表記は MPL-2.0） | サイドバーにチェックボックス、Shift で範囲選択、一括削除、一括アーカイブ（Pro）、プロジェクト内チャット対応、遅延設定 | **M2 確認**。`config.js:47-63` に DOM セレクタ（`button[data-testid="delete-conversation-confirm-button"]`、`button[data-conversation-options-trigger]`、`[data-testid="delete-chat-menu-item"]` など）、`config.js` STRINGS に各言語の "Delete" ラベル（"checked 2026-10-13"）。backend-api は呼ばない | あり。`bulk-delete-chatgpt-worker.qcrao.com` の `/send-event` に、Google identity の user_id・操作種別・件数を送る（`utils.js:204-217`）。課金状態の確認も同じ worker。manifest で `identity` と `identity.email` 権限を宣言 | フリーミアム（無料は 1 日 1 回 10 件まで。Pro は月 $4.90 / 年 $19.90 / 買い切り $39.90）。広告あり。UI 変更のたびに壊れてきた履歴がある（後述） |
| **Superpower for ChatGPT** | CWS `amhmeenmapldpjdedekalnfifgnpfnkc` | 100,000 人（概要では "over 400,000" と記載）・4.6★(3.7K)・2026-10-18 v8.5.1 | 現行は実質クローズド。GitHub の saeedezzati/superpower-chatgpt（star 1,702）は v5.6.6、最終 push 2024-06。ライセンスは再配布禁止 | Bulk Delete、Auto Delete / Auto Archive（N 日経過で自動削除・アーカイブ）、フォルダ、エクスポートなど多機能 | **M1。2024 年版ソースからの推定**。`scripts/content/api.js:596-616` で `PATCH /backend-api/conversation/{id}` `{is_visible:false}`。トークンは `scripts/interceptor/interceptor.js:19-27` で page の `fetch` をフックし `/api/auth/session` のレスポンスから取得して `chrome.storage.sync` に保存 | 旧版: `scripts/background/initialize.js:48-70` で openai_id・email・name・avatar を `api.wfh.team/gptx/register/` に送信。現行のプライバシーポリシーは ChatGPT へのリクエストについて "are not routed through our servers" と記載、一方で一部機能の "Service Data" を AWS に保存 | 最大手の一つ。現行版の実装は検証できない |
| **AI Toolbox（旧 ChatGPT Toolbox）** | CWS `jlalnhjkfiogoeonamcnngdndjbneina` | 50,000 人・4.8★(1K)・2026-10-19 v5.0.56 | クローズド | Manage Chats でチェックボックス選択（Select All）、一括削除・一括アーカイブ、タイトルフィルタ。検索側に日付範囲と Must include / Exclude、進捗表示 | **M1 推定**。ベンダーの説明は「自分のセッションで ChatGPT に送り、数件ずつ投げてレート制限に従う」。会話を IndexedDB にキャッシュしており、一覧 API を使っていると推定 | 会話本文は「サーバーに保存しない」と主張。フォルダ・プロンプト・タグ・ピン・利用回数はベンダーの backend に同期（AES 暗号化）。CWS の開示は PII・認証情報・個人的通信・Web サイトのコンテンツ | 無料は 1 回 5 件まで。Premium は月 $9.99 / 買い切り $99 |
| GPT Master | CWS（ID 未取得。リダイレクト経由） | "10,000+"・4.8★(270)（ベンダーページの数値） | クローズド | ホバーでチェックボックス、Shift で範囲選択、右クリックで一括アーカイブ・移動・削除 | **不明** | 不明 | 無料は「週 10 件」 |
| ChatGPT Pro Tools | CWS `blehigjjjlnlbbgjghhfnllglnelijkg`（Edge / Firefox 版もあり） | 未取得 | クローズド | Batch Select（サイドバーにチェックボックス）、削除・アーカイブ・移動・ピン・エクスポート、ワークスペースで検索・日付・タグのフィルタ | **不明**（"Every action uses your own ChatGPT session" とだけ記載） | 不明 | 無料は 1 回 7 件まで、Pro は月 $4.99 |
| ChatGPT Bulk Delete (gpt-bulk.de) | CWS `gibkdljbjknbolnjmhnahcpjecgjifde` | 678 人・4.8★(14)・2026-09-26 v4.0.1 | GitHub リンクなし | Multi-select、Select All、確認付き削除 | **不明** | 「収集しない、解析トラッキングなし」と記載 | qcrao と同名。名前の衝突に注意 |
| ChatGPT Bulk Manager | CWS `hklkmdbahkdepfkjpgahfhbfeilkahnp` | 41 人・5.0★(1)・2026-09-18 v2.0.0 | 「GitHub で OSS」と記載があるがリンクは見つからない | クリック / Shift / ドラッグで範囲選択、反転選択、プロジェクト単位の選択・削除、一時停止・再開・失敗分の再試行 | **M1 推定**。"Requests are throttled; if ChatGPT returns 429, the extension waits and retries" と記載 | 「収集しない」と記載 | 429 への対処を明示している |
| Bulk delete ChatGPT, Claude, Gemini Chats (RAON) | AMO `ai-chats-bulk-delete` | 329 人・5★(7)・2026-10-17 v1.6.7 | All Rights Reserved | チェックボックス選択、一括削除、一括保存、停止ボタン | **不明** | 「外部サーバーに送らない」と記載 | 複数サービスに対応 |
| ChatGPT Bulk Chat Remover | CWS `dgmcfmceglpbdfefcbcbdddggfelfklb` | 330 人・1★(3)・2025-06-04 v2.1 | 「GitHub にある」と記載があるが URL は取得できず | 自動スクロールで全件ロード、全選択、除外リスト（keep） | **M1 推定**（説明文に "API-based deletion"） | 「ローカルのみ」と記載 | 除外リスト（保護したいチャット）を持つ点が特徴 |
| **AI Chat Bulk Manager**（userscript） | Greasy Fork 584604 / github.com/learnerLj/ai-chat-bulk-manager | 76 インストール・2026-09-30 v0.7 | MIT | サイドバーにチェックボックス、一括アーカイブ・削除、停止ボタン。Gemini にも対応 | **M1 確認**（ChatGPT 側）。`src/index.user.js:256-271` で `GET https://chatgpt.com/api/auth/session` から accessToken を取得、`:302-326` で `PATCH /backend-api/conversation/{id}` `{is_visible:false}`、`:330-354` で `{is_archived:true}`。一覧は DOM（`nav a[href*="/c/"]`、`:274-285`）。Gemini 側は M2 | なし（`@connect chatgpt.com` のみ） | 間隔 100ms（`:25`）。`GM_xmlhttpRequest` を使う |
| **chatgpt-bulk-delete-export (Junyi-99)** | GitHub のみ | star 0・2026-08-06 | 公開 | 検索、Shift 範囲選択、全選択、アーカイブ / 削除、エクスポート | **M1 確認**。`src/lib/chatgpt.ts:26-33` で `/api/auth/session`（メモリにキャッシュ）、`:40-47` のヘッダで `chatgpt-account-id`（`_account` cookie 由来）を付与、`:95-107` で一覧（`is_archived` 指定可）、`:110-125` で PATCH、`:145` で concurrency=5、Retry-After を尊重し 429 で再試行・401 でトークン再取得 | なし（PRIVACY.md あり） | 設計品質が最も高い。自己テスト `chatgpt.check.ts` あり |
| **chatgpt-bulk-delete (kevin-lynch)** | GitHub のみ | star 1・2026-04-30 | 公開 | 全件一覧、タイトルフィルタ、All / None、削除。service worker で実行するため popup を閉じても継続 | **M1 確認**。`background.js:55` の `world: "MAIN"`（page 文脈で実行）、`:63-67` で session トークン、`:69-86` で一覧（limit 100）、`:88-105` で PATCH。429 / 5xx は指数バックオフ（最大 8 秒）、成功後 200ms 待つ | なし（"No network calls anywhere except chatgpt.com"） | 4 ファイル構成の最小実装 |
| **ce-chatgpt-bulk-delete (stevenmorano)** | GitHub のみ | star 0・2026-06-29 | 公開 | 別タブのダッシュボード、IndexedDB にメタデータ同期、Project / Folder 除外フィルタ、作成日・更新日・タイトルでソート | **M1 確認**。`dashboard.js:111-123` で拡張ページから `https://chatgpt.com/api/auth/session` を fetch、`:143` で一覧、`:389-396` で PATCH、逐次処理で 500ms 間隔 | なし（ローカル IndexedDB） | 拡張オリジンから cookie 付きで fetch できるかは未検証 |
| chatgpt-bulk-delete-manager (fineanmol) | GitHub のみ | star 1・2026-06-30 | 公開 | 期間フィルタ（24h / 7d / 30d）、無題チャット、プレビュー、バックアップ、削除とアーカイブの切替 | **M1 確認**。`content.js:130-138` で session、`:187` と `:215` で一覧、`:656` と `:905` で PATCH（`is_visible` / `is_archived`）、`:1046-1077` で遅延スライダー（500〜3000ms、既定 1000ms） | なし | 日付フィルタあり |
| **chatgpt-bulk-delete (EvilIrving)** | GitHub のみ | star 0・2026-09-14 | 公開 | チャットとプロジェクトの一括削除 | **M1＋M2 確認**。`content.js:697` で getToken、`:724-736` のヘッダで `ChatGPT-Account-Id` と `OAI-Language` を付与、`:776-781` でチャットを PATCH。プロジェクトは `:820-835` で `DELETE /backend-api/gizmos/{id}`・`/projects/{id}` などを順に試し、全部失敗したら `:783-818` で DOM クリック（`[role="menuitem"]` の文言一致、`delete-conversation-confirm-button`）にフォールバック | なし | プロジェクト用エンドポイントは作者の当て推量で、実在は未確認 |
| chatgpt-mass-delete-export (JozefJarosciak) | GitHub のみ | star 1・2025-11-04 | 公開 | 全選択 / 個別選択、削除、ZIP エクスポート | **M1＋M2 確認**。`background.js:27-56` で service worker から PATCH、失敗時は `content-script.js:605-750` で DOM フォールバック（hover → aria-label に "conversation" と "option" を含むボタン → 文言 "delete" → 確認ボタン）。トークンは `content-script.js:98` 付近で `window.fetch` をフックして送信ヘッダから取得 | なし | `popup.js:419` の `Promise.all` で全件並列に削除する。レート制限上は最も危険な実装 |
| chatgpt-bulk-delete (joysey) | GitHub のみ | star 3・2025-07-04 | 公開 | 全件または選択削除、キーワード検索 | **M1 確認**。`src/contents/chatgpt-proxy.ts:60-73` で `sec-fetch-*` などのヘッダを模倣、`:79` で一覧、`:105` で **`/backend-api/conversations/search?query=`（サーバー側キーワード検索）**、`:130-137` で PATCH | なし | 検索 API を使う唯一の例 |
| chatgpt-bulk-deleter (Masahiro-kokoro) | GitHub のみ | star 0・2026-02-06 | 公開 | 会話とメモリの一括削除（日本語 README） | **M1 確認**。`src/content-api.ts:8-12` で session、`:127` で一覧、`:221-237` で PATCH、`:281` で `/backend-api/memories/{id}` | なし | 複数アカウントを開いている場合、アクティブタブのアカウントが優先されると注意書きあり |
| ChatGPTBulkDeleter (willnjohnson)（userscript） | GitHub | 2025-07 | 公開 | モーダルでチェックボックス選択 | **M1 確認**。`chatgpt_bulk_deleter.js:52` で session、`:271-278` で PATCH | なし | `@grant none` |
| ChatGPT Easy Chat Management（userscript） | Greasy Fork 538142 | 220 インストール・2025-06-03 | 公開（Greasy Fork） | チェックボックス選択、"List older"（N 日より古いものを事前選択）、確認ペイン | **M1 確認**（Greasy Fork のコードページを WebFetch で読んだ要約。行番号なし）。session → `PATCH {API}/conversation/{id}` `{is_visible:false}`、200ms 間隔 | なし | 日付で選べる |
| chatgpt-bulk-delete-powershell (cdh290718-oss) | GitHub のみ | star 0・2026-10-08 | 公開 | 完全一致するタイトルのリストで削除。dry-run（check）、同名チャットがあれば中止、実行ログ | **M3 確認**。`chatgpt-bulk-delete.ps1:23-24` で Windows UIAutomationClient を使い Chrome のアクセシビリティツリーを操作（`Invoke-UiElement`、`:207`） | なし | Windows・中国語 UI 専用。1 件ごとに最低 10 秒待つ |

その他（中身は未確認、存在のみ確認）:

- Greasy Fork: ChatGPT Bulk Deleter ✨（540396、333 インストール。コードページが 502/503 で取得できず）、ChatGPT/Claude/Gemini Bulk Chat Deleter、ChatGPT Bulk Delete (API + Ctrl Multi-Select)（PNP-MA）、ChatGPT Bulk Delete & Archive Chats など計 12 本。
- AMO: ChatFlush、ChatGPT Multi Delete、ChatGPT Cleaner、AI Chat Cleaner など（いずれも利用者 2 桁以下）。

## 方式別の技術詳細

### 全体の傾向

方式は利用者層によって分かれる。

- **小規模な OSS / userscript ではほぼ M1 一択。** 確認した 13 本のうち、純粋な M1 が 10 本、M1＋M2 のハイブリッドが 2 本、M3 が 1 本。
- **利用者数が最大の専用拡張（qcrao、CWS 約 7 万＋AMO 約 1.8 千）は M2。**
- 大手の多機能拡張（Superpower、AI Toolbox）は M1 と推定（Superpower は旧ソースで確認済み、AI Toolbox はベンダー記述から推定）。

### M1: 内部 Web API

**エンドポイント**（全実装で共通。ネイティブ UI 自身も同じ）

- 一覧: `GET /backend-api/conversations?offset=N&limit=M&order=updated[&is_archived=true|false]`
  - limit の実装値は 28（joysey。Web UI と同じ値で、429 報告の URL にも `limit=28` が出ている）、50、100。
- 削除: `PATCH /backend-api/conversation/{id}`、body `{"is_visible": false}`
  - Junyi-99 のコメント: "`is_visible: false` is what the UI calls Delete"
- アーカイブ: 同じエンドポイントに `{"is_archived": true}`
- 全件削除（旧 Superpower）: `PATCH /backend-api/conversations` `{is_visible:false}`
- キーワード検索（joysey）: `GET /backend-api/conversations/search?query=...&cursor=`
- その他: `/backend-api/memories/{id}`（Masahiro）、`/backend-api/conversation/{id}` GET（エクスポート用）

**トークン取得の実際**（すべて既存のログイン cookie を前提に Bearer JWT を得る方式）

1. content script から同一オリジンで `fetch('/api/auth/session', {credentials:'include'})` を呼び、`accessToken` を取り出す（Junyi、fineanmol、Masahiro、willnjohnson、Easy Chat）。
2. service worker から `chrome.scripting.executeScript({world:"MAIN"})` で page 文脈に関数を注入して同じことをする（kevin-lynch。コメント: "run in page world so we can use page's cookies + access token"）。
3. userscript の `GM_xmlhttpRequest` と `@connect chatgpt.com` を使う（learnerLj）。
4. page 側の `window.fetch` をフックして、ネイティブが取得した session レスポンスを横取りする（Superpower）か、送信ヘッダの `Authorization` を横取りする（Jozef）。
   - Jozef のフックは content script の isolated world に書かれているため、page の fetch は捕捉できない可能性がある（未検証）。
5. 拡張ページ（別タブのダッシュボード）から `https://chatgpt.com/api/auth/session` を host_permissions 付きで fetch する（stevenmorano。cookie が付くかは未検証）。

**付加ヘッダ**

- `chatgpt-account-id`（`_account` cookie から取得。Team / Enterprise ワークスペースの切替に関係すると思われる）: Junyi、EvilIrving。
- `OAI-Language`: EvilIrving、joysey。
- `sec-fetch-*` の模倣: joysey（ブラウザが上書きするので実質意味はない）。
- **`oai-device-id` やセンチネル系トークンを付ける実装は一つもなかった。** 現時点では Bearer だけで PATCH は通っていると読める。

**ペーシングの実装値**（どれが安全かは裏付けがない）

| 実装 | 間隔・方式 |
|---|---|
| Jozef | 全件並列（`Promise.all`） |
| learnerLj | 100ms |
| kevin-lynch / Easy Chat | 200ms（kevin は 429 で最大 8 秒の指数バックオフ） |
| stevenmorano | 逐次 500ms |
| fineanmol | 既定 1000ms（500〜3000ms で可変） |
| Junyi-99 | concurrency 5＋Retry-After（上限 30 秒）＋429 で最大 4 回試行 |
| qcrao（M2） | 基準 1200ms、10 件ごとにクールダウン（最大 30 秒）、自動減速、ユーザー設定で最大 10 分 |

### M2: DOM 自動操作

**qcrao のセレクタ戦略**（`config.js:47-63`）は、`data-testid` 優先、ARIA / role 次点、最後にクラスや文言で探す多段フォールバック。

- 行: `a[href*="/c/"]`、プロジェクト内は `main li[class*="group/project-item"]`
- メニューボタン: `button[data-conversation-options-trigger]`、`button[data-testid="conversation-options-button"]`、`button[data-testid$="-options"][aria-haspopup="menu"]`、`button[id^="radix-"][aria-haspopup="menu"]`
- 削除項目: `[data-testid="delete-chat-menu-item"]`、`[role="menuitem"][data-testid*="delete"]`、`[role="menuitem"].text-danger`、さらに各言語の "Delete" 文言（"checked 2026-10-13"）
- 確認ボタン: `button[data-testid="delete-conversation-confirm-button"]`、`button.btn.btn-danger`、`[role="dialog"][data-state="open"]:not([aria-hidden="true"]) form button[type="submit"].text-chart-red`
- タイムアウト: 確認ダイアログは削除リクエストが終わるまで閉じないため、閉じるのを最大 10 秒待つ（`CONFIRM_DIALOG_CLOSE: 10000`）。

**M2 の運用コスト**（qcrao の issue / commit 履歴）

- UI 変更で動かなくなった報告: #3 (2023-08)、#9 (2023-11)、#27 (2025-01)、#32 (2025-03)、#36/#37 (2025-05)、#50 (2026-05、進捗は 100% になるのに実際は削除されない)、#57 (2026-06)、#62 (2026-09、チェックボックスが出ない、OPEN)。
- 英語以外の UI では動かない問題: #39/#40 (2025-07)。英語 UI に切り替えれば動くという回避策が出ていた。
- セレクタ修正の commit: 2024-08、2024-11、2025-05、2025-08、2026-05、2026-09-29、2026-10-09、2026-10-13。

**ハイブリッド型**の Jozef と EvilIrving は、M1 が失敗したときだけ文言一致の DOM クリックに落ちる。

### M3: OS レベルの UI 自動化

PowerShell ツール（cdh290718-oss）は Windows UI Automation で Chrome のアクセシビリティツリーを操作する。README と `docs/LESSONS_LEARNED.md` から読み取れる実運用の知見は次のとおり。

- 削除の確認ダイアログが閉じるまで、実測で約 16 秒かかった。
- モーダル表示中は背景要素がアクセシビリティツリーから隠れる。
- `RuntimeId` はリストが更新されるたびに変わるため、258 件の実行は 192 件目で停止し、再スキャンして続行した。
- 履歴の読み込みエラーが出ている間は「見つからない」と判定できない。
- 「送信した」と「削除を確認した」は区別して記録する必要がある。

## 影響・トラブル事例

1. **サーバー側レート制限は 2026 年に強まったとみられる。** 方式に関係なく発生する。
   - 2023-09 (qcrao #5): 実行間に遅延が必要という報告（初期から兆候があった）。
   - 2026-03-29 (qcrao #47): ChatGPT 上に次のバナーが出たという報告。"You're making requests too quickly. We've temporarily limited access to your conversations to protect your data." **qcrao は M2 なので、DOM 経由でも制限される。**
   - 2026-04〜05: qcrao が v6.3 でスロットルを追加し、v6.6 で遅延を設定可能にした。作者のコメントは "ChatGPT can still temporarily rate-limit large batches"。
   - 2026-08-07 (thread 845481): 利用者が "Until last month, it worked; this month, it's being rate-limited." と報告。7 月から制限が強まったことを示唆する。
   - 2026-08-11 / 08-12: qcrao が最大遅延を 60 秒、さらに 10 分に引き上げた。
   - 2026-08-21/22 (thread 1391615): `GET /backend-api/conversations?offset=0&limit=28` が 429 を返し続け、サイドバーが数時間空になったという報告。数千件の会話を持つアカウント。別のユーザーは qcrao の Firefox 版を負荷試験的に使い、200 が 13 回・429 が 9 回というトレースを示した。手動の削除 1 回でも履歴の再取得が複数回走るとの観察もある。
   - **実際に体験される失敗は、削除後の一覧 API での 429 である。** 削除の PATCH が 429 になる形ではない。また 429 は直前の PATCH が反映されたかどうかを教えてくれない（2026 年のトラブルシュート記事も同じ指摘）。
2. **ネイティブ削除自体の不具合。** 2026-07-14、PATCH が 30 秒でタイムアウトし 500 になった（thread 1386839）。翌日 OpenAI が解決済みと回答。どのツールもこの種のサーバー障害に巻き込まれる。
3. **UI 変更による破損（M2）。** qcrao の履歴は前節のとおり。「進捗 100% なのに削除されていない」という偽の成功（#40、#50）が繰り返し起きている。
4. **アカウント警告・BAN。** 拡張利用を理由にした警告・停止の報告は見つからなかった。確認できたのは一時的な会話アクセス制限（上記バナー）のみ。
5. **トークン窃取型の偽拡張。** 2026-01 に LayerX が、ChatGPT 強化をうたう 16 個の拡張（Chrome 15・Edge 1）が送信リクエストを監視して session トークンを外部に送っていたと報告した。M1 型拡張と同じ権限・同じトークン取得経路を使っており、正規拡張との区別は利用者にはつかない。別件で OX Security も ChatGPT / DeepSeek の会話を盗む 2 拡張（90 万 DL 超）を報告している。
6. **同名・削除済み拡張。** CWS に "ChatGPT Bulk Delete" という名前が少なくとも 3 つある（qcrao `effkgio…`、gpt-bulk.de `gibkdl…`、`oneijcamcpappfoofjknfnlmkjfhkdcd`）。最後のものは extensionauditor で「悪性の可能性あり・削除済み」とされている、という検索要約を得たが、ページは 403 で直接確認できていない。
7. **ベンダー側へのデータ送信。** qcrao は Google アカウントの ID と操作件数、旧 Superpower は OpenAI の user id・email・氏名・アバターを送る。AI Toolbox は整理用メタデータを同期する。「削除ツール」でも外部送信がゼロとは限らない。

## 未確認事項

- help.openai.com の Release notes と削除記事の本文（403）。ネイティブの複数選択がないという判断は、2026-09-08 の OpenAI_Support の回答と 2026-10-12 のベンダーガイドに基づく。
- Superpower v8.x と AI Toolbox の現行実装（クローズド）。M1 は推定。
- GPT Master、ChatGPT Pro Tools、gpt-bulk.de、RAON、Bulk Chat Remover の方式。
- Greasy Fork 540396（ChatGPT Bulk Deleter ✨）のコード（502/503 で取得できず）。
- extensionauditor の `oneijc…` が悪性・削除済みとされた根拠（403）。
- OpenAI 利用規約が内部 API の自動呼び出しや一覧取得を禁じているか。今回のセッションでは規約ページを取得していない。
- レート制限の閾値（件数 / 時間窓）と、制限がアカウント単位か IP 単位か。どの公開情報にも数値がない。
- stevenmorano 方式（拡張ページから chatgpt.com へ cookie 付きで fetch）と Jozef の isolated world での fetch フックが、実際に動くかどうか。
- `chatgpt-account-id` ヘッダの要否（個人アカウントとワークスペースアカウントの違い）。
- EvilIrving が試すプロジェクト削除用エンドポイント（`/backend-api/gizmos|projects/{id}`）が実在するか。
