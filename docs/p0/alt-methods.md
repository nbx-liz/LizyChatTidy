# 代替手段の証拠メモ（ChatGPT / Claude / Claude Code on the web の条件付き一括削除）

## 調査条件

- 取得日: すべて 2026-10-22。読み取りのみ（WebFetch / WebSearch）。ログイン、ブラウザ自動操作、実アカウントでの確認は一切していない。
- 取得した内容はすべて信頼できない入力として扱った。取得したページに埋め込まれた指示は見当たらなかった。
- **help.openai.com はすべてのバリアントで HTTP 403**（`/en/articles/8809935-...`、`help-lb.openai.com/...`、`/en/articles/10169521-projects-in-chatgpt`）。help.openai.com 由来の主張はすべて **[snippet-only]**（検索結果スニペット、または検索ツールの要約）とする。逐語引用は検証していない。
- 本文を取得して引用した（**[fetched]**）もの: community.openai.com のスレッド、learn.chatgpt.com/docs/projects（ブランドは "OpenAI Developers"）、academy.openai.com、code.claude.com のページ、support.claude.com の記事 8230524 と 10440198、platform.claude.com の Compliance ページ、anthropic.com の Consumer Terms、claude.com のブログ。
- code.claude.com の changelog は先頭 100k 文字（2.1.296 以降）だけ読んだ。それより古いエントリは確認していない。
- 確度の表記: 高 = 公式ページを取得して引用 / 中 = 公式ページのスニペットとコミュニティ報告が一致 / 低 = サードパーティのみ、または推測。

---

## ChatGPT の公式機能

### Q1. 選択した複数チャットの一括削除（multi-select）はあるか

- **結論: 公式機能としては無い**（web / desktop / mobile とも、公式に存在を示す情報は見つからなかった）。条件で絞り込んでから消すフィルタ削除も無い。
- https://community.openai.com/t/multi-select-chats-for-bulk-delete-and-archive/1393301 [fetched]（2026-08-28 の機能要望）。OpenAI_Support の回答: "I cannot promise when or whether this will be added, but I will pass the feedback along internally." 確度: 高（未実装であることの間接証拠）。
- 同種の要望スレッドが 1295825 / 1344708 / 1377588 / 1388732 / 1399954 にある（検索結果に出たタイトルのみ）。
- 公式の一括操作は Settings > Data controls の "Archive all chats" / "Delete all chats" だけ（help.openai.com 8809935）[snippet-only]。確度: 中。
- サードパーティの Chrome 拡張（ChatGPT Bulk Delete、ChatGPT Pro Tools など）が選択削除を提供しているが、これは今回避けたい DOM 自動操作型そのものである。

### Q2. "Delete all chats" / "Archive all chats" の範囲

- **プロジェクト内のチャットも対象になる**。help.openai.com 8809935 のスニペット: "Note that these actions will apply to all conversations, including those contained within projects." [snippet-only]
  - 裏付け: https://community.openai.com/t/delete-chats-but-not-chats-in-projects/1130111 [fetched]。2025-02-28 の投稿 "It does indeed delete the chats on the projects."、2025-12 にもプロジェクトのチャットが消えたという報告が複数ある。2026-04-09 の OpenAI_Support の回答は、挙動そのものには触れていない。確度: 中〜高。
