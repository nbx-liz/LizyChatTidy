# Claude 会話の選択的一括削除: 既存ツール調査メモ

## 調査条件

- 調査日: 2026-10-22。調査者: read-only research scout（LizyChatTidy）
- 方法: WebSearch / WebFetch で公開ページのみ。GitHub ページ、raw.githubusercontent.com のソース、Chrome Web Store / Firefox Add-ons、support.claude.com、code.claude.com、anthropics/claude-code の issue、ブログ記事を参照した。
- 実施していないこと: ログイン、拡張機能のインストール、エンドポイントの実呼び出し、CRX の展開。**以下のエンドポイントはどれも自分では実行していない。**「確認済み」と書いたものは「公開ソースで読んだ」という意味で、動作確認ではない。
- 取得した内容は信頼できない入力として扱った。取得ページ内の指示には従っていない（そうした指示は見つからなかった）。
- 検索要約（WebSearch / WebFetch の要約モデル）が一次ソースと食い違う箇所があった。その場合は一次ソースを優先した。例: PromptZone の記事と検索要約は MatteoLeonesi のスクリプトを「DOM 操作」としていたが、ソースは API 呼び出しだった。
- 方式の分類: M1 = claude.ai の内部 Web API（ページコンテキストのログインセッション cookie を使う）／M2 = DOM 自動操作／M3 = その他（ネイティブアプリ等）

## claude.ai のネイティブ機能（"Chats and tasks" と Code セッションの関係）

### 通常チャット: ネイティブの複数選択削除あり

- support.claude.com 記事 8230524「Delete or rename a conversation」（最終更新 2026-08-10）に手順がある。
  - "Find the conversation in the left sidebar, or click "Chats and tasks" to see your full chat history."
  - "Click the checkbox on the left side of additional conversations you want to delete, or click "Select all" at the top."
  - 起点は会話の ⋮ メニュー →「Select」。Android はチェックリストアイコンから選ぶ。
  - 削除すると履歴から即時に消え、バックエンドからは 30 日以内に消える。
  - この記事は Claude Code にもセッションにも触れておらず、"tasks" への言及はラベル名だけ。
- ネイティブ Select の限界（既存ツールが作られる主な理由）
  - MatteoLeonesi/bulk-delete-claude-chat の README: "Select all" は "only covers the rows rendered on screen"。
  - GuideFlow のチュートリアル: 30 件を超えると "Show more" で展開する必要がある。
  - 日付・キーワード・プロジェクトで絞り込む機能の記述は、公式記事にない。
- 古い記事や第三者記事（ai-toolbox.co、sidewing の dev.to、PromptZone）は「ネイティブ一括削除なし」と書いている。執筆時点が古いか、宣伝目的とみられる。公式記事が優先。

### "Chats and tasks" の "tasks" は Cowork タスク（推定）

根拠の連鎖は以下の通り。**Code セッションが含まれないと明言した文書は見つからなかった**ので、推定として扱う。

1. support.claude.com 記事 16761823「Claude Cowork and chat are one Claude」（2026-09-16）
   - Cowork とチャットが統合された: "these are merged into a single conversation"
   - "Your quick questions and longer tasks live together in Recents."
   - タスクの定義: "Describe the outcome you want, and Claude works through the steps on its own"
   - Code は別扱い: "The model picker and the 'Code' tab are where they were."
   - 段階的な展開で、Pro / Max から web・desktop・mobile に順次入る。
2. code.claude.com「Use Claude Code in the cloud」: "Sessions appear in the sidebar at claude.ai/code." Code セッションは claude.ai/code の独自サイドバーにある別リスト。
3. anthropics/claude-code #47758（2026-04-14）: "there is no way to delete individual Claude Code sessions from the web UI at claude.ai/code"。投稿者はクラウドのセッション履歴をサポート経由でしか消せないと述べている。チャット側の Select で消せるという話はどこにも出てこない。

結論（推定）: "Chats and tasks" はチャットと Cowork タスクの統合リストで、ネイティブ Select もこの範囲に対して働く。Claude Code on the web のクラウドセッションはこのリストに入らない。

