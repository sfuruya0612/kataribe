# M0 の音声検証ハーネスをリリース前の回帰テストとして整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: 非機能要件の録音の信頼性と文字起こし速度、成功指標
依存: 0001、0003、0004

## 背景

M0 では `docs/m0/0003-system-audio/` のハーネスを使って、BlackHole 2ch の直接入力、Multi-Output Device、マイクとのミックス、60 分連続録音、Bluetooth、デバイス変更、ディスプレイスリープ、システムスリープ、Zoom / Meet 実機を検証した。
検証は手動の手順とログに依存しており、リリース前に同じ確認を再現する手順が整理されていない。
特に Zoom / Meet と Bluetooth は、実機と別デバイスが必要で、自動化が難しい。

## 目的

リリース前に、システム音声の主要な経路を同じ手順で確認できるようにする。
自動化できる部分はスクリプトにし、手動でしか確認できない部分はチェックリストにする。

## やること

- `docs/m0/0003-system-audio/` の `run-blackhole.sh`、`run-mix.sh`、`run-long.sh` の使い方と期待値を整理する。
- 次の項目を、自動テストと手動チェックリストに分ける。
  - BlackHole 2ch の直接入力
  - Multi-Output Device 経由の入力
  - マイク + BlackHole のミックス
  - 60 分連続録音
  - Bluetooth ヘッドホン
  - 出力デバイス変更
  - ディスプレイスリープとシステムスリープ
  - Zoom / Google Meet 実機
- 各項目の合否に使う数値（ピーク、RMS、フレーム数、非ゼロの割合）を決める。
- 検証結果を残すテンプレートを作る。
  実行日、macOS、Electron、BlackHole、使用マイク、出力デバイス、結果、ログのパスを記録する。
- リリースチェックリストに、M0 の回帰テストを追加する。
- 手動テストで使う Zoom / Meet のテスト会議の手順と、別デバイスの準備を書く。

## 完了条件

- 自動で実行できる検証と、手動でしかできない検証が分かれている。
- 各検証の合否基準が数値で書かれている。
- 検証結果のテンプレートがある。
- リリースチェックリストから M0 の回帰テストに到達できる。
- 60 分連続録音、Bluetooth、Zoom / Meet の手動手順が、第三者が実行できる粒度で書かれている。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/m0/0003-system-audio/README.md`
- `docs/prd/kataribe.md` の成功指標
