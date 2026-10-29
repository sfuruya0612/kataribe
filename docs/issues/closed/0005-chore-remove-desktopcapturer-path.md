# desktopCapturer と画面収録権限のコードパスを削除する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P1
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)
関連 PRD: 非機能要件の権限、R-2
依存: 0009、0013

## 背景

MVP のシステム音声は BlackHole 2ch を入力デバイスとして取得する方式に決まった。
desktopCapturer と `getDisplayMedia` のループバックは MVP では使わない。
`NSAudioCaptureUsageDescription` と `NSScreenCaptureUsageDescription` も不要になった。
コードに desktopCapturer の経路を残すと、画面収録権限の要求や不要な dead code の原因になる。

## 目的

MVP の権限要求をマイクと書類フォルダだけに整理し、desktopCapturer のコードパスを削除する。

## やること

- Renderer とメインプロセスから desktopCapturer と `getDisplayMedia` の音声取得コードを削除する。
- `Info.plist` から `NSAudioCaptureUsageDescription` と `NSScreenCaptureUsageDescription` を削除する。
  `NSMicrophoneUsageDescription` と `NSDocumentsFolderUsageDescription` は残す。
- 画面収録権限の要求と、権限拒否時の案内を削除する。
- 将来 desktopCapturer を復活させる場合は、feature flag で完全に分離し、MVP のビルドでは無効にする。
- ADR-0003 と ADR-0014 の記述と、リリースチェックリストを更新する。
- 画面収録権限を要求しないことを、配布ビルドのテストで確認する。

## 完了条件

- 録音とシステム音声の取得で、画面収録権限のダイアログが出ない。
- `Info.plist` に画面収録とシステム音声録音のキーがない。
- desktopCapturer の import と `getDisplayMedia` の音声取得コードが MVP の経路に残っていない。
- マイク権限と書類フォルダ権限だけで録音できる。
- リリースチェックリストに、画面収録権限を要求しないことの確認が入る。

## pending にした理由

アプリ基盤の issue 0009 ができるまで、削除する desktopCapturer のコードも `Info.plist` も存在しない。
0013 で署名済みビルドの権限検証を行うため、この issue の画面収録権限の確認と重複する。
0009 と 0013 の完了後に、MVP のコードに desktopCapturer の経路が残っていないかの確認として再開する。

## 解決方法

2026-10-29 に、MVP のコードと配布物に desktopCapturer と画面収録権限の経路がないことを確認した。

- `src`、`scripts`、`electron-builder.yml`、`build` を検索し、`desktopCapturer` と `getDisplayMedia` の利用がないことを確認した。
- `scripts/after-pack.cjs` は `NSAudioCaptureUsageDescription`、`NSScreenCaptureUsageDescription`、`NSCameraUsageDescription` を `Info.plist` から削除する。
- `scripts/verify-mac-bundle.cjs` は、`Info.plist` に画面収録、システム音声録音、カメラのキーがないことと、`out` に `desktopCapturer` と `getDisplayMedia` がないことを検査する。
- `build/entitlements.mac.plist` に画面収録の entitlement はない。
- アプリはマイクと書類フォルダの権限だけを要求する。
- リリースチェックリストに、画面収録権限のダイアログが出ないことと、desktopCapturer のコードパスが残っていないことの確認を追加した。
- `npm run package` と `npm run verify:mac` で、パッケージ済みアプリの `Info.plist` と配布物を検査できる。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/issues/pending/0013-feat-release-checklist-and-entitlements.md`
- `docs/prd/kataribe.md` の非機能要件