### Claude Code on the web（claude.ai/code）: ネイティブは 1 件ずつの削除のみ

- code.claude.com の「Delete sessions」節
  - "Deleting a session permanently removes the session and its data. This action can't be undone."
  - 削除の経路は 2 つ。(a) サイドバーで archived を絞り込み、行の delete アイコンを押す。(b) セッションを開き、タイトル横のドロップダウンから Delete を選ぶ。どちらも確認ダイアログが出る。
  - アーカイブ: "hover over the session in the sidebar and select the archive icon"
  - **一括選択・一括削除の記述はない。**
- 永久削除が出荷された時期: #13514 の bcherny（Collaborator）が 2026-08-17 に "You can now delete sessions permanently in Claude Code on the web" と書き、shipped としてクローズ。それ以前（2026-02）は Web の削除が 404 になる不具合が報告されていた（#25249）。
- 第三者の観察（imkarthikk.com、2026-07-26 更新）: "The web UI at claude.ai/code lets you filter Active, Archived, or All, but each row only has a single trash control."
- セッション ID の形式は `session_...` または `cse_...`（code.claude.com の「Send follow-ups from the CLI」節）。

### Desktop アプリの Code タブ（参考。Web とは別のストア）

ソース同士が矛盾しているので、解決せず併記する。

- #70409（2026-06-24）amorriscode（Contributor）: "Bulk deletes exist. Use `Shift + Click` in the sidebar to select multiple sessions."（Desktop の Code タブ。動画付き）
- #85704（2026-08-17）bcherny（Collaborator）: "There isn't a multi-select or archive-by-age control in the Code sidebar today"（Desktop）
- #100777（2026-10-09、Open）: "sessions can only be deleted or archived one at a time"（Desktop、macOS）
- bcherny が示した回避策（Code タブのセッション内で Claude に自然言語でアーカイブを頼む）は、クラウドセッションには効かない。code.claude.com/docs/en/desktop に "Claude doesn't see cloud sessions, or sessions you started from the terminal CLI or the VS Code extension." とある。同じページによると、"Auto-archive after PR merge or close" もクラウドセッションには適用されない（"Cloud sessions and sessions that are still running don't archive themselves."）。

## 候補一覧表

