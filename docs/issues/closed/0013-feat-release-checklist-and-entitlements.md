# リリースチェックリストと署名済みビルドの権限検証を整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-30
優先度: P1
対応 ADR: ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)、ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: 非機能要件の配布と権限
依存: 0009、0010

## 背景

issue 0005（保留中）、0006、0007 はリリースチェックリストへの追記を完了条件にしているが、チェックリストを作る issue がない。
ADR-0014 は hardened runtime で必要な entitlement の一覧を未決事項にしている。
M0 は署名なしの Electron で検証しており、署名と公証をしたビルドでマイクと BlackHole 2ch を取得できるかは確認していない。

## 目的

署名と公証をしたビルドのリリースチェックリストを作り、マイク、BlackHole 2ch、画面収録権限、entitlement を検証する。

## やること

- `docs/release-checklist.md` を作る。
- チェックリストに、ビルド、署名、公証、Gatekeeper、マイク権限、BlackHole 2ch の検出と取得、画面収録権限のダイアログが出ないこと、ffmpeg と whisper.cpp の子プロセス、モデルのダウンロード、子プロセスの終了、アプリサイズ、BlackHole 2ch を同梱していないこと、ライセンス表示を入れる。
- hardened runtime の entitlement に `com.apple.security.device.audio-input` を入れ、必要な entitlement の一覧を ADR-0014 に記録する。
- 署名済みビルドで、マイク権限のダイアログと BlackHole 2ch の取得を確認する。
- 画面収録権限のダイアログが出ないことを確認する。
- 余力があれば、開発ツールのない Mac で配布ビルドを確認する。
- README からリリースチェックリストへのリンクを置く。

## 完了条件

- `docs/release-checklist.md` がある。
- README からリリースチェックリストに到達できる。
- 署名と公証をしたビルドが Gatekeeper の警告なしに起動する。
- 署名済みビルドで、マイクと BlackHole 2ch の音声を取得できる。
- 署名済みビルドで、画面収録権限のダイアログが出ない。
- チェックリストに、BlackHole 2ch を同梱していないこと、ライセンス表示、アプリサイズの確認がある。
- ADR-0014 に entitlement の一覧が記録されている。

## 進捗

2026-10-29 に、署名と公証の資格情報がなくても確認できる範囲を実装した。

- `build/entitlements.mac.plist` に、`com.apple.security.device.audio-input` と Electron の hardened runtime に必要な 4 つの entitlement を追加した。
- `scripts/verify-mac-bundle.cjs` を追加した。
  `Info.plist`、entitlement、README とトレイ画像の同梱、BlackHole のバイナリの有無、desktopCapturer と getDisplayMedia の残存、アプリサイズを検査する。
  署名済みビルドでは、`codesign` と Gatekeeper の検査も行う。
- `npm run verify:mac` と `npm run verify:mac:release` を追加した。
- README とリリースチェックリストに検査コマンド、entitlement、署名、Gatekeeper、desktopCapturer の確認項目を追加した。
- ADR-0014 に entitlement の一覧と、署名済みビルドでの確認が残っていることを記録した。

未完了:

- Apple Developer ID Application での署名と、Apple の公証サービスへの提出。
- Gatekeeper の警告なしの起動確認。
- 署名済みビルドでのマイク権限、BlackHole 2ch の取得、画面収録権限のダイアログが出ないことの確認。
- 子プロセス、モデル、ライセンス表示の確認は、それぞれの実装後に行う。

## pending にした理由

Apple Developer ID Application の証明書と Apple の公証サービスの資格情報が、この実行環境にない。
そのため、署名と公証をしたビルドの Gatekeeper、権限、entitlement の実適用を確認できない。

ローカルでできる範囲は実装済みである。

- リリースチェックリスト
- entitlement の一覧と `build/entitlements.mac.plist`
- `scripts/verify-mac-bundle.cjs`
- README と ADR-0014 の更新

資格情報が用意できたら `docs/issues/` に戻し、署名と公証をしたビルドで残りの完了条件を確認する。

## 解決方法

2026-10-30 に、Kataribe を配布する予定がないことを確認した。
ADR-0017 で、DMG の作成、Apple Developer ID Application での署名、Apple の公証、Gatekeeper の評価を行わないと決めた。

- 署名と公証をしたビルドの検証は、配布しないため対象外とする。
- Gatekeeper の警告なしの起動確認も対象外とする。
- `docs/release-checklist.md` は、将来配布する場合の参考として残す。
- ローカルビルドでは、`npm run verify:mac`、実機の録音確認、回帰テストを使う。
- `Info.plist`、entitlement、`scripts/verify-mac-bundle.cjs` は将来の配布に備えて残す。
- 未完了だった署名、公証、Gatekeeper、署名済みビルドの権限確認は、配布しないため不要になった。

## 参照

- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0004-child-processes-for-media-processing.md`
- `docs/adr/0006-whisper-cpp-and-model-management.md`
- `README.md`
