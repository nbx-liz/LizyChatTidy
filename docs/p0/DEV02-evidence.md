# DEV02 根拠メモ — 公開API・規約・公開範囲（操作別）

> 本メモは証拠収集であり、法的助言・最終判定ではない。「許容」と書くのは引用文がそう読める範囲に限る。

## 1. 調査条件

- 取得日: 2026-10-22（全項目共通）
- 方法: WebFetch（公開ページのみ）と WebSearch。ログイン、ブラウザ自動操作、実アカウントでの試験は行っていない。
- 制約（重要）:
  - **openai.com / help.openai.com は全URLで HTTP 403**（S01, S03, S11, `/policies/terms-of-use/`, `/ja-JP/` 版, revisions 版）。web.archive.org も取得不可。
  - そのため OpenAI 規約の逐語引用は **第三者ミラー**（open.windriver.com、2024-12-11版の写し）からのみ。現行版（検索結果では "Effective: January 1, 2026" 表示あり）は一次確認できていない。
  - S01/S03 の内容は **検索結果スニペット経由**で、逐語性は保証しない（下表では「スニペット」と明記）。
  - WebFetch は要約モデルを通すため、引用は短文に限定。取得内容に不審な指示は含まれていなかった。
- 引用は原文英語・2文以内。

## 2. S01–S13 再確認表

| ID | URL | 状態 (2026-10-22) | 確認論点との一致/差分 |
|---|---|---|---|
| S01 | help.openai.com/en/articles/8809935-… | **403（直接取得不可）**。検索結果に同記事が複数タイトルで出現 | スニペット上は一致: 「••• → Delete → 確認」、アーカイブは削除でない。追加: 削除は30日以内に完全削除、Settings > Data controls に「全チャット一括削除/アーカイブ」がある旨（help-lb.openai.com ミラーのスニペット）。記事タイトルが変わっている可能性（"How to delete and archive chats…", "How chat retention works…"）。**一次再確認が必要** |
| S02 | code.claude.com/docs/en/claude-code-on-the-web | 取得可 | 一致。"Deleting a session permanently removes the session and its data. This action can't be undone." / "You will be asked to confirm before a session is deleted." 差分: サイドバーからの削除は **アーカイブ済みフィルタ表示時のみ**、他はセッションメニュー > Delete。`--remote` は `--cloud` の非推奨エイリアスに変更 |
| S03 | help.openai.com/en/articles/7260999-… | **403**。検索結果で存在確認 | スニペット上: ZIPに "chat history and other relevant account data"、リンク24時間で失効、最大7日。ファイル名（conversations.json 等）は公式記事に記載なし（第三者のみ）。プラン別可否は未確認 |
| S04 | developers.openai.com/api/docs/guides/conversation-state | 取得可 | 一致。"works with the Responses API to persist conversation state…"。ページはChatGPTに言及せず、list/delete エンドポイントも本ページには無い |
| S05 | developer.chrome.com/…/content-scripts | 取得可 | 一致。"read details of the web pages the browser visits, make changes to them"。isolated world、悪意あるページへの注意あり |
| S06 | developer.chrome.com/…/activeTab | 取得可 | 一致。"revoked when the user navigates away or closes the tab"、同一サイト内遷移は維持、別サイトで失効 |
| S07 | developer.chrome.com/…/service-workers/lifecycle | 取得可 | 一致。30秒アイドル/5分要求/30秒fetchで終了、"Any global variables you set will be lost…" |
| S08 | developer.chrome.com/…/api/storage | 取得可 | 一致。session はメモリ上で再起動等で消去、sync は約100KB、"If you're working with sensitive user data, instead use storage.session"。暗号化の記載なし |
| S09 | developer.chrome.com/docs/webstore/program-policies/user-data-faq | 取得可 | 一致。"Extensions are required to disclose how they handle user data, even when data is processed or stored locally" |
| S10 | developer.chrome.com/…/migrate/remote-hosted-code | 取得可 | 一致。RHC禁止、JSON/CSS等の「データ」は対象外。リモート設定（例: セレクタJSON）の扱いは明記なし |
| S11 | openai.com/policies/row-terms-of-use/ | **403** | 一次未確認。ミラー(2024-12-11版)と検索結果で自動抽出条項の存在を確認（§4.1）。現行版の日付・文言差分は不明 |
| S12 | www.anthropic.com/legal/consumer-terms | 取得可（Effective Oct 8, 2025） | 自動アクセス条項は一致。**差分**: 「地域別適用条件を含む」とあるが、今回取得では EEA/UK/CH 等の地域別適用文は見当たらず、地域言及は Supported Regions Policy 参照と「Brazil, Mexico, South Korea, or Taiwan」居住者の解約権のみ。/legal 索引にも地域別消費者規約は掲載なし |
| S13 | code.claude.com/docs/en/legal-and-compliance | 取得可 | 一致（Free/Pro/Max=Consumer、Team/Enterprise/API=Commercial、名称・ロゴ）。**追加論点**: 認証情報の扱い "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" |

