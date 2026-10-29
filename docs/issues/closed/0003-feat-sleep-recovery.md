# 録音中のスリープ復帰処理を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
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

## 解決方法

2026-10-29 に、録音中のスリープ復帰処理を実装した。

- メインプロセスで `powerMonitor` の suspend と resume を監視する。
  録音中の suspend と resume を `meta.json` の `events` に `sleep-suspend` と `sleep-resume` として記録する。
- 復帰時に Renderer へ `recording:power` を送る。
  イベントには suspend と resume の時刻、およびスリープ時間から計算した欠落フレーム数を含める。
- Renderer は復帰時に `AudioContext` を再開し、入力トラックの `readyState` を確認する。
  終了したトラックがあれば issue 0012 のデバイス消失処理に渡す。
  復帰後に BlackHole が見つからない場合も、デバイス消失として録音を停止する。
- 欠落区間は AudioWorklet に `insertGap` メッセージで渡す。
  AudioWorklet は次の `process()` で、復帰前の音声を確定し、`gap` メッセージを送る。
  Renderer は `gap` メッセージをチャンクキューに積み、メインプロセスが同じサンプルレートの無音 WAV チャンクを保存する。
- 無音チャンクは `meta.json` の `gap_samples` に加算し、`actual_samples` と `expected_samples` を一致させる。
  `audio.wav` では欠落区間が無音で埋まり、文字起こしのタイムスタンプが実時間に近づく。
- 復帰後は入力レベルとレベル表示を継続する。
  スリープ中に音声が欠落した場合は、復帰時に画面へ警告を表示する。

確認結果:

- `npm run typecheck`: 成功。
- `npm test`: 106 件成功。
  AudioWorklet の gap メッセージ、無音チャンクの保存、`meta.json` の `gap_samples`、expected と actual の一致をテストする。
- 開発版の実機確認:
  - 録音中に `appendGap(4800)` を呼ぶと、4800 サンプルの無音チャンクが保存された。
  - `meta.json` の `gap_samples` が 4800、`actual_samples` と `expected_samples` が 205,632 で一致した。
  - `audio.wav` は 4.284 秒、1 チャンネル、48 kHz、16-bit で、無音区間を含んでいた。
  - 通常の録音、停止、チャンク結合が引き続き動作した。
- 実際のシステムスリープを発生させる確認は未実施である。
  スリープ復帰の手動テストは `docs/testing/recording-regression.md` の手順で行う。

## 参照

- `docs/adr/0002-web-audio-recording-and-chunks.md`
- `docs/adr/0003-system-audio-virtual-device.md` の「結果」
- `docs/issues/closed/0006-test-m0-regression-harness.md`
- `docs/issues/closed/0010-feat-recording-core.md`
- `docs/issues/closed/0012-feat-device-loss-and-permission-handling.md`
- `docs/prd/kataribe.md` の非機能要件
