# マイクと BlackHole の録音中核を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P0
対応 ADR: ADR-0002 (docs/adr/0002-web-audio-recording-and-chunks.md)、ADR-0005 (docs/adr/0005-audio-formats-mp3-and-16khz-wav.md)、ADR-0010 (docs/adr/0010-meeting-folder-and-sqlite-index.md)
関連 PRD: R-2、R-4、R-5、非機能要件の録音の信頼性とデータ耐久性
依存: 0009

## 背景

ADR-0002 は Renderer の AudioWorklet で録音し、10 秒ごとに wav チャンクを書き出すと決めている。
ADR-0010 は会議フォルダと `meta.json` を定めている。
録音中核がないと、入力ソースの選択も入力レベルの表示もテストできない。

M0 の「フレーム数」は `AnalyserNode` から読み取ったサンプル数であり、音声ストリームの実フレーム数ではない。
新しい実装では、録音の継続性を実フレーム数で測る。
M0 ハーネスの AudioWorklet フレームカウンタを参考にする。
M0 ハーネスの 60 分再測定では、3600 秒に対して音声時間は 3599.58 秒で、差は 0.42 秒だった。
BlackHole は 172,779,648 / 172,779,776 フレームで 128 フレームの gap が 1 回、マイクとミックスは 172,779,520 / 172,779,520 フレームで gap は 0 だった。
M0 ハーネスのシステムスリープ再測定では、`powerSaveBlocker` なしで 81.394 秒のスリープが発生し、音声が欠落した。
録音中は `powerSaveBlocker` を有効にする必要がある。

## 目的

マイク、BlackHole、両方の入力を取得し、同じ `AudioContext` でミックスし、wav チャンクと `meta.json` を保存する。
録音の継続性を実フレーム数で確認できるようにする。

## やること

- 入力ソース（マイク、BlackHole、両方）を受け取り、指定されたデバイスで `getUserMedia` を呼ぶ。
  デバイスの検出は issue 0001 が担当する。
- AudioWorklet でマイクと BlackHole の音声を取得し、同じ `AudioContext` でミックスする。
  BlackHole はステレオで取得されるため、ミックス後にモノラルへ変換する（ADR-0005）。
- 録音開始時に会議フォルダを作り、`meta.json` に `status: recording`、入力ソース、開始時刻、サンプルレートを書く。
- 10 秒ごとに wav チャンクを Application Support の一時ディレクトリへ書き、`meta.json` にチャンク一覧を記録する。
- 停止時にチャンクを結合し、一時ファイルを削除する。
  異常終了時は、残ったチャンクから録音を復旧できるようにする。
- 入力レベルのピークと RMS を AudioWorklet で計算し、100 ms 間隔で UI に渡す。
- 録音中は `powerSaveBlocker` を `prevent-app-suspension` で開始し、停止時に解放する。
- 録音の継続性は、AudioWorklet の `process()` で数えた実フレーム数と `AudioContext.currentTime` で確認する。
  `AnalyserNode` の読み取り回数をフレーム数として扱わない。
- 長時間の連続録音テストは issue 0006 の回帰テストで行う。

## 完了条件

- マイク、BlackHole、両方の入力で録音できる。
- 10 秒ごとに wav チャンクが作られ、`meta.json` の内容が正しい。
- 停止時にチャンクが 1 つの wav に結合され、一時ファイルが削除される。
- 異常終了後も、残ったチャンクから録音を復旧できる。
- 入力レベルのピークと RMS が 100 ms 間隔で更新される。
- 録音中に `powerSaveBlocker` が有効になり、停止後に解放される。
- 60 分の録音で、実フレーム数と `AudioContext.currentTime` の差が 1 秒以内である。

## 解決方法

2026-10-29 に録音中核を実装した。

- `src/main/recording.ts` に `RecordingManager` を追加した。
  録音の開始、チャンク保存、結合、復旧、`meta.json` の更新、`powerSaveBlocker` の開始と解放を担当する。
  会議フォルダは `YYYY/YYYY-MM-DD_HHMM_タイトル未入力`、一時ディレクトリは `~/Library/Application Support/Kataribe/tmp/<meeting-id>/` に作る。