補足: anthropic.com/legal 索引上、Usage Policy と Supported Regions Policy の日付が "Nov 12, 2026"（取得日より未来）と表示。改定予告の可能性があり、公開前に再確認が必要。

## 3. 公式API・エクスポート

### 3.1 ChatGPT（Web, 一般ユーザー）

| 操作 | 公式手段 | 根拠・注記 |
|---|---|---|
| 一覧 (a) | 公式ドキュメント中に一般ユーザー向けAPIは見つからず（not found in official docs） | 一次ページ403のため探索範囲が限定的 |
| 読取 (b) | 公式データエクスポート(ZIP)（S03、スニペット）。APIではなく、メールでリンク受領 | "The downloaded ZIP file includes your chat history and other relevant account data."（スニペット） |
| 削除 (c) | UI上の個別削除・Settings > Data controls の一括削除（S01、スニペット）。一般ユーザー向け削除APIは見つからず | スニペットに "not retrievable through the UI, APIs, or support" とあり、APIでの扱いに触れるが削除APIの存在を示すものではない |
| 参考: Compliance API | ChatGPT Enterprise/Edu のワークスペース向け。OpenAI公式発表では 2025-12 に Compliance Logs Platform に統合（検索結果） | 第三者資料ではOpenAIの審査を経てキー単位で付与、read scope。**個人プラン対象外**、エンドポイント公式リファレンスは未取得 |
| 参考: Conversations API (S04) | Responses API 用の会話状態管理 | ChatGPT 履歴との接続はページに記載なし。同一視しない |

### 3.2 Claude Code on the web（claude.ai/code クラウドセッション）

| 操作 | 公式手段 | 根拠・注記 |
|---|---|---|
| 一覧 (a) | Web サイドバー。CLI `claude --teleport`（引数なし）が "interactive session picker" を表示。`/tasks` も一覧表示 | 非対話の一覧出力（JSON等）は公式docsに見つからず。`claude agents --json` はローカルのバックグラウンドセッション対象 |
| 読取 (b) | `claude --teleport <session-id>` が "loads the full conversation history into your terminal"（同一アカウント・同一リポジトリ・clean git が条件） | 拡張機能から使える経路ではない。データエクスポート (support.claude.com 9450526) は "conversation data and the user data" とのみ記載し、Claude Code / クラウドセッションに言及なし → **含まれるか不明** |
| 削除 (c) | Web UI のみ（S02）。CLI に クラウドセッション削除コマンドは見つからず | `claude rm <id>` はローカルのバックグラウンドセッション用、`claude purge` はローカル状態の削除。いずれもクラウドセッション削除ではない |
| 書込（参考） | `claude -p "msg" --cloud <session-id>` で既存セッションへメッセージ投入 | 本件のスコープ外だが、公式CLI経由のセッション操作が存在する例 |

## 4. 規約条項

### 4.1 OpenAI Terms of Use（S11）

出典: 一次URL 403 のため、第三者ミラー https://open.windriver.com/info/uni-license-list/licenses/openai-tou-20241211.html（"Effective: December 11, 2024"）。現行版は検索結果上 "Effective: January 1, 2026" 表示あり、同条項は検索結果でも出現（逐語未確認）。

- **OA-1（自動抽出）**: "Automatically or programmatically extract data or Output (defined below)."（"What you cannot do" 項）
- **OA-2（妨害・回避）**: "Interfere with or disrupt our Services, including circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations we put on our Services."
- **OA-0（柱書）**: "You may not use our Services for any illegal, harmful, or abusive activity. For example, you may not:"
- 適用版・地域: ミラーに "If you reside in the European Economic Area, Switzerland, or the UK, your use of the Services is governed by these terms." とある。ROW 版ではこの "these terms" が別文書（EU版）へのリンクである可能性が高いが、ミラーではリンク先が失われており確定できない。**日本居住者に ROW 版が適用されるという明示文は今回確認できず**（推定にとどまる）。EU 版に OA-1 が同文で存在するかは未確認。
- "Output" の定義文はミラーから未取得。OA-1 の "data" が利用者自身の会話データを含むかは条文上の解釈問題で、本メモでは判断しない。

