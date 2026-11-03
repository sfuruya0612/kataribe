# 音声強調のメタデータ、一時ファイル、処理状態を管理する

- Requirements: REQ-ENHANCE-001, REQ-ENHANCE-002 (派生物のメタデータ、`enhancing` 状態、無効化、後始末を担う)
- Priority: High
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-reuse-webgpu-enhancement-metadata

## 目的

音声強調の状態を `enhancement.json` に集約し、`meta.json` との二重管理をなくす。
一時 WAV の置き場所と削除、`enhancing` 状態、空き容量の確認、ハッシュによる無効化を定義する。
issue 0025 と issue 0024 が同じ schema と後始末を使えるようにする。

## 優先度根拠

issue 0025 の保存音声の強調と、issue 0024 の文字起こし前の比較が、この issue の schema、状態、一時ファイル管理に依存する。
後から状態の持ち方を変えると、保存済みの会議と UI の両方に影響するため、機能の実装前に確定する。
この issue は schema、`MeetingSummary` の項目、検索索引の列と migration を所有し、issue 0025 と issue 0024 が値を更新する。

## 現状

- 現状の `meta.json` の `status` は recording / encoding / transcribing / transcribed / summarized / error で、音声強調の状態がない。
- `chunks/` と `audio.16k.wav` は Application Support の tmp に置くが、音声強調の一時 WAV の置き場所と削除規則はない。
- `enhancement.json` はまだ存在しない。
- `meta.json` に処理状態を書き、`transcript.md` などの成果物と合わせて復旧する仕組みはあるが、音声強調の状態はない。
- 会議の削除、再文字起こし、設定変更で派生物を削除する規則は、まだ音声強調を含まない。

## 設計方針

### 対象範囲

- この issue では、`enhancement.json` の schema、`meta.json` との役割分担、一時ファイルの管理、`enhancing` 状態、空き容量の確認、ハッシュによる無効化を扱う。
- 保存音声の強調の処理は issue 0025、文字起こし前の強調と比較は issue 0024 で扱う。
- モデルのダウンロードと WebGPU エンジンは issue 0023 で扱う。
- 音声強調の ON/OFF の設定項目は、issue 0025 と issue 0024 が追加する。
- この issue は、issue 0025 と issue 0024 が使う共通の関数と型を提供する。

### `enhancement.json` の schema

- `enhancement.json` を音声強調の状態の正本とする。
- `schema_version` は schema のバージョンとする。
- `source` は `{ path, sha256, sample_rate, channels }` を持ち、会議の `audio.mp3` を表す。
- `saved_audio` はモデル ID をキーにしたマップとする。
  各項目は `{ state, model_sha256, input, output, settings, started_at, finished_at, elapsed_seconds, error }` を持つ。
  - `input` は `{ path, sha256, sample_rate, channels }` を持つ。
  - `output` は `{ path, sha256 }` を持つ。
  - `settings` は `{ chunk_seconds, hop_seconds, crossfade_seconds }` を持つ。
  - `state` は `pending`、`running`、`succeeded`、`failed`、`cancelled`、`interrupted` のいずれかとする。
- `transcription` は次の項目を持つ。
  - `source_input_sha256`: 比較セッションの共通の親にした 16 kHz WAV のハッシュ。
  - `raw`: `{ state, path, input_sha256, output_sha256, model, settings, chars, started_at, finished_at, elapsed_seconds, error }`。
  - `models`: モデル ID をキーにした同じ形のマップ。各項目は強調に使ったモデルの `model_sha256` を持つ。
  - `primary`: `{ source, path }`。`source` は `raw` またはモデル ID。
- `model` は文字起こしに使ったモデル (whisper.cpp または OpenAI)、`model_sha256` は強調モデルの SHA-256 とする。`settings` は `{ engine, whisper_model, chunk_seconds, hop_seconds, crossfade_seconds }` とし、`raw` では `chunk_seconds`、`hop_seconds`、`crossfade_seconds` を null にする。
- `enhancement.json` の書き込みは、同じディレクトリの一時ファイルに書いてから rename する。
  書き込みに失敗したときは、以前のファイルを残す。
- 読み込みに失敗したときは、派生ファイルを削除せず、警告を表示する。
- 壊れた `enhancement.json` は、会議フォルダの派生音声、`transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` から再構築する。再構築できないときは警告を表示し、会議と索引は残す。

### `meta.json` との役割分担