- `src/main/wav.ts` に 16-bit PCM モノラル WAV の生成を分離した。
  ヘッダ、データ長、サンプル境界、無音への丸めをテストする。
- `src/renderer/public/recorder-worklet.js` に AudioWorklet を追加した。
  10 秒ごとのチャンク、100 ms 間隔のピークと RMS、実フレーム数、期待フレーム数、gap、欠落フレームを数える。
  マイクと BlackHole は同じ `AudioContext` で 0.5 倍ずつ混合し、`channelCount: 1` でモノラルにする。
- `src/renderer/src/App.tsx` に録音パネルを追加した。
  入力ソース、入力デバイス、マイク権限、ピークと RMS、実フレーム数、チャンク数、復旧できる録音、保存結果を表示する。
- `meta.json` は `schema_version`、`id`、`status`、`started_at`、`duration`、`source`、`sample_rate`、`chunks`、`actual_samples`、`expected_samples`、`capture_stats`、`audio_path` を持つ。
  書き込みは一時ファイル、fsync、rename で行う。
  会議フォルダは 0700、ファイルは 0600 で作る。
- 停止後は `status` を `encoding` にし、`audio.wav` を会議フォルダに結合する。
  mp3 と 16 kHz wav の生成はまだ実装していないため、`audio.wav` を中間ファイルとして残す。
  一時チャンクは結合後に削除する。
- 録音中は `powerSaveBlocker.start('prevent-app-suspension')` を開始し、停止時に解放する。
- 停止時は最終チャンクを `stopped` メッセージに同梱する。
  `process()` の戻り値だけに依存せず、停止後に `stopped` を再送しないガードも入れた。

確認結果:

- `npm run typecheck`: 成功。
- `npm test`: 46 件成功。
  WAV、`RecordingManager`、AudioWorklet、権限、録音ユーティリティをテストする。
- `npm run build`、`npm run smoke`、`npm run package`: 成功。
- パッケージ済み `Kataribe.app` の smoke test: 成功。
- 実機 macOS 26.7.1 arm64、BlackHole 2ch 0.7.1、MacBook Pro のマイクで確認した。
  - マイクのみ 4 秒: 194,688 フレーム、gap 0、`audio.wav` 194,688 サンプル。
  - システム音声のみ 12 秒: 2 チャンク（480,000 + 98,688）、578,688 フレーム、gap 0。
  - マイク + システム音声 12 秒: 2 チャンク（480,000 + 96,640）、576,640 フレーム、gap 0、ピーク -42.8 dB。
  - パッケージ済みアプリでマイク + システム音声 4 秒: 195,712 フレーム、gap 0。
  - 12 秒の録音で、実フレーム数と `AudioContext.currentTime` の差は 0.003 秒だった。
  - 入力レベルが 100 ms 間隔で更新されることを確認した。
  - 録音中にプロセスを SIGKILL し、30 秒、3 チャンクの一時セッションから復旧した。
    復旧後の `audio.wav` は 30.000 秒、1,440,000 サンプルで、一時ディレクトリは削除された。
  - `powerSaveBlocker` の開始と停止をログで確認した。
- パッケージ済みアプリで `app.asar` 内の AudioWorklet を読み込めることを確認した。
- 60 分の連続録音は issue 0006 の回帰テストで確認する。

残っている作業:

- mp3 と 16 kHz wav の生成は、ADR-0005 に従って次の実装で追加する。
- 入力デバイスの消失と権限拒否の画面は issue 0012 で扱う。
- メニューバーと本画面は [issue 0011](0011-feat-app-shell-and-recording-ui.md) で扱う。
- 署名済みビルドの entitlement は issue 0013 で確認する。

## 参照

- `docs/adr/0002-web-audio-recording-and-chunks.md`
- `docs/adr/0005-audio-formats-mp3-and-16khz-wav.md`
- `docs/adr/0010-meeting-folder-and-sqlite-index.md`
- `docs/prd/kataribe.md` の R-2、R-4、R-5、非機能要件
- `docs/m0/0003-system-audio/README.md`