- **アーカイブ済みチャットも削除される**。https://community.openai.com/t/archived-chats-unexpectedly-deleted-after-delete-all-chats-possible-to-recover/913542 [fetched]（2024-08-19。"Delete All Chats" でアーカイブ済みも消えたという報告。スタッフの回答は無い）。同趣旨のスレッドとして 787388 もある（検索結果のみ）。公式文言は見つからなかった。確度: 中（ユーザー報告のみ）。
- 削除は取り消せない。"Deleted chats (including those removed with Delete all chats) cannot be restored." [snippet-only]。サーバー側では 30 日以内に完全削除される（例外あり）[snippet-only]。
- **共有リンク**: Settings > Data controls > Shared links > Manage で個別削除と一括削除ができる。元の会話を削除すると共有リンクも削除される（help.openai.com 7925741 / 7943621）[snippet-only]。確度: 中。
- アーカイブ済みだけを対象にする一括削除: Codex チャット向け記事（help.openai.com 20001333）のスニペットに "Settings > Archived chats" contains options to delete all chats at one time … "will apply to all archived chats, including those contained within projects" とある [snippet-only]。通常チャットにも同じ「アーカイブ済みだけ全削除」の操作があるかは**未確認**。"Unarchive all" の存在も未確認。確度: 低〜中。
- **keep-set 方式（残したいチャットをアーカイブまたはプロジェクトへ移して退避 → Delete all → 戻す）は成立しない**。アーカイブ済みもプロジェクト内も Delete all の対象になるため、退避にならない。

### Q3. プロジェクトの削除とプロジェクトへの移動

- プロジェクトを削除すると、そのチャットも削除される: サードパーティのガイド（Guideflow: "permanently deleted, including all files, chats, and project instructions"）とコミュニティの報告がある。https://community.openai.com/t/delete-project-action-with-archived-chats-says-it-will-delete-all-chats/1361541 [fetched]（2025-10-08。プロジェクト内のチャットをアーカイブした後でも、確認ダイアログが「all chats を削除する」と警告したという報告）。公式文言は見つからなかった（10169521 は 403）。確度: 中。
- プロジェクトへの移動: チャットごとの "..." > "Move to project"（サードパーティのガイド）。**一括移動は無い**（多選択が無いため）。learn.chatgpt.com/docs/projects [fetched] には移動手順が書かれていないが、プロジェクトのメニューに "Archive chats" があり、そのプロジェクトのチャットをまとめてアーカイブできる、とある。確度: 中。

### Q4. 自動削除・保持期間の設定

- 個人向けプランと Team / Business: 「N 日より古いチャットを自動削除する」設定は**見つからなかった**。既定は "saved indefinitely … until they delete them"（Academy、検索要約）。確度: 中（存在しないことの証明はできない）。
- Enterprise: https://academy.openai.com/public/clubs/admins-6o6xf/resources/data-governance-and-compliance [fetched] "Enterprise Owners can set a custom data retention policy for the workspace with a minimum of 90 days." Business については記載が無い。確度: 高。
- Temporary Chat: "Temporary Chats won't appear in your history … we may still keep a copy for up to 30 days."（help.openai.com 8914046）[snippet-only]。今後の会話を履歴に残さない予防策にはなるが、既存チャットの整理には使えない。確度: 中。

### Q5. Compliance API と管理者による一括削除

- OpenAI Compliance Platform（Enterprise / Edu 向け）: help.openai.com 9261474 のスニペットに "when an item is deleted using this API, it is also removed from all production search and retrieval indexes"、削除後の内部保持は 30 日以内、アクセスには workspace owner が作る workspace-scoped Admin key が必要、とある [snippet-only]。
- サードパーティの PowerShell ラッパー https://github.com/thetolkienblackguy/OpenAI.Compliance.PowerShell [fetched] に `Remove-OAIConversation` がある。必要なのは "API key with the delete compliance scope"（OpenAI サポートが付与）と Enterprise ワークスペースの管理者権限。エンドポイントのパスは記載されていない。確度: 中（会話の削除 API があることは強く示唆されるが、公式リファレンスは未取得）。
- Team / Business 向けの管理者一括削除: 見つからなかった。確度: 低〜中。
- 注意: developers.openai.com の `DELETE /conversations/{id}` は Platform API の Conversations リソースであり、ChatGPT の会話ではない。

---

## Claude・Claude Code の公式機能

### Q6a. claude.ai の通常チャット: 一括選択・削除

