# 録音停止後の保存音声を RE-USE で強調し、生音声と聞き比べられるようにする

- Requirements: REQ-ENHANCE-001
- Priority: High
- Created: 2026-11-03
- Completed: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-transcription-accuracy

## 目的

録音停止後の保存音声に RE-USE の音声強調を適用するかどうかを選べるようにする。
生の `audio.mp3` を残し、`audio.enhanced.nemotronlabs.mp3` と聞き比べられるようにする。
会議詳細からインストール済みの商用モデルで再実行できるようにする。

## 優先度根拠

利用者が、実会議の音声で RE-USE の効果を確認するために明示的に求めた機能である。
issue 0023 のモデル管理と WebGPU エンジン、issue 0026 のメタデータと一時ファイル管理を前提にする。

## 現状

- 録音停止後は、mp3 と 16 kHz WAV を生成し、whisper.cpp で文字起こしする。音声強調の処理はない。
- 会議フォルダの音声は `audio.mp3` の 1 つで、生と強調を切り替える UI はない。
- 会議詳細の音声プレイヤーは `audio.mp3` だけを再生する。
- 音声強調のモデルと WebGPU エンジンは issue 0023 で追加する。
- `enhancement.json`、一時ファイルの後始末、`enhancing` 状態は issue 0026 で追加する。

## 設計方針

### 対象範囲

- この issue では、録音停止後の保存音声の強調、音声プレイヤーの生 / 強調の切り替え、会議詳細からの再実行を扱う。
- 文字起こし前の強調と、生 / 強調の文字起こし比較は issue 0024 で扱う。
- モデルのダウンロードと WebGPU エンジンは issue 0023 で扱う。
- `enhancement.json` の schema、一時ファイルの削除、`enhancing` 状態は issue 0026 で扱う。
- 録音中の入力へリアルタイムに強調をかける処理は扱わない。
- アプリが扱うモデルは、商用利用が可能な `nemotronlabs` だけとする。
  研究および教育用のモデルは、設定画面、音声プレイヤー、メタデータのいずれにも含めない。

### 処理の流れ

1. 録音チャンクを結合して元の WAV を作る。
2. 生の `audio.mp3` を作る。文字起こし前の強調が OFF のときは PCM から `audio.16k.wav` を作り、ON のときは issue 0024 が `audio.mp3` から作り直す。
3. `enhanceSavedAudio` が ON なら、元の WAV を `ReuseEnhancementService` で強調し、一時的な強調 WAV を作る。
4. 強調 WAV を `audio.enhanced.nemotronlabs.mp3` にエンコードする。
   一時ファイルに書いてから rename し、失敗したときは既存の強調音声を残す。
5. 一時的な強調 WAV を削除する。元の WAV は、保存音声の強調と、OFF のときの 16 kHz WAV の生成が終わってから削除する。
6. 文字起こしを実行する。強調に失敗しても、生の `audio.mp3` と 16 kHz WAV で文字起こしを続行する。
7. 強調の状態、処理時間、設定、入出力のハッシュを `enhancement.json` に記録する。
8. 処理の開始時に `meta.status` と `ProcessingState.stage` を `enhancing` にし、終了時に文字起こしへ進める。

- 元の WAV がない取り込み音声では、`audio.mp3` を一時 WAV にデコードしてから強調する。
- 強調に失敗したときは `audio.mp3` を残し、失敗理由を `enhancement.json` に記録する。`meta.json` には `savedAudioState` の要約だけを更新する。文字起こしと要約は続行する。
- WebGPU が使えないときは、強調を実行せず `audio.mp3` を残し、理由を会議詳細に表示する。文字起こしと要約は続行する。
- 強調を OFF にした会議、または強調に失敗した会議は、従来どおり `audio.mp3` だけを使う。

### 会議詳細からの再実行

- 会議詳細から、インストール済みの商用モデルで保存音声の強調を再実行できる。
- 再実行の入力は `audio.mp3` からデコードした WAV であり、録音した会議では録音直後の元 WAV とは異なる。
  録音した会議では、入力が異なることを画面に表示する。
- 再実行中は進捗とキャンセルを表示し、同じ会議の強調を同時に実行しない。
- 再実行に成功したときは、一時ファイルに書いた新しい mp3 で `audio.enhanced.nemotronlabs.mp3` を置き換える。
  失敗したときは、既存の強調音声を残す。
