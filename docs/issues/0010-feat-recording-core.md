# マイクと BlackHole の録音中核を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
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

## 参照

- `docs/adr/0002-web-audio-recording-and-chunks.md`
- `docs/adr/0005-audio-formats-mp3-and-16khz-wav.md`
- `docs/adr/0010-meeting-folder-and-sqlite-index.md`
- `docs/prd/kataribe.md` の R-2、R-4、R-5、非機能要件
- `docs/m0/0003-system-audio/README.md`