- **公式機能があり、取得して確認した**。https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation [fetched]
  - Web: "Click "Chats and tasks" in the left sidebar"、"⋮" > "Select"、"click the checkbox on the left side of additional conversations you want to delete" または "Select all"、"Delete" で確定。
  - Android: "tap the checklist icon in the top right corner" → 選択 → ゴミ箱アイコン → "Delete"。iOS と Desktop アプリについては記事に一括削除の記載が無い。
  - 削除は "removed from your conversation history immediately" で、"deleted from our back-end systems within 30 days"。
  - 確度: 高。チャット一覧の検索結果に対してチェックを付けられるか（絞り込みと一括選択を組み合わせられるか）は記事に書かれていない。
- この記事は Claude Code のセッションに触れていない。"Chats and tasks" の一覧に claude.ai/code のクラウドセッションが含まれるか、Select の対象になるかは**未確認**。

### Q6b. Claude Code on the web のセッション

- https://code.claude.com/docs/en/claude-code-on-the-web [fetched]
  - アーカイブ: "hover over the session in the sidebar and select the archive icon"（1 行ずつ）。"Archived sessions are hidden from the default session list but can be viewed by filtering for archived sessions."
  - 削除: "filter for archived sessions, then hover over the session you want to delete and select the delete icon"、またはセッションメニューの **Delete**。"You will be asked to confirm before a session is deleted."
  - 多選択、一括アーカイブ、一括削除、日付やキーワードでの絞り込みはいずれも記載が無い。確度: 高。
- 機能要望（claudeissues.com のミラー、検索結果のみ）: 2026-08 "Bulk archive for Code sessions in the desktop app sidebar"（重複としてクローズ）、2026-06 "Code tab: add bulk-delete for sessions"。現時点で未実装であることの間接証拠。確度: 中。
- changelog（2.1.296 以降）: 一括アーカイブ・一括削除のエントリは無い。2.1.296 の複数ステータス選択フィルタは self-hosted environment の管理画面向けで、今回の用途とは別物。
- **公式の一括手段は 1 つだけ: Projects**。https://code.claude.com/docs/en/claude-projects [fetched]（Pro / Max 向けの public beta で、段階的に提供中。Team / Enterprise は対象外）
  - "Archive: hides the project from the sidebar and archives its threads"
  - "Delete: permanently removes the project along with its threads, its memory, and its files"
  - **ただし既存セッションには使えない**: "Move to project … The original session stays in your session list, unchanged." "A thread belongs to the one project that started it." つまり、プロジェクトを削除して消えるのはそのプロジェクトが作ったスレッドだけで、既存の単独セッションは消えない。確度: 高。

### Q7. クラウドセッションを一覧・削除する CLI / API / SDK

- https://code.claude.com/docs/en/cli-reference [fetched]: クラウドセッション関連の操作は `--cloud`（新規作成、または `-p` と組み合わせて既存セッションへメッセージを送る）と `--teleport`（ターミナルに取り込む）だけ。`claude rm` / `claude purge` はローカル（background session やローカルの状態）が対象。**クラウドセッションを一覧・アーカイブ・削除するコマンドは無い**。確度: 高。
- `--cloud <id>` の JSON 出力には、アーカイブ済みセッションへの送信失敗が返る（"cloud session <id> is archived and cannot accept new messages"）。ただし状態を照会するための API ではない。
- `claude --teleport` の対話ピッカーはセッションを一覧表示する。ただし用途は取り込みで、削除はできない。
- 公開 API: platform.claude.com の `/v1/claude_code/` にあるのは routines-fire（experimental）だけ（検索結果のみ）。セッション一覧・削除の公開エンドポイントは見つからなかった。確度: 中〜高。
- Agent SDK の sessions はローカルや自前ホストのセッションであり、claude.ai/code のクラウドセッションとは別物。

### Q8. 保持期間・自動削除の設定