- `meta.json` は、会議一覧に必要な状態の要約だけを持つ。
  - `enhancement.savedAudioModels`: 強調音声があるモデル ID の一覧。
  - `enhancement.savedAudioState`: 直近の保存音声の強調の状態。
  - `enhancement.hasRawTranscript`: `transcript.raw.md` があるか。
  - `enhancement.transcriptModels`: 比較用の文字起こしがあるモデル ID の一覧。
  - `enhancement.primarySource`: `raw` またはモデル ID。
- `savedAudioModels` は `saved_audio` の `state === 'succeeded'` のキー、`transcriptModels` は `transcription.models` の `state === 'succeeded'` のキー、`hasRawTranscript` は `transcription.raw.state === 'succeeded'`、`primarySource` は `transcription.primary.source` から作る。
- `meta.json` に、`enhancement.json` の入力と出力のハッシュ、設定、処理時間を重複して書かない。
- `enhancement.json` と `meta.json` が食い違うときは、`enhancement.json` を正とし、`meta.json` を再生成する。

### 一時ファイルと空き容量

- 音声強調の一時ファイルは、`~/Library/Application Support/Kataribe/tmp/<meeting-id>/` に置く。
  - `chunks/`: 録音中の WAV チャンク。
  - `audio.16k.wav`: 文字起こし用の 16 kHz WAV。比較セッションでは `audio.mp3` から作る。
  - `audio.16k.enhanced.wav`: 強調した 16 kHz WAV。
  - `audio.decoded.wav`: `audio.mp3` からデコードした WAV。
- 録音チャンクを結合した `audio.wav` は、会議フォルダに置き、保存音声の強調と、OFF のときの 16 kHz WAV の生成後に削除する。
  保存先がクラウド同期の対象の場合、処理中は `audio.wav` が同期され得る。
- `chunks/` と `audio.16k.wav` の削除は ADR-0005 に従う。
  `audio.16k.wav` は文字起こしが失敗、キャンセル、タイムアウトしたときは再試行のために残す。
- `audio.16k.enhanced.wav` と `audio.decoded.wav` は、成功、失敗、キャンセルのいずれでも削除する。
- 起動時に、復旧データを持たない会議の tmp ディレクトリを削除する。`status` が `error` の会議、または `transcription.state` が `partial`、`failed`、`cancelled`、`interrupted` の会議は、`chunks/` と `audio.16k.wav` を残す。比較セッションの生と強調のどちらかが完了していない会議も残す。
- 音声強調を開始する前に、元 WAV、強調 WAV、デコード WAV のピークサイズを見積もり、必要な空き容量を確認する。
  空き容量が足りないときは開始せず、理由を表示する。
- 60 分、48 kHz、16 bit モノラルの元 WAV は約 346 MB、16 kHz WAV は約 115 MB になる。
  同時に保持する一時 WAV を減らし、処理が終わったものから削除する。

### 処理状態と画面

- `MeetingStatus` と `ProcessingStage` に `enhancing` を追加する。
- `MEETING_STATUSES` と `toStatus` に `enhancing` を追加する。
- `markInterruptedMeetings` の対象に `enhancing` を追加し、`src/main/processing.ts` の専用分岐で `meta.status = error`、`enhancement.json` の該当 state を `failed` または `interrupted` に更新する。
- `App.tsx`、`Sidebar.tsx`、`meetingStatusLabel`、`progressLabel` の処理中判定に `enhancing` を追加する。
- `meta.json` の `status` に `enhancing` を追加する。
- 会議一覧と会議詳細の進捗に「音声強調中」を表示する。
- 会議詳細に、音声強調の処理時間と使用モデルを表示する。表示は `EnhancementStatus.tsx` に分ける。
- 設定画面に、音声強調のディスク使用量と、強調音声を削除する操作を表示する。
- 設定画面から強調音声を削除したときは、`enhancement.json`、`meta.json`、会議詳細の音声プレイヤーの選択肢を更新する。
- 保存音声の強調と文字起こし前の強調は、同じ `enhancing` 状態を使い、進捗の文言で区別する。
- issue 0025 と issue 0024 は、処理の開始時に `meta.status = enhancing` と `ProcessingState.stage = enhancing` を設定する。

### ハッシュによる無効化