- 再実行は、`audio.mp3` があり、モデルがインストール済みで、WebGPU が使えるときだけ有効にする。
- `audio.mp3` のハッシュが変わったときは、古い強調音声を削除する。
  削除は issue 0026 の `invalidateEnhancement` を `all` の範囲で使う。

### 設定と画面

- `src/shared/settings.ts` に `enhanceSavedAudio: boolean` を追加する。既定は `false`。
- `src/renderer/src/ReuseSettings.tsx` に、録音停止後の保存音声の強調の ON/OFF を追加する。
  モデルの選択と、研究および教育用モデルの同意は追加しない。
- `src/renderer/src/AudioPlayer.tsx` に音声の種類の切り替えを追加する。
  - `audio.mp3` と `audio.enhanced.nemotronlabs.mp3` の URL を受け取る。
  - 既定は生音声とする。
  - 強調音声があるときだけ選択肢に出す。
  - 再生位置は切り替え時にリセットする。
- `src/renderer/src/MeetingDetail.tsx` で、`enhancedModels` が空でないときだけ切り替えを表示する。
- `src/renderer/src/MeetingDetail.tsx` に「保存音声の強調を再実行」ボタンを追加する。
  - インストール済みの商用モデルで `reuse:enhance-saved-audio` を呼ぶ。
  - 実行中は進捗とキャンセルを表示し、同じ会議の再実行を無効にする。
  - 完了したら `enhancedModels` と音声の選択肢を更新する。
  - 同じファイル名を上書きするため、音声 URL にファイルの更新時刻またはハッシュを付け、古いキャッシュを再生しないようにする。
  - 同じモデルの強調音声が既にあるときは、置き換えることを確認する。
  - 録音直後の結果と再実行の結果は入力が異なるため、両方を比べるときは同じ `audio.mp3` から再実行する旨を表示する。
- 音声プレイヤーと再実行の UI は `AudioVariantSelector.tsx` と `SavedAudioEnhancementControls.tsx` に分ける。
  `MeetingDetail.tsx` へは配線だけを追加する。
- `src/shared/i18n.ts` に日本語と英語の文言を追加する。

### データとメタデータ

- 会議フォルダに `audio.enhanced.nemotronlabs.mp3` を追加する。
- `enhancement.json` の `saved_audio.nemotronlabs` に、状態、入力と出力のハッシュ、設定、開始と終了の時刻、処理時間、エラーを記録する。
  schema と書き込み規則は issue 0026 が定義する。
- `meta.json` には、会議一覧に必要な `savedAudioModels` と状態の要約だけを記録する。
- issue 0026 が追加する `MeetingSummary.enhancedModels` を、強調音声の生成時に更新する。
- `kataribe-audio` プロトコルで、`audio.mp3` と `audio.enhanced.nemotronlabs.mp3` を切り替えて返す。
  会議 ID、音声の種類、モデル ID を照合し、パスを外部から指定させない。
- 検索索引の `MeetingRow` と `upsert` に `enhanced_models` を追加するのは issue 0026 とする。この issue は、強調音声の生成時に `enhancedModels` を更新する。
  索引の再構築は issue 0026 のテストで確認する。

## 完了条件

