# M0 の音声検証ハーネスをリリース前の回帰テストとして整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: 非機能要件の録音の信頼性
依存: 0009、0010、0003、0012、0013

## 背景

M0 では `docs/m0/0003-system-audio/` のハーネスを使って、BlackHole 2ch の直接入力、Multi-Output Device、マイクとのミックス、60 分連続録音、Bluetooth、デバイス変更、ディスプレイスリープ、システムスリープ、Zoom / Meet 実機を検証した。
ただし、M0 の「フレーム数」は `AnalyserNode` の読み取り回数であり、実フレーム数ではない。
2026-10-29 に M0 ハーネスを AudioWorklet のフレームカウンタに更新した。
10 秒の予備測定では、`frames` と `expectedFrames` が 479,744、`gaps` と `missedFrames` が 0 だった。
60 分の連続性も実フレーム数で再測定した。
BlackHole は 172,779,648 / 172,779,776 フレームで、128 フレームの gap が 1 回あった。
マイクとミックスは 172,779,520 / 172,779,520 フレームで、gap は 0 だった。
ディスプレイスリープは 90 秒で 256 フレームの gap が 1 回あった。
Zoom / Meet は 300 秒で 14,390,016 / 14,390,272 フレームで、256 フレームの gap が 1 回あった。
ウォームアップ 1 秒を入れた 60 秒テストと 90 秒のディスプレイスリープテストでは、gaps と missedFrames が 0 だった。
128〜256 フレームの gap は、カウンタの起動時の数え落としだったと確認した。
システムスリープは 81.394 秒発生し、frames と expectedFrames は 5,411,072 で一致した。
ただし、currentFrame がスリープ中に停止するため、gaps は 0 になる。
elapsedMs 120,001 と elapsedAudioSeconds 112.731 の差 7.27 秒が、スリープによる欠落の一部を示す。
この issue では、ウォームアップ付きの長時間テストを回帰テストに組み込み、スリープと Zoom / Meet の手順を整備する。
検証は手動の手順とログに依存しており、リリース前に同じ確認を再現する手順が整理されていない。
特に Zoom / Meet と Bluetooth は、実機と別デバイスが必要で、自動化が難しい。

## 目的

リリース前に、システム音声の主要な経路を同じ手順で確認できるようにする。
自動化できる部分はスクリプトにし、手動でしか確認できない部分はチェックリストにする。

## やること

- `docs/m0/0003-system-audio/` の `run-blackhole.sh`、`run-mix.sh`、`run-long.sh` の使い方と期待値を整理する。
- M0 ハーネスを `docs/m0` に残すか、リリース回帰用に `tools/` へ移すかを決める。
  M0 ハーネスは環境確認に使い、製品の録音回帰は issue 0010 の実装を使う別のテストにする。
- 次の項目を、自動テストと手動チェックリストに分ける。
  - BlackHole 2ch の直接入力
  - Multi-Output Device 経由の入力
  - マイク + BlackHole のミックス
  - 60 分連続録音
  - Bluetooth ヘッドホン（出力 + 内蔵 / USB マイクの推奨構成）
  - Bluetooth 入力（HFP）に切り替えた状態で、Multi-Output Device と BlackHole 2ch の取得が続くか
  - 出力デバイス変更
  - ディスプレイスリープとシステムスリープ
  - Zoom / Google Meet 実機
- 各項目の合否に使う数値（実フレーム数、ピーク、RMS、非ゼロの割合）を決める。
  フレーム数は AudioWorklet の `process()` で数えた実フレーム数とし、`AnalyserNode` の読み取り回数を使わない。
- ウォームアップ 1 秒を既定にし、60 分と Zoom / Meet の長時間テストでも gap 0 を確認する。
  60 秒と 90 秒のテストでは gap 0 を確認済みである。
- 検証結果を残すテンプレートを作る。
  実行日、macOS、Electron、BlackHole、使用マイク、出力デバイス、結果、ログのパスを記録する。
- リリースチェックリストに、M0 の回帰テストを追加する。
- 手動テストで使う Zoom / Meet のテスト会議の手順と、別デバイスの準備を書く。
- 手動手順には、必要な Mac、macOS、BlackHole、マイク、出力デバイス、Zoom / Meet のアカウントを書く。

## 完了条件

- 自動で実行できる検証と、手動でしかできない検証が分かれている。
- M0 ハーネスの置き場所と実行前提が決まっている。
- 各検証の合否基準が数値で書かれている。
- 検証結果のテンプレートがある。
- リリースチェックリストから M0 の回帰テストに到達できる。
- 60 分連続録音、Bluetooth、ディスプレイスリープ、システムスリープ、Zoom / Meet の手動手順が、第三者が実行できる粒度で書かれている。

## 解決方法

2026-10-29 に、録音のリリース回帰テストを整備した。

- M0 ハーネスは `docs/m0/0003-system-audio/` に残し、BlackHole 2ch と Multi-Output Device の環境確認に使う。
- 製品の録音経路の回帰は、Kataribe のアプリで確認する。
  M0 ハーネスの `AnalyserNode` の読み取り回数をフレーム数として扱わない。
- [録音のリリース回帰テスト](../../testing/recording-regression.md) を作成した。
  自動テストと手動テストを分け、実フレーム数、`expectedFrames`、`gaps`、`missedFrames` の合格基準を数値で記載した。
- [回帰テスト結果テンプレート](../../testing/recording-regression-template.md) を作成した。
  実行日、macOS、Electron、BlackHole、マイク、出力、各項目の結果、ログのパスを記録する。
- 60 分連続録音、Bluetooth、ディスプレイスリープ、システムスリープ、Zoom と Google Meet の手順を、第三者が実行できる粒度で記載した。
- リリースチェックリストから回帰テストと結果保存への確認項目を追加した。
- README と M0 ハーネスの README から回帰テストへのリンクを追加した。

確認結果:

- 自動テストのコマンドは、既存の `typecheck`、`test`、`build`、`smoke`、`test:window`、`package`、`verify:mac` を使う。
- ドキュメントのリンクを確認した。
- システムスリープの無音埋めと署名済みビルドの確認は、それぞれ issue 0003 と issue 0013 の完了後に回帰テストで確認する。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/m0/0003-system-audio/README.md`
- `docs/issues/closed/0012-feat-device-loss-and-permission-handling.md`
- `docs/issues/closed/0013-feat-release-checklist-and-entitlements.md`
- `docs/prd/kataribe.md` の非機能要件