- `audio.mp3` のハッシュが `enhancement.json` の `source.sha256` と一致しないときは、古い強調音声と比較用の文字起こしを削除する。
- モデルの重みの SHA-256 が `enhancement.json` の `model_sha256` と一致しないときは、古い強調音声と比較用の文字起こしを削除する。
- 比較用の文字起こしは、`transcription.source_input_sha256` が現在の比較セッションの入力と一致しないときは削除する。
- 文字起こし前の強調を OFF にして再文字起こししたとき、OpenAI の文字起こし API を選んだとき、比較セッションの入力が変わったとき、モデルの重みの SHA-256 が変わったときは、比較用の文字起こしを削除する。
- モデルの重みを削除しても、既存の会議フォルダの強調音声と比較用の文字起こしは残す。
  再生成には再ダウンロードが必要であることを UI に表示する。
- 会議を削除したときは、`enhancement.json`、強調音声、比較用の文字起こし、一時ファイルを削除する。

### 1000 行超のファイル

- 新しいロジックは `src/main/reuse-metadata.ts` と `src/main/reuse-cleanup.ts` に置く。
- 新しい UI は `src/renderer/src/EnhancementStatus.tsx` に置く。
- `src/main/processing.ts`、`src/main/index.ts`、`src/renderer/src/MeetingDetail.tsx`、`src/renderer/src/SettingsPanel.tsx` へは配線だけを追加する。
- `src/shared/i18n.ts` が 1000 行を超える場合は、音声強調の文言を `src/shared/i18n-reuse.ts` に分ける。

## 完了条件

- [ ] `enhancement.json` の schema が、保存音声と文字起こしの入力と出力のハッシュ、使用モデル、設定、処理時間、状態、エラーを持つことをテストで固定する。
- [ ] `enhancement.json` を一時ファイルと rename で書き、書き込みに失敗したときは以前のファイルを残すことをテストで固定する。
- [ ] `enhancement.json` の読み込みに失敗したとき、派生ファイルを削除せず、警告を返すことをテストで固定する。
- [ ] 壊れた `enhancement.json` を会議フォルダから再構築し、再構築できないときも会議と索引を残すことをテストで固定する。
- [ ] `meta.json` が `enhancement.json` の詳細を重複して持たず、`enhancement.json` から再生成できることをテストで固定する。
- [ ] `enhancing` 状態を `MeetingStatus`、`ProcessingStage`、`MEETING_STATUSES`、`toStatus`、`markInterruptedMeetings`、`meta.json`、会議一覧、会議詳細、`meetingStatusLabel`、`progressLabel` に追加することをテストで固定する。
- [ ] 起動時に `enhancing` のまま残った会議を `error` にし、`enhancement.json` の該当 state を `failed` または `interrupted` に更新することをテストで固定する。
- [ ] `audio.16k.enhanced.wav` と mp3 からデコードした一時 WAV は、成功、失敗、キャンセルで削除される。`audio.16k.wav` と `chunks/` は ADR-0005 に従い、失敗、キャンセル、タイムアウトでは残ることをテストで固定する。
- [ ] 起動時に、復旧データを持たない会議の tmp ディレクトリが削除され、`status` が `error` の会議、または `transcription.state` が `partial`、`failed`、`cancelled`、`interrupted` の会議では `chunks/` と `audio.16k.wav` が残ることをテストで固定する。比較セッションの生と強調のどちらかが完了していない会議でも残る。
- [ ] 空き容量が足りないとき、音声強調を開始せず、理由を返すことをテストで固定する。
- [ ] `audio.mp3` のハッシュが変わったとき、古い強調音声と比較用の文字起こしを削除することをテストで固定する。
- [ ] モデルの重みの SHA-256 が変わったとき、古い強調音声と比較用の文字起こしを削除することをテストで固定する。
- [ ] 比較セッションの入力ハッシュが変わったとき、古い比較用の文字起こしを削除することをテストで固定する。
- [ ] 文字起こし前の強調を OFF にして再文字起こししたとき、比較用の文字起こしを削除することをテストで固定する。
- [ ] モデルの重みを削除しても、既存の強調音声と比較用の文字起こしが残ることをテストで固定する。
- [ ] 会議を削除したとき、`enhancement.json`、強調音声、比較用の文字起こし、一時ファイルが削除されることをテストで固定する。
- [ ] `MeetingSummary` に `enhancedModels`、`hasRawTranscript`、`transcriptModels`、`enhancementState` を追加し、`meta.json` から再生成できることをテストで固定する。
- [ ] `MeetingRow`、`upsert`、`rowToMeeting` に `enhanced_models`、`has_raw_transcript`、`transcript_models`、`enhancement_state` を追加し、索引を削除して再構築しても同じ結果になることをテストで固定する。
- [ ] `MeetingDetail` に `enhancement` が返り、`EnhancementStatus` が状態、処理時間、使用モデルを表示することをテストで固定する。
- [ ] 設定画面の使用量と削除の IPC が `enhancement.json` と `meta.json` を更新し、会議詳細の選択肢が変わることをテストで固定する。
- [ ] 設定画面から強調音声を削除したとき、状態と会議詳細の選択肢が更新されることをテストで固定する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md、リリースチェックリストを更新する。
- [ ] ADR-0007、ADR-0010、ADR-0012、ADR-0013、ADR-0027 の記述を、この issue の範囲に合わせて更新する。
- [ ] テスト名または module doc に、対応する `REQ-ENHANCE-001` / `REQ-ENHANCE-002` または `共通基盤` と理由を書く。