### 4.2 Anthropic Consumer Terms（S12, Effective Oct 8, 2025）— Free/Pro/Max に適用（S13）

- **AN-1（自動アクセス, §3 item 7）**: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- **AN-2（収集, §3 item 4）**: "To crawl, scrape, or otherwise harvest data or information from our Services other than as permitted under these Terms."
- 範囲: "govern your use of Claude.ai, Claude Pro, and other products and services … that we may offer for individuals"。Claude Code を名指ししないが、S13 が Free/Pro/Max の Claude Code 利用に本規約を適用と明記。
- 地域: §3 で Supported Regions Policy を参照、§6(4) で Brazil/Mexico/South Korea/Taiwan 居住者の解約権。EEA/UK/日本向け別版は /legal 索引に無し（§2 S12 差分参照）。
- 所有: "you retain any right, title, and interest that you have in the Inputs you submit"（§4）。データ所有と自動アクセス可否は別条項。

### 4.3 Anthropic Commercial Terms（Effective Jun 17, 2025）— Team/Enterprise/API に適用（S13）

- 自動アクセス・スクレイピングを名指しする条項は**本文に見当たらず**（WebFetch 要約）。D.2 で Usage Policy を参照（"Customer and its Users may only use the Services in compliance with these Terms"）、D.4 は競合製品構築・リバースエンジニアリング等を制限。
- Usage Policy 本文（Nov 12, 2026 表示）は今回未精査 → 未解決事項。
- 本ページ自体は Team/Enterprise を名指ししない（S13 側で対応付け）。

### 4.4 Anthropic Claude Code 認証情報条項（S13）

- **AN-3**: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- 設計含意（読み取り）: 拡張機能が Cookie/セッショントークンを読み取り・保存・中継する方式は、この文言に抵触し得る。DOM 読取とは別の論点として扱う。

## 5. 操作別の根拠表（O1–O4 × サービス）

凡例: 「明示的に許容」「明示的に制限の可能性」「記載なし/不明」。最終的な法的結論ではない。

| 操作 | ChatGPT (Web) | Claude Code on the web |
|---|---|---|
| **O1** 公式エクスポートファイルの取込（サービスに非アクセス） | S03 / OA-1。**記載なし/不明**: 条文は利用者手元のエクスポートファイルの取込に言及しない（取込はサービスへのアクセスを伴わない）。OA-1との関係を明示する文は無い | 9450526 / AN-1,AN-2。**記載なし/不明**: エクスポートにクラウドセッションが含まれるか自体が未確認。含まれない場合 O1 はこのサービスに成立しない |
| **O2** 閲覧中ページのDOMから一覧/タイトルを content script で読取 | OA-1。**明示的に制限の可能性**: "Automatically or programmatically extract data" はDOM経由の機械的取得を文言上除外していない。利用者自身のデータ・閲覧中という事情を例外とする文は無い | AN-1, AN-2。**明示的に制限の可能性**: 人間の閲覧中であってもスクリプトによる取得が "automated or non-human means" / "harvest data" に当たるか条文上未解決。"explicitly permit" の許可は見つからず |
| **O3** 特定会話ページ/公式削除ダイアログを開く補助（確定は利用者） | OA-1, OA-2。**記載なし/不明**: ページ遷移・ダイアログ表示自体を扱う条項は無い。OA-1 は「抽出」、OA-2 は「妨害・回避」で、遷移補助が該当するか文言からは判断不能 | AN-1。**明示的に制限の可能性**: O3 は遷移のみで、"access the Services through automated … means" との文言上の直接対応は無いが、除外する文も無い。確定操作を利用者が行う点を例外とする文は無い |
| **O4** 削除確定ボタンの自動クリックを連続実行（一括自動削除） | OA-1, OA-2。**明示的に制限の可能性**: 抽出ではないが、OA-2 "circumvent any rate limits or restrictions or bypass any protective measures" に確認ダイアログの自動通過が当たるか未解決。公式の一括削除（Data controls）が存在する点は代替手段として記録 | AN-1。**明示的に制限の可能性**: O4 はスクリプトによる確定操作で、"through a bot, script, or otherwise" の文言に直接対応する操作。S02 の確認ステップ・不可逆性も踏まえ、許可文は見つからない |

