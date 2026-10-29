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

## 参照

- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0004-child-processes-for-media-processing.md`
- `docs/adr/0006-whisper-cpp-and-model-management.md`
- `README.md`
