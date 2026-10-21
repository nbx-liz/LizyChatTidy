# LizyChatTidy 開発資料パッケージ

版: v0.1.1（再生成版） / 作成日: 2026-10-21

## このパッケージについて

前回提示されたファイルの実体を確認できなかったため、会話に残る要件と成果物構成から再生成した。元ファイルの複製ではなく、同一内容・ページ数・出典数は保証しない。

対象はChatGPTとClaude Code **Web上**の履歴。通常のClaudeチャットやローカルJSONL管理へ置き換えない。OSSのChrome拡張として一般公開を想定する。

## 読む順番

1. START_HERE.md
2. LizyChatTidy_Developer_Handoff.docx または同名.md
3. IMPLEMENTATION_BACKLOG.md
4. ACCEPTANCE_TESTS.md
5. contracts.reference.ts / SOURCES.md

## 同梱物

- 開発引き継ぎ資料: WordとMarkdown。本文は同じ構成。
- 実装バックログ: DEV01〜14。全件未着手。
- 受け入れ仕様: AT01〜35。全件未実施。
- TypeScript型定義案: 実装コードではない。
- 公式資料一覧: 13件。
- CHANGELOG.md: 再生成の範囲と制約。
- SHA256SUMS.txt: 同梱ファイルの整合性確認用。

## 最初にすること

DEV01〜03のP0を進める。公式APIの適用、操作の許容範囲、全履歴取得、主体照合、更新状態、削除結果判定を未確認のまま実装済みとしない。

## 実施状態

拡張本体の実装、ログイン済み実画面での動作確認、会話削除、受け入れテスト、ストア審査、監査は未実施。このZIPはChromeへ読み込める完成アプリではない。

UTF-8のMarkdownを扱えるエディターで開ける。Word版は編集可能。資料を外部へ渡す際も個人の会話データを添付しない。