## 解決方法

### 共有の型

- `src/shared/types.ts` に `EnhancementState`、`EnhancementFile`、`EnhancementSavedAudio`、`EnhancementTranscription`、`EnhancementTranscriptionEntry` を追加する。
  `EnhancementState` は `pending`、`running`、`succeeded`、`failed`、`cancelled`、`interrupted` のいずれかとする。
- `src/shared/types.ts` の `MeetingStatus` と `ProcessingStage` に `enhancing` を追加する。
- `src/shared/types.ts` の `MeetingSummary` に `enhancedModels`、`hasRawTranscript`、`transcriptModels`、`enhancementState` を追加する。
  `enhancedModels` は `ReuseModel[]`、`hasRawTranscript` は `boolean`、`transcriptModels` は `ReuseModel[]`、`enhancementState` は `pending`、`running`、`succeeded`、`failed`、`cancelled`、`interrupted`、`null` のいずれかとする。
- `src/shared/types.ts` の `MeetingDetail` に `enhancement: EnhancementFile | null` を追加する。
- `src/main/meeting-meta.ts` に `MeetingMetaEnhancement` を追加し、`meta.json` の要約を読み書きする。

### メインプロセス

- `src/main/reuse-metadata.ts` を追加する。
  - `readEnhancementFile(meetingDir)` と `writeEnhancementFile(meetingDir, data)` を実装する。
  - `readEnhancementFile` は、ファイルがないとき、壊れているとき、schema が古いときの結果を分ける。
  - `writeEnhancementFile` は、一時ファイルと rename を使う。
  - `updateMetaEnhancement(meta, enhancement)` で、`meta.json` の要約を更新する。
- `src/main/reuse-cleanup.ts` を追加する。
  - `cleanupMeetingTemp(meetingId)` で、処理が終わった一時ファイルを削除する。ADR-0005 の保持規則に従い、失敗、キャンセル、タイムアウト時は `audio.16k.wav` と `chunks/` を残す。比較セッションの片方が完了していないときも残す。
  - `cleanupOrphanedTempDirs()` で、起動時に復旧データを持たない会議の tmp を削除する。復旧データを持つ会議は残す。
  - 起動時は `markInterruptedMeetings()` の後に `cleanupOrphanedTempDirs()` を呼ぶ。
  - `assertEnhancementDiskSpace(inputBytes, tempDir)` で、必要な空き容量を確認する。
  - `invalidateEnhancement(meetingDir, scope, reason)` で、古い強調音声と比較用の文字起こしを削除する。
    `scope` は `saved-audio`、`comparison`、`all` のいずれかとする。
    設定変更では `saved-audio` を削除せず、`comparison` だけを削除する。保存音声はモデル SHA-256 または `audio.mp3` のハッシュの変更、利用者の削除操作でだけ削除する。
    `comparison` は `transcript.raw.md`、`transcript.nemotronlabs.md`、`audio.16k.enhanced.wav` を削除し、`transcript.md` は残す。`saved-audio` は `audio.enhanced.*.mp3` を削除する。`all` は両方と `transcript.previous.md` を削除する。
