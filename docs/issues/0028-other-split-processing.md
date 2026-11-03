# main/processing.ts を変換、文字起こし、話者分離、要約、翻訳の phase に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-processing

## 目的

`src/main/processing.ts` が 2400 行を超え、音声変換、文字起こし、比較セッション、話者分離、要約、翻訳、キューの制御が 1 ファイルに混在している。
phase ごとの module に分割し、処理の追加と変更を局所化する。

## 優先度根拠

機能追加ではないが、文字起こしと音声強調の変更のたびに巨大なファイルを読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

`src/main/processing.ts` は 2435 行で、次の責務を 1 ファイルに持つ。

- 会議の処理キュー、全体直列化、会議単位の重複拒否、キャンセル
- mp3 と 16 kHz WAV の生成
- 文字起こしエンジンの解決、部分結果、再開、タイムアウト
- 比較セッション、生と強調の文字起こし、再実行
- 話者分離、話者分離キャッシュ、翻訳の話者名更新
- 要約のプレビュー、確認、生成、保存
- 翻訳のプレビュー、確認、生成、保存
- 中断された会議の復旧

`code-style` のファイル長の閾値は 1000 行であり、既存コードが閾値を超えていることは追加変更の正当化にならない。

## 設計方針

- 振る舞いを変えない。既存のテストを同じ内容のまま通す。
- 次の module に分ける。
  - `src/main/processing-queue.ts`: キュー、直列化、重複拒否、キャンセル、処理状態の通知
  - `src/main/processing-encoding.ts`: mp3 と 16 kHz WAV の生成
  - `src/main/processing-transcription.ts`: 通常の文字起こし、部分結果、再開、タイムアウト
  - `src/main/processing-comparison.ts`: 比較セッション、生と強調、再実行
  - `src/main/processing-diarization.ts`: 話者分離とキャッシュ、翻訳の話者名更新
  - `src/main/processing-summary.ts`: 要約のプレビュー、生成、保存
  - `src/main/processing-translation.ts`: 翻訳のプレビュー、生成、保存
  - `src/main/processing-recovery.ts`: 中断された会議の復旧
- `ProcessingCoordinator` は公開 API と依存の組み立てだけを持ち、phase の module を呼ぶ。
- 処理状態の遷移と `meta.json` の更新は、分割前と同じ順序と内容を保つ。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。

## 完了条件

- [ ] `src/main/processing.ts` が 1000 行以下になる。
- [ ] 変換、文字起こし、比較セッション、話者分離、要約、翻訳、復旧の状態遷移と保存内容が分割前と同じである。
- [ ] 既存の処理のテストが同じ内容で通り、比較セッションと話者分離キャッシュのテストを移した後も同じ性質を検証する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md の `### misc` を更新する。
- [ ] 新しい npm 依存を追加しない。

## 解決方法

- キューの制御を `src/main/processing-queue.ts` へ移し、`ProcessingCoordinator` は `enqueue` と状態だけを持つ。
- 音声変換を `src/main/processing-encoding.ts` へ移す。
- 通常の文字起こしと部分結果の保存を `src/main/processing-transcription.ts` へ移す。
- 比較セッションと `transcript.raw.md`、`transcript.nemotronlabs.md`、`transcript.md` の更新を `src/main/processing-comparison.ts` へ移す。
- 話者分離と `diarization.json` の更新を `src/main/processing-diarization.ts` へ移す。
- 要約と翻訳をそれぞれの module へ移す。
- `markInterruptedMeetings` を `src/main/processing-recovery.ts` へ移す。
- 既存のテストを移した module のテストへ分割し、状態遷移とファイルの内容を減らさずに検証する。