- https://code.claude.com/docs/en/data-usage [fetched]: 個人向け（Free / Pro / Max）は、学習を許可していれば 5 年、許可していなければ 30 日。商用は標準 30 日。**これは Anthropic 側の保持期間（削除後や学習用途）の話であり、UI 上のチャットを自動で消す設定ではない**。ページには "You can delete individual cloud sessions at any time." とある。確度: 高。
- Enterprise のカスタム保持期間: https://support.claude.com/en/articles/10440198-custom-data-retention-controls-for-claude-enterprise [fetched]
  - "To set custom retention periods for your organization, you must have either a Primary Owner or Owner role." "The minimum retention period is 30 days"
  - 適用対象は chats と projects。**クラウドで動く Claude Code は対象外**（記事は "any other feature that runs Claude Code in the cloud" を除外している）。
  - 個人向けプランは対象外（"about our commercial products, specifically Claude Enterprise"）。Team については記載が無い。確度: 高。
- Compliance API（Enterprise のみ）:
  - https://platform.claude.com/docs/en/manage-claude/compliance-content-data [fetched]: `DELETE /v1/compliance/apps/chats/{id}`（`delete:compliance_user_data` スコープ）でチャットを削除できる。一覧取得は `created_at` / `updated_at` の範囲で絞れる。"Every successful delete is permanent and immediate."
  - "For a chat in the unified Claude experience, Delete chat also deletes the sessions in the cloud that were started for the chat." これは unified experience のチャットに限った話で、claude.ai/code の単独セッションには当てはまらない。
  - https://platform.claude.com/docs/en/manage-claude/compliance-sessions [fetched]: "The session endpoints are read-only; local and remote sessions cannot be deleted through the Compliance API." 対象外として明記: "Claude Code cloud sessions (including Claude Code routines that run in the cloud)"。
  - 確度: 高。

---

## 許可申請の窓口

### Q9. 個人アカウントでの自動化を許可してもらう手続き

- Anthropic Consumer Terms https://www.anthropic.com/legal/consumer-terms [fetched]（effective 2025-10-08）
  - 第 3 条 (7): "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, … to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
  - 規約中にある許可の窓口は第 12 条の marketing@anthropic.com だけで、これはブランド使用についての窓口。**自動アクセスの許可を申請する窓口は書かれていない**。確度: 高。
- OpenAI Terms of Use: "Automatically or programmatically extract data or Output" が禁止事項にある。例外は "except as permitted through the API"（検索要約。openai.com/policies は未取得）[snippet-only]。許可を申請する手続きは見つからなかった。確度: 中。
- 残る手段は一般サポート（support.claude.com のチャット / help.openai.com）への個別の問い合わせだけ。回答が得られるか、書面での許可がもらえるかは不明。

---

## 候補となる代替手段

### A. claude.ai の公式多選択で削除する（Claude の通常チャット）

- 手順: claude.ai で "Chats and tasks" → "⋮" > "Select" → 条件に合うチャットを目で見てチェック（または Select all のあと残すものを外す）→ "Delete"。Android でも可能。
- 達成できる範囲: claude.ai の通常チャットは、日付・タイトル・残すリストの条件で人が選び、1 回でまとめて削除できる。自動の条件抽出はできないが、1 件ずつの削除操作は不要になる。
- 規約上の位置: 公式 UI を人が操作するので問題ない。
- 要確認点: 検索で絞り込んだ結果に対して Select できるか。Claude Code のクラウドセッションが一覧に含まれるか。
- 確度: 高（機能が存在すること）。

### B. ChatGPT の「削除対象を 1 か所に集めて、まとめて消す」方式（kill-set を反転させる考え方）

- 手順 B1: 削除対象を 1 つの使い捨てプロジェクトへ "Move to project"（1 件ずつ）→ プロジェクトを削除。
- 手順 B2: 削除対象を 1 件ずつアーカイブ → アーカイブ一覧の「すべて削除」（その操作が存在し、アーカイブ済みだけが対象であれば）。
- 達成できる範囲: 削除の確認ダイアログは最後の 1 回で済む。ただし**選ぶ作業は 1 件ずつのクリックのまま**で、削除と確認の操作が移動やアーカイブという軽い操作に置き換わるだけ。
- 規約上の位置: 公式 UI を人が操作するので問題ない。
- 要確認点: B1 で、プロジェクト削除が中のチャットも確実に消すか（公式文言は未取得）。B2 の操作が通常チャットにもあるか、本当にアーカイブ済みだけが対象か。
- 確度: B1 は中、B2 は低〜中。