- [x] REQ-ENHANCE-001 の受入基準「設定画面の「文字起こし」で、録音停止後の保存音声の強調を ON/OFF できる。既定は OFF とする」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「強調には、商用利用が可能な `nvidia/NVIDIA-NemotronLabs-RE-USE` を使う。アプリは研究および教育用のモデルを選択肢に含めない」を満たす。モデルのダウンロードは issue 0023 の完了条件で確認する。
- [x] REQ-ENHANCE-001 の受入基準「モデルは初回利用時にダウンロードし、SHA-256 を照合してから使う。進捗、キャンセル、削除ができる」を満たす。モデルのダウンロードは issue 0023 の完了条件で確認する。
- [x] REQ-ENHANCE-001 の受入基準「強調は端末内の WebGPU で行い、音声を外部に送らない」を満たす。WebGPU の実行は issue 0023 の完了条件で確認する。
- [x] REQ-ENHANCE-001 の受入基準「強調を ON にした会議は、生の `audio.mp3` を残し、`audio.enhanced.nemotronlabs.mp3` を保存する」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「会議詳細から、インストール済みの商用モデルで保存音声の強調を再実行できる。再実行の入力は保存済みの `audio.mp3` から作る。録音した会議では、録音直後の強調と入力が異なることを表示する」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「再実行に成功したときは以前の強調音声を新しい結果で置き換え、失敗したときは以前の強調音声を残す」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「会議詳細の音声プレイヤーで、生音声と強調音声を切り替えて再生できる」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「強調に失敗したときは生の `audio.mp3` を残し、失敗理由を会議詳細に表示する。文字起こしと要約は続行する」を満たす。
- [x] WebGPU が使えないとき、強調を実行せず生の `audio.mp3` で文字起こしと要約を続行し、理由を表示することをテストで固定する。
- [x] REQ-ENHANCE-001 の受入基準「強調の処理時間、使用モデル、設定、入出力のハッシュを `enhancement.json` に記録する」を満たす。
- [x] REQ-ENHANCE-001 の受入基準「`audio.mp3` のハッシュが変わったときは、古い強調音声を削除する」を満たす。
- [x] 強調の成功、失敗、キャンセルで、生の `audio.mp3` が常に残ることをテストで固定する。
- [x] 保存音声の強調の成功、失敗、キャンセル、mp3 エンコード、`enhancement.json` の更新をテストで固定する。
- [x] 会議詳細からの再実行で、インストール済みの商用モデルの mp3 を作り、失敗したときは既存の mp3 を壊さないことをテストで固定する。
- [x] 同じ会議の文字起こし中に保存音声の強調を実行できないことをテストで固定する。
- [x] 既存の会議と、強調を OFF にした会議の音声と UI が変わらないことをテストで固定する。
- [x] 音声プレイヤーの生 / 強調の切り替えと、強調音声がない会議で選択肢を出さないことを UI テストで固定する。
- [x] 索引の `enhancedModels` の列と再構築は issue 0026 の完了条件で確認する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README、CHANGES.md、リリースチェックリストを更新する。
- [x] ADR-0027、ADR-0010、ADR-0013、ADR-0005 の記述を、この issue の範囲に合わせて更新する。

## 解決方法

### 設定

- `src/shared/settings.ts` に `enhanceSavedAudio: boolean` を追加し、既定値を `false` にする。
  `normalizeAppSettings` に既定値と型検証を追加し、`tests/settings.test.ts` に追加する。
- `src/shared/types.ts` の `AppSettings` に `enhanceSavedAudio` を追加する。
- `SettingsPanel.tsx` の transcription タブで `ReuseSettings` に設定を渡す。

### メインプロセス

- `src/main/reuse-saved-audio.ts` を追加する。
- `ReuseSavedAudioService` は次を行う。
  - 元の WAV または `audio.mp3` からデコードした WAV を受け取る。
  - `ReuseEnhancementService` で強調 WAV を作る。
  - `MediaEncoder` で `audio.enhanced.nemotronlabs.mp3` にエンコードする。
  - 一時ファイルに書いてから rename する。
  - 失敗したときは既存のファイルを残し、`enhancement.json` と `meta.json` を更新する。
  - 進捗、キャンセル、タイムアウトを扱う。
- `src/main/processing.ts` の `processMeeting` を更新する。
  - 生の mp3 を作り、文字起こし前の強調が OFF のときは PCM から 16 kHz WAV を作る。ON のときは issue 0024 が `audio.mp3` から作り直す。
  - `enhanceSavedAudio` が ON なら、`ReuseSavedAudioService` を呼ぶ。
  - 強調に失敗しても生の mp3 を残し、文字起こしへ進む。
  - 元の WAV の削除は、保存音声の強調と、OFF のときの 16 kHz WAV の生成が終わってから行う。
- `src/main/index.ts` に `reuse:enhance-saved-audio` を追加し、会議 ID とモデル ID を受け取る。
- `reuse:enhance-saved-audio` は既存の処理キュー (全体直列 + 会議単位の重複拒否) に載せ、同じ会議の文字起こしと同時に実行しない。
  キューの公開メソッド `requestSavedAudioEnhancement` を追加する。
- `src/preload/index.ts` と `src/renderer/src/env.d.ts` に同じ API を追加する。
- `src/main/meetings.ts` の `MeetingSummary.enhancedModels` を更新し、`kataribe-audio` の返り値に `audio.enhanced.nemotronlabs.mp3` を追加する。`MeetingDetail.enhancement` は issue 0026 が追加する。
- `src/main/search-index.ts` の `enhanced_models` の列は issue 0026 が追加する。この issue では、強調音声の生成時に `enhancedModels` を更新する。
  schema と migration は issue 0026 が所有する。

