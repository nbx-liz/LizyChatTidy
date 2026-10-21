# LizyChatTidy 開発ルール

## 文書の優先順位

BLUEPRINT.md > HISTORY.md > CLAUDE.md > docs/handoff/ > コード

- `docs/handoff/` は凍結した入力資料（v0.1.1）。改訂しない。整合性は CI が `SHA256SUMS.txt` で検査する。
- 仕様の変更は HISTORY.md に Proposal を追加してから実装する。

## 言語

- BLUEPRINT.md / HISTORY.md / CLAUDE.md は日本語。
- コード、コメント、commit メッセージ、PR、Issue は英語。

## 安全ルール

- 実会話・実エクスポート・認証情報をリポジトリ、Issue、PR、AI エージェントへ渡さない。試験は合成データで行う。
- 破壊的操作を実履歴で試さない。実サービスでの検証は、所有者が用意した使い捨て会話だけを対象に、所有者が実施する。
- 実画面での試験をモック試験で代替したと報告しない。未実施の試験は未実施と書く。
- BLUEPRINT §3 の不変条件を弱める変更は、Proposal と所有者の承認なしに行わない。

## マージ

lizy-reviewer の判定が APPROVE かつ CI が緑なら連続マージする（HISTORY.md D-0001）。