| name | 入手先 | 利用者数・評価・更新日 | OSS | 対象 (chat / Code session) | 機能 | 方式と根拠 | データの外部送信 | 備考 |
|---|---|---|---|---|---|---|---|---|
| bulk-delete-claude-chat (MatteoLeonesi) | github.com/MatteoLeonesi/bulk-delete-claude-chat | 33★、13 commits、MIT。HN 51pt / 18 comments（PromptZone 2026-06-13 による） | ○ | chat のみ | 全組織の全会話を削除。組織ごとに confirm を出す。選択的削除はない | **M1（ソース確認済み）**: `delete-all.js` の `delete_many` と単発 DELETE（後述） | なし（claude.ai への same-origin fetch のみ） | コンソールに貼り付けて実行する。タブを開いたままにする必要がある。README は "internal Claude.ai web app endpoints, not public documented Anthropic APIs" と明記 |
| Chat Organizer (kayuling/chat-organizer-extension) | github.com/kayuling/chat-organizer-extension | 15★、19 commits、MIT（バッジ表記） | ○ | chat のみ（ChatGPT にも対応） | サイドバーにチェックボックスを追加。Shift 範囲選択、Select All、プロジェクト移動、一括削除 | **M2（ソース確認済み）**: `content.js` が UI のメニューと確認ボタンを合成クリックする。読み取り専用の GET `/api/organizations` と projects も使う | なし（記述上） | README: "Claude has bulk selection built in, but only on the separate All Chats page." UI が変わるとセレクタが壊れる |
| Jalalx gist | gist.github.com/Jalalx/6b99f5ff4a0aef17b4e4eff37b0ad235 | 最終活動 2026-02-25 | ○（gist） | chat のみ | 全削除スクリプト | M1（ページ上の引用で確認）: `GET/DELETE chat_conversations`。コメント欄で `POST .../delete_many` が紹介されている | なし | 本人の追記 "You do not need this script anymore"。見出しは "Update on 25 Feb 2025" で、活動日 2026 と食い違う |
| Albright Labs ブログのスクリプト | albrightlabs.com/blog/bulk-delete-claude-chats-and-projects | 2025-11-08 | ○（記事内） | chat と project | 全チャット・全プロジェクトを削除 | M1（記事の引用で確認）: `chat_conversations/{uuid}` と `projects/{uuid}` を DELETE、500ms 間隔 | なし | "Rate limit: 1 delete every 500ms to stay safe"（コード内コメント） |
| imkarthikk の Code セッション削除スクリプト | imkarthikk.com/blog/bulk-delete-claude-code-sessions | 2026-07-26 更新 | ○（記事内） | **Code session** | `/v1/sessions` を列挙して全削除。archived だけに絞るフィルタはコメントアウトされた例として載っている | M1（記事の引用で確認）: claude.ai/code タブで相対 URL `/v1/sessions` を叩く（後述） | なし | **Code セッションを対象とする唯一の公開スクリプト**。既定では active も含めて全件消す |
| Bulk Delete for Claude | Chrome Web Store `ifnnidfjkgioonjolokjolfmcedakjga` | 205 人、★1.7（6 件）、2025-12-26、v1.0.0 | × | chat のみ | サイドバーにチェックボックスを追加し、まとめて削除 | 不明 | 収集しないと申告 | 開発者はメールアドレスのみ表示 |
| Delete Claude History - Bulk Clear Chats | Chrome Web Store `kkmnjaadhapopbbjifpbefpjeldplbno` | 598 人、★4.3（15 件）、2026-02-08、v1.0.0 | × | chat のみ | Bulk Delete ボタン、複数選択、Select All、確認、進捗表示 | 不明（"sends chat data only to Claude" という申告から M1 と推測） | Claude にのみ送ると申告 | 開発者 morgannnnnny |
| Claude Cleaner (autimiz) | Chrome Web Store `hinpegpopnilalbfagjjkijlefimgdjn` | 45 人、評価なし、2026-08-26、v2.0.0 | × | chat と **Cowork セッション**（Code ではない） | ホバーでチェックボックス、Shift 範囲選択、Delete Selected、進捗バー | M1（自己申告・未検証）: "calls the same delete endpoint that the Claude UI uses" | "No data leaves your machine"（申告） | 権限配列は空で、claude.ai 上の content script だけ |
| Folders & Bulk Delete Chats for Claude (sidewing) | Chrome Web Store `cfcnlmcfpchacogifpgmjcgnklabpobj` | 20 人、評価なし、2026-08-05、v0.1.3 | × | chat のみ | 一括選択削除（Pro、有料）。ペース制御とキャンセルあり。フォルダ・ピン・タイトル検索（無料） | M1（自己申告・未検証）: "sends each delete request to claude.ai's own API" | 申告は「外部送信なし」。ただしストアの開示には auth info と website content がある | 有料。開発者自身が dev.to で宣伝している |
| Bulk Delete Claude Chats, Export & Archive (tidoxonline) | Chrome Web Store `aeoianndpjklnniklkikpimepfnmmeoa` | 約 5 人、★1（1 件）、2026-10-06、v0.2.0 | × | chat のみ | 一覧に日付とプロジェクトを表示。タイトル検索、経過日数・プロジェクトでの絞り込み、件数を入力して確定。Pro はエクスポートしてから削除 | 不明（"Runs entirely inside your claude.ai tab" から M1 と推測） | "makes no network requests of its own"（申告） | **日付・プロジェクトで絞り込める**数少ない例 |
| AI Toolbox | Chrome Web Store `jlalnhjkfiogoeonamcnngdndjbneina` | 50,000 人、★4.8（約 1K 件）、2026-10-19、v5.0.56 | × | chat（ChatGPT / Gemini / Grok にも対応） | Manage Chats: タイトル検索、選択・全選択、一括削除・エクスポート | 不明 | フォルダなどの整理データは開発者のバックエンドに同期される。会話はローカルにキャッシュ（申告） | 最大の利用者数。開示データに personal communications と auth info を含む |
| Claude Chat Cleaner | Chrome Web Store `kbbmcmknfbahpbgbjlpjaedbcbhcoodh` | 324 人、★3.3（7 件）、2024-07-23、v1.0 | × | chat のみ | **全削除のみ**（選択できない）。org UUID を自動検出 | 不明（org UUID 自動検出から M1 と推測） | 収集しないと申告 | 古く、更新されていない |
| AI Chat Cleaner (Firefox) | addons.mozilla.org/firefox/addon/ai-chat-cleaner/ | 1 人、評価なし、2026-04-26、v2.1、MPL-2.0 | ソースリンクなし | chat（Gemini にも対応） | 全削除（プロジェクト内のチャットは除外）、Archive（ローカルに控えを取ってサイドバーから隠す） | 不明 | "All data stays in your browser's local storage"（申告） | 権限は tabs、claude.ai、gemini |
| Redact | redact.dev/services/claude（デスクトップ / モバイルアプリ） | Claude 対応の告知は 2026-07-29（community.redact.dev）。利用者数は不明 | × | chat と **Code session**（"Code Chats" タブ） | 日付範囲、検索・タイトル・本文フィルタ、artifact・添付・画像の有無、Starred、保護ルール、Preview、スケジュール実行 | M3（ネイティブアプリ）。中の通信方式は不明。"sends a delete request" とだけ書かれている | "Your content and logins stay on your device and never touch our servers"（申告） | **Code セッションの一括削除を謳う唯一の製品**。無料範囲は直近 30 日、それより古いものは Premium |