### 画面

- `src/renderer/src/AudioVariantSelector.tsx` を追加する。
  - 生 / 強調の選択肢、選択中の種類、強調音声の有無を props で受け取る。
  - 既定は生とする。
- `src/renderer/src/AudioPlayer.tsx` に音声の種類の切り替えを追加する。
  - 選択された URL を再生する。
  - 切り替え時に再生位置をリセットする。
- `src/renderer/src/SavedAudioEnhancementControls.tsx` を追加する。
  - 再実行ボタン、進捗、キャンセル、置き換えの確認、入力差の表示を props で受け取る。
- `src/renderer/src/MeetingDetail.tsx` で、`enhancedModels` が空でないときだけ切り替えを表示する。
  再実行の状態は hook に分け、`MeetingDetail.tsx` へは配線だけを追加する。
- `src/shared/i18n.ts` に文言を追加する。

### テスト

- `tests/reuse-saved-audio.test.ts` を追加する。
  - 保存音声の強調の成功、失敗、キャンセル、mp3 エンコード、`enhancement.json` の更新を固定する。
  - `audio.mp3` のハッシュが変わったときの古い強調音声の削除を固定する。
  - 会議詳細からの再実行で、インストール済みの商用モデルの mp3 を作り、既存の mp3 を壊さないことを固定する。
  - 再実行に失敗したとき、既存の mp3 を壊さないことを固定する。
  - 同じ会議の文字起こし中に保存音声の強調を実行できないことを固定する。
  - 生の mp3 が常に残ることを固定する。
- `tests/processing.test.ts` に、強調の成功、失敗、キャンセル、OFF の経路、`enhanceBeforeTranscription` が ON のときは PCM から 16 kHz WAV を作らず OFF のときは作ることを追加する。
- `tests/settings.test.ts` に、`enhanceSavedAudio` の既定 false と正規化を追加する。
- `tests/search-index.test.ts` の `enhancedModels` の保存と再構築は、issue 0026 のテストで確認する。
- `src/renderer/src/AudioVariantSelector.test.tsx` に、生 / 強調の切り替えと、強調音声がない会議で選択肢を出さないことを追加する。
- `src/renderer/src/SavedAudioEnhancementControls.test.tsx` に、再実行の有効条件、置き換えの確認、進捗、キャンセル、入力差の表示を追加する。
- `src/renderer/src/ReuseSettings.test.tsx` に、録音停止後の保存音声の強調の ON/OFF を追加する。
- UI テストは `renderToStaticMarkup` と純粋関数で状態を固定する。
  `jsdom` と Testing Library は追加しない。
- PBT と Fuzzing は新しい依存を追加しないため採用しない。
  境界は Example-based test で網羅する。
- テスト名または module doc に、対応する `REQ-ENHANCE-001` を書く。

### 文書

- `docs/prd/kataribe.md` の `REQ-ENHANCE-001` とデータ設計を更新する。
- `docs/adr/0027-reuse-webgpu-enhancement.md` の保存音声の範囲を更新する。
- `docs/adr/0010-meeting-folder-and-sqlite-index.md` と `docs/adr/0013-privacy-boundary.md` を更新する。
- `docs/adr/0005-audio-formats-mp3-and-16khz-wav.md` に派生音声の名前を追加する。
- `README.md` に、保存音声の強調、生 / 強調の切り替え、再実行、処理時間を追加し、音声強調が未実装である旨の注記を削除する。
- `CHANGES.md` の `## develop` に、保存音声の強調と再実行を追加する。
- `docs/release-checklist.md` に、保存音声の強調、生 / 強調の切り替え、再実行の確認を追加する。

## 実施結果

- 設定に `enhanceSavedAudio` を追加し、既定を OFF にした。
- 録音直後は元の WAV、再実行時は `audio.mp3` からデコードした WAV を入力にして強調し、`audio.enhanced.nemotronlabs.mp3` を一時ファイル経由で置き換える。失敗時は以前の mp3 を残す。
- 会議詳細の音声プレイヤーで生音声と強調音声を切り替え、会議詳細から再実行できるようにした。
- `kataribe-audio` に強調音声の種類とモデル ID を追加し、許可外のモデルとパスを拒否する。
- `npm run typecheck`、`npm test` (570 件)、`npm run build` が通る。
