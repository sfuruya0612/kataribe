# MeetingDetail.tsx を文字起こし、要約、確認ダイアログ、詳細取得の単位に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-meeting-detail

## 目的

`src/renderer/src/MeetingDetail.tsx` が 1600 行を超え、文字起こし、生と強調の比較、要約、翻訳、話者名、音声プレイヤー、確認ダイアログが 1 ファイルに混在している。
ペインとダイアログの単位に分割し、会議詳細の変更を局所化する。

## 優先度根拠

機能追加ではないが、文字起こしと音声強調の比較 UI の変更のたびに巨大なファイルを読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

`src/renderer/src/MeetingDetail.tsx` は 1620 行で、次の責務を 1 ファイルに持つ。

- 会議詳細の取得、会議の更新の購読、波形の取得
- タイトル編集、文字起こしの編集、要約の編集
- 文字起こし、翻訳、要約のタブ
- 生と強調の文字起こしの比較
- 音声プレイヤー、保存音声の強調、文字起こし前の強調の再実行
- 要約と翻訳の確認ダイアログ
- 話者名の変更

`code-style` のファイル長の閾値は 1000 行であり、既存コードが閾値を超えていることは追加変更の正当化にならない。

## 設計方針

- 振る舞いを変えない。既存のテストを同じ内容のまま通す。
- 次の component と hook に分ける。
  - `use-meeting-detail.ts`: 会議詳細、波形、会議更新の購読
  - `MeetingDetailHeader.tsx`: タイトル、状態、録音エラー、音声プレイヤー、再実行
  - `TranscriptPane.tsx`: 文字起こし、比較、編集、翻訳、話者名
  - `SummaryPane.tsx`: 要約、編集、生成、コピー
  - `SummaryConfirmDialog.tsx`: 要約の送信確認
  - `TranslationConfirmDialog.tsx`: 翻訳の送信確認
  - `SpeakerRenameDialog.tsx`: 話者名の変更
- 会議詳細の状態は hook に集め、ペインは props で値と操作を受け取る。
- 比較用の文字起こしの読み取り専用の制約を維持する。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。

## 完了条件

- [ ] `src/renderer/src/MeetingDetail.tsx` が 1000 行以下になる。
- [ ] 会議詳細の表示、編集、比較、再実行、翻訳、要約、話者名の変更が分割前と同じである。
- [ ] 比較用の文字起こしで編集、翻訳、話者名の変更が無効のままである。
- [ ] 既存の UI テストが同じ内容で通り、ペインとダイアログの表示テストを追加する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md の `### misc` を更新する。
- [ ] 新しい npm 依存を追加しない。

## 解決方法

- 会議詳細の取得と購読を `use-meeting-detail.ts` へ移す。
- 上部のタイトル、状態、録音エラー、音声プレイヤー、再実行を `MeetingDetailHeader` へ移す。
- 文字起こしペインと比較を `TranscriptPane` へ移す。
- 要約ペインと生成、コピーを `SummaryPane` へ移す。
- 要約、翻訳、話者名の確認をそれぞれのダイアログ component へ移す。
- 既存の `MeetingDetail` はタブの状態とペインの組み立てだけを持つ。