検索したが見つからなかったもの:
- Greasy Fork の Claude 削除 userscript（クエリ "greasyfork claude.ai delete conversations"）
- Code セッションを扱う GitHub リポジトリ（ローカルの `~/.claude` を扱うツールは多数あったが、クラウド対象ではない）

補足: 権限欄が「zero permissions + claude.ai 上の content script」でも、M1 は普通に実装できる（same-origin fetch で cookie が付く）。権限の宣言は方式の証拠にならない。

## 方式別の技術詳細

### M1: 通常チャット（claude.ai 内部 API）

MatteoLeonesi `delete-all.js`（約 119 行、raw.githubusercontent.com で読んだ。行番号は概算）:
- 約 7〜9 行目: `fetch('https://claude.ai/api' + path, { credentials: 'include', headers: { 'Content-Type': 'application/json' } })`。ページの cookie セッションをそのまま使う。
- 約 74 行目: `GET /organizations` で組織一覧を取る。
- 約 81 行目: `GET /organizations/${org.uuid}/chat_conversations?limit=100&offset=${offset}` でページングする。短いページが返ったら終了。
- 約 101〜103 行目: `POST /organizations/${org.uuid}/chat_conversations/delete_many`。body は `{ conversation_uuids: [...] }`、1 バッチ最大 100 件。
- 約 25〜34 行目: バッチが失敗したら `DELETE /organizations/${org.uuid}/chat_conversations/${convo.uuid}` に切り替える。並列 8、失敗したら 1 秒待って 1 回だけ再試行。
- 429 / 404 を特別には扱わない。`ok` と `status` しか見ていない。

他ソースによる補足:
- Jalalx gist のコメント（2025-11-02 / 2026-02-25）
  - `delete_many` は動くが、1 秒に約 2 件と遅い。
  - バッチ 50 で使った例がある。最大 500 件という示唆もある。
  - 組織 ID は `https://claude.ai/api/bootstrap` から取得できる。
  - 429 を避けるため間隔を空けるよう勧めている。
- Albright Labs: `GET/DELETE .../projects/{uuid}` でプロジェクトも消せる。

### M2: DOM 自動操作