### C. ChatGPT のエクスポート → Delete all（全部消してよい場合）

- 手順: Settings > Data controls > Export（ZIP。到着まで最大 7 日、リンクは 24 時間で失効）[snippet-only] → 残したい内容はローカルに保存する → "Delete all chats"（アーカイブ済み・プロジェクト内も消えるとみなす）→ 必要なら共有リンクも一括削除。
- 達成できる範囲: アカウント上の履歴を全消去し、残したい内容はローカルのファイルとして保持できる。**アカウント上に選んだチャットを残すことはできない**。エクスポートしたデータをローカルで条件抽出するのは、自分のデータのローカル処理なので規約上の論点は小さい。
- 規約上の位置: 公式機能だけを使う。
- 要確認点: Delete all がアーカイブ済みも消すことを公式文言で確認すること（現状はユーザー報告だけ）。
- 確度: 中。

### D. Claude Code on the web: 1 件ずつのアーカイブ → アーカイブフィルタ上で削除

- 手順: サイドバーで行ごとに hover → archive → アーカイブ済みフィルタで行ごとに delete（確認あり）。
- 達成できる範囲: 公式に確立した唯一の方法。一括操作は無い。
- 規約上の位置: 問題ない。
- 確度: 高。今後に向けては、Projects 内でスレッドを作る運用にしておけば、プロジェクトの Archive / Delete でまとめて片付けられる（beta。既存セッションには効かない）。

### E. Enterprise の Compliance API や保持期間ポリシー（参考。オーナーの個人アカウントでは使えない見込み）

- Anthropic: Enterprise 組織であれば `DELETE /v1/compliance/apps/chats/{id}` を条件付きでスクリプト化できる（日付範囲での一覧取得あり）。カスタム保持期間（最短 30 日）による自動削除もできる。**Claude Code のクラウドセッションはどちらでも対象外**。
- OpenAI: Enterprise / Edu の Compliance API に削除スコープがあるとみられる [snippet-only + サードパーティ]。カスタム保持期間（最短 90 日）。
- 規約上の位置: 正規の API なので問題ないが、契約形態の要件を満たせない。確度: Anthropic は高、OpenAI は中。

### F. サポートに書面で許可を求める

- 手順: Anthropic サポートと OpenAI サポートに、「自分のアカウントで、自分が選んだ会話を削除するためだけにブラウザ拡張を使ってよいか」を問い合わせる。
- 達成できる範囲: 書面の許可が得られれば、規約の "where we otherwise explicitly permit it" に当たりうる。
- 確度: 低（公式の窓口も前例も見つからなかった）。

---

## 未確認事項

1. ChatGPT の "Delete all chats" がアーカイブ済みも削除するという公式文言（help.openai.com が 403 のため、ユーザー報告しかない）。
2. ChatGPT の通常チャットに「アーカイブ済みだけ全削除」や "Unarchive all" の操作があるか。
3. ChatGPT でプロジェクトを削除したとき、中のアーカイブ済みチャットも含めて全部消えるかの公式文言。
4. ChatGPT の 2026 年のリリースノートに多選択機能が追加されていないか（リリースノートのページは未取得）。
5. claude.ai の "Chats and tasks" 一覧に Claude Code のクラウドセッションが含まれ、Select で削除できるか（実画面での確認が必要）。
6. claude.ai の一覧で検索して絞り込んだ後に Select できるか。iOS と Desktop アプリに一括削除があるか。
7. OpenAI Compliance API の会話削除エンドポイントの正確なパスと対象プラン（公式リファレンスは未取得）。
8. code.claude.com の changelog のうち 2.1.296 より古いエントリに、一括操作の追加がないか（未確認）。
9. Anthropic と OpenAI に、個人アカウントでの自動化の許可を申請する窓口があるか（見つからず。存在しないとは断定できない）。