- `src/main/index.ts` で、起動時に `markInterruptedMeetings()` の後に `cleanupOrphanedTempDirs()` を呼ぶ。
- `src/main/processing.ts` で、処理の開始と終了、失敗、キャンセル時に `cleanupMeetingTemp` を呼ぶ。
- `src/main/meetings.ts` で、会議の削除時に音声強調の派生物を削除する。
- `src/main/meetings.ts` の `MEETING_STATUSES` と `toStatus` に `enhancing` を追加する。
- `src/main/processing.ts` の `markInterruptedMeetings` に `enhancing` の専用分岐を追加し、`meta.status = error`、`enhancement.json` の該当 state を `failed` または `interrupted` に更新する。
- `src/renderer/src/App.tsx`、`src/renderer/src/Sidebar.tsx`、`src/renderer/src/recording-utils.ts` の `meetingStatusLabel`、`src/renderer/src/MeetingDetail.tsx` の `progressLabel` に `enhancing` を追加する。
- `src/main/search-index.ts` の `MeetingRow`、`upsert`、`rowToMeeting` に、`enhanced_models`、`has_raw_transcript`、`transcript_models`、`enhancement_state` を追加する。
  issue 0025 と issue 0024 は、それぞれの処理の完了時に値を更新する。
  schema の migration を追加し、索引を削除して再構築しても同じ結果になることを確認する。
- `src/main/meetings.ts` の `detail()` に `enhancement` を追加し、`enhancement.json` を読んで返す。
- `src/main/index.ts` に `reuse:get-enhancement`、`reuse:disk-usage`、`reuse:delete-saved-audio` を追加する。
  `src/preload/index.ts` と `src/renderer/src/env.d.ts` に同じ API を追加する。

### 画面

- `src/renderer/src/EnhancementStatus.tsx` を追加し、音声強調の状態、処理時間、使用モデルを props で受け取る。
  `MeetingDetail.tsx` は `EnhancementStatus` を組み込み、`MeetingDetail.enhancement` から値を渡す。
- `src/renderer/src/SettingsPanel.tsx` に、音声強調のディスク使用量と、強調音声を削除する操作を表示する。
  削除操作は `reuse:delete-saved-audio` を呼び、`invalidateEnhancement` を `saved-audio` の範囲で実行する。
- `src/shared/i18n.ts` に文言を追加する。1000 行を超える場合は `src/shared/i18n-reuse.ts` に分ける。

### テスト

- `tests/reuse-metadata.test.ts` を追加する。
  - schema の roundtrip、未知のバージョン、壊れた JSON、書き込み失敗を固定する。
  - `meta.json` の要約が `enhancement.json` から再生成できることを固定する。
- `tests/reuse-cleanup.test.ts` を追加する。
  - 成功、失敗、キャンセル、起動時の一時ファイル削除を固定する。
  - 空き容量不足、処理中の一時ファイルを削除しないことを固定する。
  - `audio.mp3` のハッシュ変更、比較セッションの入力変更、OFF の再文字起こしで、古い派生物が削除されることを固定する。
  - モデル削除と会議削除の扱いを固定する。
- `tests/processing.test.ts` に、`enhancing` 状態の遷移、中断時の `error` と `enhancement.json` の更新、一時ファイルの削除を追加する。
- `tests/search-index.test.ts` に、新しい要約フィールドの保存と再構築を追加する。
- `src/renderer/src/EnhancementStatus.test.tsx` に、音声強調の状態、処理時間、使用モデルの表示を追加する。
- `src/renderer/src/SettingsPanel.test.tsx` に、音声強調のディスク使用量と削除操作の表示を追加する。
- UI テストは `renderToStaticMarkup` と純粋関数で状態を固定する。
  `jsdom` と Testing Library は追加しない。
- PBT と Fuzzing は新しい依存を追加しないため採用しない。
  境界は Example-based test で網羅する。

### 文書

- `docs/adr/0010-meeting-folder-and-sqlite-index.md` に、`enhancement.json`、`transcript.previous.md`、一時ファイル、`enhancing` 状態を追加する。
- `docs/adr/0013-privacy-boundary.md` に、一時ファイルの置き場所と削除を追加する。
- `docs/adr/0007-transcription-completion-and-timeout.md` と `docs/adr/0012-menu-bar-and-main-window.md` に `enhancing` を追加する。
- `docs/adr/0027-reuse-webgpu-enhancement.md` のメタデータと後始末の記述を更新する。
- `docs/prd/kataribe.md` の非機能要件とデータ設計を更新する。
- `README.md` に、一時ファイル、ディスク使用量、`enhancing` 状態を追加し、音声強調が未実装である旨の注記を削除する。
- `CHANGES.md` の `## develop` に、メタデータと後始末の追加を記録する。
- `docs/release-checklist.md` に、一時ファイルの削除、`enhancing` 状態、ディスク使用量の確認を追加する。