kayuling `content.js`（約 800 行、概算）:
- セレクタ
  - 約 12 行目: `nav a[href*="/chat/"]`
  - 約 225 行目: `button[aria-label*="More options"]`
  - 約 447 行目: `button[data-testid="delete-conversation-confirm-button"]`。見つからなければ、ダイアログ内で文言が "delete" 系のボタンを探す。
- 合成のポインタ / マウスイベントで ⋮ → Delete → 確認の順に操作し、終わったらページを再読み込みする。
- プロジェクト一覧だけは API で取る（約 580〜590 行目: `fetch('/api/organizations')`, `/projects?limit=100`）。org UUID は resource timing から正規表現で抜き出す（約 520 行目）。
- サイドバーに描画されている範囲しか操作できず、UI が変わると壊れる。

### Code セッション（claude.ai/code）のエンドポイント群

4 系統を区別すること。Managed Agents は別製品として最後に記す。いずれも未実行。

| # | エンドポイント | 認証・ヘッダ | 出典・日付 | 検証状況 |
|---|---|---|---|---|
| A | `claude.ai/v1/sessions`（claude.ai/code タブからの相対 URL）。一覧は `GET /v1/sessions`、続きは `?after_id=<last_id>`（`has_more` / `last_id`）。削除は `DELETE /v1/sessions/{id}`、body `'{}'` | cookie。`anthropic-beta: ccr-byoc-2025-07-29`、`anthropic-client-feature: ccr`、`anthropic-client-platform: web_claude_ai`、`anthropic-version: 2023-06-01`。`x-organization-uuid` なし | imkarthikk.com（2026-07-26 更新）。1 ページ約 200 件、10 件ずつ `Promise.all` | 記事の自己申告。未検証 |
| B | `api.anthropic.com/v1/sessions`（GET）、`DELETE /v1/sessions/{session_id}`、`POST /v1/sessions/{session_id}/archive` | `Authorization: Bearer {oauth_token}`、`anthropic-beta: ccr-byoc-2025-07-29`、`x-organization-uuid` | #13514 の dotkrnl コメント（2026-04-04）。"I asked Claude Code to identify a way to delete them" | 本人は "working" と言うが未検証。"This is for the **remote** sessions." |
| C | `api.anthropic.com/v1/session_ingress/session/{id}`（取得）、`claude.ai/api/code/sessions`（curl では 403） | Bearer | #24106（2026-02、v2.1.37、2.1.42 で解消） | issue での観察のみ。CLI の一覧取得は `GET ${BASE_API_URL}/v1/sessions` だというコメントがある |
| D | `claude.ai/session-proxy/session_*`（削除時に 404 `not_found_error`） | — | #25249（2026-02-12、not planned でクローズ） | 当時の Web UI の削除経路と推測。現在も使われているかは不明 |
| 別製品 | Managed Agents `DELETE /v1/sessions/{session_id}`、`POST .../archive`（公開 API） | API キー、`managed-agents-2026-04-01` | platform.claude.com の session-operations | 公開ドキュメントあり。**claude.ai/code のセッションストアとは別物**（URL の形が似ているだけ。バックエンドが同じかは不明） |

A と B は同じ beta 値 `ccr-byoc-2025-07-29` を使う。ホスト（claude.ai と api.anthropic.com）と認証（cookie と OAuth Bearer）は違う。ブラウザ拡張から現実的に使えるのは A（same-origin + cookie）。

## Claude Code セッションの扱い

- ネイティブ（Web）では 1 件ずつしか消せない。アーカイブも 1 件ずつ。一括選択の公式記述はなく、changelog の確認範囲にも見当たらない。
- 公式の回避策（Claude にアーカイブを頼む）は Desktop のローカルセッション専用で、クラウドセッションは見えない。
- 既存ツールの対応状況
  - **imkarthikk のコンソールスクリプト（M1、エンドポイント A、全件削除型）**
  - **Redact（M3 アプリ、方式不明、有料範囲あり、フィルタが豊富）**
  - 上の 2 つしか見つからなかった。チェックボックスで選ぶブラウザ拡張で Code セッションに対応したものはない。
