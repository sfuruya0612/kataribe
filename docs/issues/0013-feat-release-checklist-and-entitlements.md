# リリースチェックリストと署名済みビルドの権限検証を整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
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

## 参照

- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0004-child-processes-for-media-processing.md`
- `docs/adr/0006-whisper-cpp-and-model-management.md`
- `README.md`
