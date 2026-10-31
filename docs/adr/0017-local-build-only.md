# ADR-0017: 配布は行わず、ローカルビルドのみを使う

Created: 2026-10-30
Model: DeepSeek V4.1 Flash 1017
Status: Amended by [ADR-0019](0019-unsigned-dmg-releases.md)

2026-10-31: タグ作成時に署名なしの開発版 DMG を GitHub Releases で配布するため、配布と DMG に関する決定を ADR-0019 で改訂した。
ローカルの開発ビルドを署名なしで使う決定は残る。

## 背景

ADR-0014 は、Kataribe を DMG で配布し、Apple Developer ID Application で署名し、Apple の公証サービスで公証すると決めていた。
そのため、署名済みビルドの Gatekeeper、マイク権限、entitlement の確認をリリース前に必要としていた。

2026-10-30 に、Kataribe を配布する予定がないことを確認した。
利用者はローカルの開発ビルドを使い、第三者への配布、DMG の作成、Gatekeeper の警告なしの起動確認を必要としない。
署名と公証には Apple Developer Program の資格情報と外部サービスへの提出が必要であり、配布しない場合は維持する理由がない。

## 決定

以下を決定する。

- Kataribe は配布せず、ローカルの開発ビルドのみを使う。
- DMG の作成、Apple Developer ID Application での署名、Apple の公証、Gatekeeper の評価は行わない。
- `npm run package` は、ローカルで起動できる署名なしの `.app` を作るために残す。
- `Info.plist` の権限説明、`build/entitlements.mac.plist`、`scripts/verify-mac-bundle.cjs` は、将来配布する場合の参考として残す。
- `docs/release-checklist.md` は、配布する場合の参考として残す。
  現在のローカルビルドでは、ビルド、自動テスト、実機の録音確認だけを使う。
- bundle identifier とアプリアイコンの確定は、配布しない間は必須にしない。
- 将来配布する場合は、この ADR を改訂し、ADR-0014 の署名、公証、DMG の決定を再開する。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| 将来の配布に備えて署名と公証を続ける | 配布予定がないため、証明書の維持、公証の待ち時間、Gatekeeper の確認にコストをかける理由がない |
| 署名なしの DMG を配布する | Gatekeeper の警告が出る。配布しないため、DMG 自体を作る必要がない |
| ad-hoc 署名だけを行う | ローカル起動には署名が不要である。Gatekeeper の警告を避ける目的もない |
| Mac App Store で配布する | 配布予定がなく、サンドボックスと子プロセスの制約も増える |
| 配布用のチェックリストと entitlement を削除する | 将来配布する可能性がゼロではない。実装済みの検査を残しても、現在の開発を妨げない |

## 結果

- Apple Developer Program、Developer ID、公証の資格情報を用意する必要がなくなる。
- ローカルビルドは署名なしで起動する。
  マイク権限は、利用者の Mac で署名なしのアプリに対して個別に許可する。
- Gatekeeper と公証の確認は、現在の完了条件から外れる。
- `npm run verify:mac` は、署名以外の `Info.plist`、entitlement、同梱物、アプリサイズ、desktopCapturer の残存を引き続き検査できる。
- 配布を再開する場合は、bundle identifier、アイコン、署名、公証、Gatekeeper、自動更新の有無を改めて決める必要がある。