## 6. Chrome Web Store 制約

| 論点 | 根拠（短い引用） | 設計への含意 |
|---|---|---|
| ローカル処理でも開示・ポリシー | S09: "…even when data is processed or stored locally" / "requires all Products that handle user information to post a privacy policy." | PRIVACY 文書とストア開示は必須 |
| 目立つ開示 | S09 FAQ10: "must not be located only in a privacy policy, terms of service, or similar document." | UI内で同意前に表示 |
| ページ内容の読取はユーザーデータ | S09 FAQ2: "Clipping or scraping content from a website that the user visits"、FAQ4: "Website content and resources" | 会話タイトル/本文の読取は開示対象 |
| 閲覧履歴の扱い (Limited Use) | "Collection and use of web browsing activity is prohibited" + "except to the extent required for a user-facing feature" "described prominently in the Product's Chrome Web Store page and in the Product's user interface." | 対象サイト以外の履歴は収集しない、機能説明を明示 |
| 単一目的 | "An extension must have a single purpose that is narrow and easy to understand." | 「整理」と「削除」を同一目的として説明できるか要検討 |
| 誤認・なりすまし | "don't represent that your product is authorized by, endorsed by, or produced by another company…"、S13 名称ロゴ条項 | 非公式であることを明示 |
| 期待通りの結果 | "The outcome of any user interaction should match the reasonable expectations…" | 自動削除の範囲・不可逆性を明示 |
| 第三者サイト | "Do not facilitate unauthorized access to content on websites…" / "harms or interferes with the operation of … any third-parties." | 第三者サイト自動化を直接扱う条項は見つからず。第三者規約違反を審査理由とする明文も見つからず（不明） |
| 最小権限 | "Request access to the narrowest permissions necessary…" | host 権限を2オリジンに限定、activeTab の失効挙動（S06）に留意 |
| リモートコード | S10: RHC 禁止、"It does not include data or things like JSON or CSS."；ポリシー: "Developers must not obfuscate code or conceal functionality" | 削除ロジック同梱。リモート配信のセレクタ設定が「データ」か「機能隠蔽」かは不明 → 同梱が安全側 |

## 7. 未解決事項と確認が必要な点

1. **OpenAI 規約の一次確認不能**: S11/S01/S03 が 403。現行版（2026-01-01 表示?）の OA-1/OA-2 逐語、"Output" 定義、日本居住者への適用版（ROW 版か）を、所有者が通常ブラウザで目視確認し保存する必要がある。
2. **O2（DOM読取）の位置付け**: OA-1 "programmatically extract" と AN-1/AN-2 が、利用者自身が閲覧中の画面からの読取に及ぶかは条文から決まらない。OpenAI/Anthropic への問い合わせ、または専門家（法務）の確認が必要。
3. **O3/O4 の自動操作**: AN-1 の "explicitly permit" に当たる許可が無い。OA-2 の「保護措置の回避」に確認ダイアログ自動通過が当たるか不明。許可が得られない限り自動確定は停止扱いを推奨（DEV02完了条件「未解決は停止扱い」に従う）。
4. **Claude エクスポートの範囲**: クラウドセッションが含まれるか公式記載なし。所有者の実エクスポートで確認が必要（O1 の成否に直結）。
5. **S12 の「地域別適用条件」差分**: 今回のページには EEA/UK/日本向け記述なし。前回確認時の記述の出所（別ページか、改定か）を所有者が確認。
6. **Usage Policy（Nov 12, 2026 表示）と Supported Regions Policy**: 未精査。Team/Enterprise 利用者の自動アクセス可否は Commercial Terms 本文に明記が無く、Usage Policy 次第。
7. **AN-3 認証情報条項**: 拡張がセッショントークン/Cookie に触れない設計であることを権限ADRで明示すべき。
8. **ChatGPT 公式一括削除（Data controls）の存在**: スニペットのみ。存在すれば O4 の代替として案内できるが一次確認が必要。
9. **Chrome 単一目的・リモート設定**: 整理+削除の単一目的適合、リモートJSON設定の扱いは One Stop Support 等への確認候補。
