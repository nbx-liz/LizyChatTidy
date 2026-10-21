# SOURCES

閲覧確認日: 2026-10-21 / 公式資料13件

本再生成版では下記のURLと関連記載を確認した。仕様や規約は変わり得るため、実装・公開時に再確認する。根拠がないAPI不存在の断定や、UI自動化の包括的許可の判断には使わない。

## S01 / OpenAI / Deleting and archiving chats in ChatGPT

URL: https://help.openai.com/en/articles/8809935-deleting-and-archiving-chats-in-chatgpt

確認論点: 個別削除、確認、アーカイブの位置付け。UIに削除機能があることと第三者向けAPIの存在は別。

## S02 / Anthropic / Use Claude Code in the cloud

URL: https://code.claude.com/docs/en/claude-code-on-the-web

確認論点: Delete sessions節。クラウドセッションの削除導線と確認、不可逆性。

## S03 / OpenAI / Exporting your ChatGPT history and data

URL: https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data

確認論点: 対象アカウントの公式ZIPエクスポート。取得範囲・プラン・形式は実データでも確認する。

## S04 / OpenAI / Conversation state

URL: https://developers.openai.com/api/docs/guides/conversation-state

確認論点: Conversations APIはResponses APIと組み合わせる会話状態管理。ChatGPTの既存Web履歴と同一視しない。

## S05 / Google / Content scripts

URL: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

確認論点: DOMの読み取り・変更と拡張へのメッセージ通信。DOM操作の可能性であり、サービスの自動操作許可ではない。

## S06 / Google / The activeTab permission

URL: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab

確認論点: 利用者の操作に伴う一時権限。同一オリジン内の遷移と別オリジンへの遷移を区別する。

## S07 / Google / The extension service worker lifecycle

URL: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

確認論点: Service Workerの終了とグローバル状態の消失。破壊的処理の自動再開を設計しない。

## S08 / Google / Storage API

URL: https://developer.chrome.com/docs/extensions/reference/api/storage

確認論点: local/session/syncの差、アクセス制限。本文の永続化やsyncを前提にしない。

## S09 / Google / Updated Privacy Policy & Secure Handling Requirements

URL: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq

確認論点: ローカルだけで扱う利用者データにも、開示とプライバシーポリシーが必要。

## S10 / Google / Deal with remote hosted code violations

URL: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code

確認論点: リモート実行コードに関する制約。削除ロジックを外部配信しない設計の参照。

## S11 / OpenAI / Terms of Use

URL: https://openai.com/policies/row-terms-of-use/

確認論点: 自動抽出等の条項。DOM収集・操作方式ごとに適用を確認し、適合を断定しない。

## S12 / Anthropic / Consumer Terms of Service

URL: https://www.anthropic.com/legal/consumer-terms

確認論点: 自動アクセス等の条項。取得ページは地域別適用条件を含む。利用者の地域・契約で適用版を特定する。

## S13 / Anthropic / Legal and compliance

URL: https://code.claude.com/docs/en/legal-and-compliance

確認論点: Free/Pro/MaxとTeam/Enterprise/APIの契約区分、名称・ロゴの扱い。