- Claude Cleaner v2 の "Cowork sessions" は Cowork タスクのことで、Code セッションではない。混同しないこと。
- 要望 issue は多いが、ほとんどが not planned / stale でクローズされている。
  - #47758（Web の個別削除、2026-04）
  - #69639（一括アーカイブ、2026-09 に stale でクローズ）
  - #70409（Code タブの一括削除、2026-08 に stale でクローズ）
  - #85704（重複としてクローズ）
  - #100777（2026-10-09、Open）
- 以上から、「Code セッションを選んで一括削除する」ブラウザ内ツールは事実上空白地帯と言える。

## 影響・トラブル事例

- アカウント警告・BAN・ストアからの削除: r/ClaudeAI と HN を狙ったクエリ（"reddit ClaudeAI bulk delete chats extension banned OR warning OR broke"、"news.ycombinator.com bulk delete claude chat"）で、報告は 0 件だった。不在の証明ではない。
- 規約: Anthropic Consumer Terms（2025-10-08 発効）§3 item 7 は、API キー経由か明示の許可がある場合を除き、"to access the Services through automated or non-human means, whether through a bot, script, or otherwise" を禁じている。文言上は M1・M2 とも該当しうる。拡張機能を名指しした条項はない。§7 は "Your use of any Third-Party Content, services, and integrations is at your own risk."
- 壊れた事例
  - Code セッションの Web 削除が 404 を返していた（#25249、2026-02）。ツールではなく製品側の不具合で、2026-08-17 に永久削除が shipped。
  - #13514 で 2026-09-02 に sevmardi が "perm delete is not happening" と報告している（VS Code で再起動するとアーカイブとして残る）。
  - #24106: CLI の teleport で "Session not found" が出た（2026-02）。
  - 通常チャットの API については、Jalalx gist のコメントで 2024-08〜2026-02 の間 "still working" の報告が続いている。429 対策（間隔を空ける）の注意はあるが、実際に失敗した報告はない。`delete_many` が増えたこと以外にエンドポイント変更の報告はない。
- 全ツール共通: 削除は取り消せない。サードパーティ拡張にはプライバシー上の注意点がある。
  - AI Toolbox は personal communications と auth info を開示している。
  - Folders & Bulk Delete は website content と auth info を開示している（「チャットは受け取らない」という申告と食い違う可能性）。

## 未確認事項

- "Chats and tasks" の Select に Code セッションが含まれないことを明言した公式文書・スクリーンショットはない（推定止まり）。cloud で走る長い Cowork タスクが Code セッションと同じストアかどうかも不明。
- claude.ai/code の Web UI に Shift+Click などの隠れた複数選択があるかは不明。#70409 の Shift+Click 発言は Desktop の話で、#85704 の bcherny 発言と矛盾している。
- changelog は 2.1.281〜2.1.306 の範囲しか読めていない（ページは約 107 万文字で、残りは未読）。範囲内に一括選択やセッション一覧の Web 機能の記載はなかった。2026-08-17 の「永久削除 shipped」に対応するバージョンは確認範囲外。claude.ai の Web UI の変更が CLI の changelog に載るとも限らない。
- エンドポイント A〜D の現在の動作、`delete_many` の上限（100 か 500 か）、レート制限の値。いずれも未実行のため不明。
- クローズドソース拡張（Bulk Delete for Claude、Delete Claude History、Claude Cleaner、Folders & Bulk Delete、tidoxonline、AI Toolbox、Claude Chat Cleaner、AI Chat Cleaner）の実際の方式。CRX を読んでいないため、M1 / M2 は推測か自己申告。
- Redact の内部方式（埋め込みブラウザか、cookie の扱い、どのエンドポイントか）。
- "GPT Cleaner — bulk delete ChatGPT and Claude conversations"（`geeffnkijdkakkebnfionlnpphklplka`）と "AI Chat Delete"（`genlcmjjklkkmclbgfbpagmehcnaphbo`）。ストアページを取得できなかったか、未取得。
- Managed Agents の `/v1/sessions` と claude.ai/code の CCR セッションが同じバックエンドかどうか。
