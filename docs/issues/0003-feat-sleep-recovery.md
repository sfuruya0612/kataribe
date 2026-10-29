# 録音中のスリープ復帰処理を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P0
対応 ADR: ADR-0002 (docs/adr/0002-web-audio-recording-and-chunks.md)、ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: 非機能要件の録音の信頼性、データ耐久性
依存: 0010

## 背景

2026-10-29 の再測定では、120 秒の測定中に 81.394 秒のシステムスリープが発生した。
`power_suspend` は 06:13:45.518、`power_resume` は 06:15:06.912 だった。
AudioWorklet の frames と expectedFrames は 5,411,072 で一致し、gaps は 0 だった。
これは currentFrame がスリープ中に停止するためである。
レンダラーの elapsedMs 120,001 と elapsedAudioSeconds 112.731 の差 7.27 秒が、スリープによる欠落の一部を示す。
スリープ中の音声は途切れる。
M0 の旧カウンタの「フレーム数」は `AnalyserNode` の読み取り回数であり、実フレーム数ではなかった。
録音中のスリープ抑止は、issue 0010 の録音中核で実装する。
この issue では、強制的にスリープした場合の復帰処理と、欠落区間の記録を扱う。

## 目的

録音中にシステムスリープが発生した場合でも、復帰後に録音を再開し、欠落区間を `meta.json` に記録する。

## やること

- `powerMonitor` の suspend と resume を監視し、スリープした時刻と復帰した時刻を `meta.json` に記録する。
  AudioWorklet の currentFrame はスリープ中に停止するため、スリープの欠落は currentFrame だけで検出できない。
  `powerMonitor` の時刻と併用する。
- 復帰後に BlackHole 2ch とマイクのストリームを再確認する。
  必要なら `getUserMedia` をやり直し、録音を再開する。
- 欠落区間は suspend と resume の時刻から特定し、録音ファイルでは無音で埋める。
  文字起こしのタイムスタンプを実時間と一致させるため、欠落区間を詰めない。
- スリープ中に音声が欠落した場合は、録音終了後に警告を出す。
- 復帰後に BlackHole が見つからない場合は、録音を停止して設定を確認するよう案内する。
- 復帰後の録音の継続性は、AudioWorklet の `process()` で数えた実フレーム数と `AudioContext.currentTime` で確認する。
- スリープ復帰の手動テストを issue 0006 のチェックリストに含める。

## 完了条件

- 強制的にスリープした場合、復帰後に録音が再開し、`meta.json` に suspend と resume の時刻が記録される。
- 欠落区間が無音で埋められ、文字起こしのタイムスタンプが実時間と一致する。
- 録音終了後に、欠落区間があったことを警告する。
- 復帰後に BlackHole が見つからない場合、録音が無音のまま続かない。
- スリープ復帰の手動テスト結果が issue 0006 のテンプレートに残る。

## 参照

- `docs/adr/0002-web-audio-recording-and-chunks.md`
- `docs/adr/0003-system-audio-virtual-device.md` の「結果」
- `docs/issues/0006-test-m0-regression-harness.md`
- `docs/issues/0010-feat-recording-core.md`
- `docs/issues/0012-feat-device-loss-and-permission-handling.md`
- `docs/prd/kataribe.md` の非機能要件
