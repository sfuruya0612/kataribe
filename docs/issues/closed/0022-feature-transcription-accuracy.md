# 文字起こしの精度を上げる

- Requirements: REQ-TRANS-001, REQ-SUMMARY-002
- Priority: High
- Created: 2026-11-02
- Completed: 2026-11-02
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-transcription-accuracy

## 目的

文字起こしの入力手段と要約の前処理を増やし、会議の内容を正確に残す。
OpenAI の文字起こし API を Whisper の代わりに選べるようにし、要約の前に相槌と擬音を除く。
あわせて、NVIDIA の RE-USE を文字起こしの前処理に使うかを検証し、採用しない判断を記録する。

## 優先度根拠

文字起こしの誤りは、要約、ToDo、検索のすべてに波及する。
利用者から明示的に要求された変更であり、既定のローカル文字起こしを維持したまま任意の機能として追加できる。

## 現状

- 文字起こしは whisper.cpp の子プロセスだけで行う(ADR-0006)。設定画面でモデルを選べるが、エンジンは切り替えられない。
- 要約は文字起こしの本文をそのまま LLM に送る(ADR-0008)。「あー」「えーと」「なるほど」などの相槌も本文に残る。
- LLM プロファイルは Provider、エンドポイント URL、モデル、API キーを持つ。API キーは safeStorage に保存する(ADR-0009)。
- 音声を端末外に送らないことをプライバシー境界としている(ADR-0013)。
- `processing.ts` は 1,577 行、`SettingsPanel.tsx` は 1,589 行、`MeetingDetail.tsx` は 1,405 行あり、code-style の 1,000 行の閾値を超えている。

## 設計方針

### OpenAI 文字起こし

- 設定に `transcriptionEngine`、`openaiTranscriptionProfileId`、`openaiTranscriptionModel` を追加する。既定は `whisper-cpp`、空のプロファイル、`whisper-1` とする。
- OpenAI のモデルは `whisper-1`、`gpt-4o-transcribe`、`gpt-4o-mini-transcribe` とする。`whisper-1` 以外は区間のタイムスタンプを返さないため、分割した区間を 1 セグメントとして保存し、設定画面に制約を表示する。
- API キーは Provider が `chatgpt` の LLM プロファイルのキーを使う。文字起こし専用のキーは追加しない。
- 送信前に、送信先のホスト、モデル、音声の長さ、分割数、音声が端末外に出ることを確認ダイアログに表示する。承認しなかったときはローカルの whisper.cpp に切り替える。
- 16 kHz モノラルの WAV を 25 MiB 以下の区間に分割する。最大 10 分とし、境界は手前 5 秒で最も静かな位置に寄せる。各区間の開始時刻を加算する。
- 429 と 5xx は指数バックオフで初回を含めて最大 3 回試行する。400、401、403、404、413 は再試行しない。途中までの結果は部分結果として保存する。
- 新しい処理は `src/main/openai-transcription.ts` と `src/main/transcription-runner.ts` に置く。`processing.ts` はエンジンの解決と永続化の呼び出しだけを行う。
- ADR-0013 に OpenAI 文字起こしの例外を追加し、ADR-0024 に判断を記録する。

### 相槌と擬音の除去

- 設定に `removeFillersBeforeSummary` を追加し、既定を `true` とする。
- `generateSummary` の前に `src/main/transcript-cleanup.ts` の `cleanTranscript` を呼ぶ。同じ LLM プロファイルと送信先を使う。
- 区間は 8,000 文字以下の行単位とする。出力の各行が入力に存在するタイムスタンプの接頭辞を順序を保って含むことを検査する。検査に失敗した区間は元の本文を使う。
- すべての区間で失敗したときは、元の文字起こしで要約する。要約自体は失敗させない。
- 整えた本文はファイルに保存しない。`meta.json` の `summary.cleanup` に文字数、区間数、失敗数、状態を記録する。
- 確認ダイアログに、文字起こしを 2 回送ることと、概算トークン数が増えることを表示する。
- ADR-0025 に判断を記録する。

### RE-USE の検証

- `NVIDIA-NemotronLabs-RE-USE` を macOS の非公式 PyTorch 移植で動かし、日本語の合成音声にノイズを加えて whisper.cpp の CER を比較する。
- 16 kHz の音声で、5 秒チャンクと全体推論を比較する。44.1 kHz の全体推論も計測する。
- 結果を `docs/testing/reuse-speech-enhancement.md` に記録し、ADR-0026 で入力時にも文字起こし前にも採用しない判断を記録する。
- アプリに RE-USE のコード、重み、Python 環境を追加しない。

### 対象外

- OpenAI の文字起こし API のストリーミング。アプリの文字起こしは完了後に保存するため、途中の表示は使わない。
- OpenAI の `gpt-4o-transcribe-diarize` による話者分離。既存のローカル話者分離を使う。
- 相槌と擬音を除いた本文のファイル保存。必要になった時点で別 issue を起票する。
- RE-USE の WebGPU 実装のアプリへの同梱。

## 完了条件

- [x] REQ-TRANS-001 の受入基準「設定画面の「文字起こし」で、文字起こしエンジンを「ローカル (whisper.cpp)」と「OpenAI API」から選べる」を満たす。
- [x] REQ-TRANS-001 の受入基準「既定のエンジンはローカル (whisper.cpp) とする」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API を選んだとき、音声を送信する前に、送信先のホスト、モデル、音声の長さ、分割数、音声が端末外に出ることを確認ダイアログに表示する」を満たす。
- [x] REQ-TRANS-001 の受入基準「確認ダイアログで送信を承認したときだけ、音声を OpenAI API に送る」を満たす。
- [x] REQ-TRANS-001 の受入基準「承認しなかったときは音声を送らず、ローカルの whisper.cpp で文字起こしを続ける。ローカルのモデルがない場合は、モデルがない旨を表示する」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API の文字起こしモデルとして `whisper-1`、`gpt-4o-transcribe`、`gpt-4o-mini-transcribe` を選べる。既定は `whisper-1` とする」を満たす。
- [x] REQ-TRANS-001 の受入基準「`whisper-1` 以外のモデルを選んだとき、文字起こしのタイムスタンプが分割単位になることを設定画面に表示する」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API の API キーは、Provider が ChatGPT の LLM プロファイルに保存したキーを使う」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API のリクエストは API の上限以下に分割し、分割した各区間の開始時刻を加算して文字起こしの時刻にする」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API が失敗したときは、成功した区間までの文字起こしを部分結果として保存し、失敗の理由を会議詳細に表示する」を満たす。
- [x] REQ-TRANS-001 の受入基準「OpenAI API に送るのは文字起こし用の音声と、モデル名、用語集、応答形式だけとし、会議のタイトル、日付、保存先のパスは送らない」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「設定画面の「要約」で、要約の前に相槌と擬音を除くかどうかを選べる。既定は除くとする」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「除く設定が有効なとき、要約の生成は、文字起こしを LLM に送って相槌と擬音を除いた本文を作り、その本文を要約に使う」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「相槌と擬音を除く処理と要約の生成は、同じ LLM プロファイルと送信先を使う」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「送信前の確認ダイアログに、相槌と擬音を除く処理でも文字起こしを送ることと、送信が 2 回になることを表示する」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「相槌と擬音を除く処理が失敗したときは、元の文字起こしで要約を生成し、その旨を利用者に表示する」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「相槌と擬音を除く処理は、話者ラベルとタイムスタンプを保持する。相槌だけの発話行は削除してよい」を満たす。
- [x] REQ-SUMMARY-002 の受入基準「要約の出力言語は、相槌と擬音を除く設定で変えない」を満たす。
- [x] OpenAI のリクエスト本文、区間分割、タイムスタンプの加算、再試行、部分結果、キャンセルをテストで固定する。
- [x] 相槌除去のプロンプト、区間分割、タイムスタンプの検査、失敗時のフォールバック、送信回数と使用トークンの合算をテストで固定する。
- [x] 設定の既定値、正規化、存在しないプロファイルの扱いをテストで固定する。
- [x] 設定画面の日本語と英語の文言、エンジン選択、OpenAI のプロファイルとモデル、制約の表示をテストで固定する。
- [x] RE-USE の検証結果と採用しない判断を ADR-0026 と `docs/testing/reuse-speech-enhancement.md` に記録する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README と CHANGES.md を同じ変更で更新する。
- [x] 依存パッケージを追加しない。

## 解決方法

### 共有の型と設定

- `src/shared/types.ts` に `TranscriptionEngine`、`OpenAiTranscriptionModel`、`TranscriptionCleanupState` を追加する。
- `AppSettings` に `transcriptionEngine`、`openaiTranscriptionProfileId`、`openaiTranscriptionModel`、`removeFillersBeforeSummary` を追加する。
- `SummaryPreview` に `cleanupEnabled`、`cleanupEstimatedTokens` を追加する。
- `GenerateSummaryResult` に `cleanup` を追加する。
- `src/shared/settings.ts` の `DEFAULT_APP_SETTINGS` と `normalizeAppSettings` を更新する。`openaiTranscriptionProfileId` は Provider が `chatgpt` のプロファイルだけを候補にし、見つからないときは既定の ChatGPT プロファイル、なければ空文字にする。
- `src/shared/openai-transcription.ts` を追加する。
  - `OPENAI_TRANSCRIPTION_MODELS`、`DEFAULT_OPENAI_TRANSCRIPTION_MODEL`、`isOpenAiTranscriptionModel`、`normalizeOpenAiTranscriptionModel` を持つ。
  - `buildOpenAiTranscriptionEndpoint(baseUrl)` は末尾の `/` を除き、`/audio/transcriptions` を付ける。
  - `openAiModelHasSegmentTimestamps(model)` は `whisper-1` のときだけ `true` を返す。
  - `normalizeOpenAiLanguage(value)` は `japanese` を `ja`、`english` を `en` に変換する。
  - `parseOpenAiTranscriptionResponse(text, model, offsetSeconds, chunkDurationSeconds)` は `verbose_json` の `segments` と `language` を返す。`json` のときは区間全体を 1 セグメントにする。
  - `estimateOpenAiChunkCount(durationSeconds)` は最大 10 分で分割した区間数を返す。

### WAV の分割

- `src/main/wav.ts` に `WavChunk`、`planWavChunks`、`writeWavChunk` を追加する。
- `planWavChunks(path, info, options)` は `maxBytes` と `chunkSeconds` から各区間の開始と終了を決める。境界の手前 5 秒を読み、20 ms ごとの RMS が最小の位置を境界にする。候補が開始から 0.5 秒未満になる場合は開始から 0.5 秒の位置を使う。
- `writeWavChunk` は元の WAV のデータ領域から指定範囲を読み、新しい WAV ヘッダーと PCM を `0o600` で書き出す。
- 区間のファイルは `join(tempDir, 'openai-chunks-<pid>-<uuid>')` に置き、処理の最後に削除する。

### OpenAI 文字起こしサービス

- `src/main/openai-transcription.ts` を追加する。
- `OpenAiTranscriptionService` は `fetch`、`sleep`、`now`、`maxAttempts`、`chunkSeconds`、`maxBytes` を注入できる。
- `transcribe(options)` は `TranscriptionOutcome` を返す。
  - 各区間の WAV を書き出し、手書きの multipart/form-data で `POST` する。`file`、`model`、`response_format`、`temperature`、任意の `prompt` を送る。
  - `whisper-1` は `verbose_json`、それ以外は `json` を要求する。
  - `authorization` に API キーを付け、`accept` に `application/json` を付ける。
  - 429 と 5xx は初回を含めて最大 3 回試行する。400、401、403、404、413 は再試行しない。
  - 成功した区間のセグメントを結合し、`onUpdate` と `onPartial` を呼ぶ。
  - 終了時に区間のファイルを削除する。
- `TranscriptionErrorCode` に `openai-config`、`openai-rate-limit`、`openai-server`、`openai-network`、`openai-failed`、`file-too-large` を追加する。

### エンジンの解決

- `src/main/transcription-runner.ts` を追加する。
- `TranscriptionRunner` は設定、`ApiKeyStore`、`ModelManager`、`TranscriptionService`、`OpenAiTranscriptionService`、確認ダイアログのコールバックを受け取る。
- `run(options)` は次を順に行う。
  - 設定からエンジンを読む。
  - OpenAI のときは ChatGPT プロファイルと API キーを解決し、確認ダイアログを出す。承認しなければローカルに切り替える。
  - ローカルのときはモデルのインストールを確認する。
  - 選択したサービスを呼び、`outcome`、実際に使ったエンジン、モデルの表示名、フォールバックの通知を返す。
- `processing.ts` は `TranscriptionRunner` を呼び、`meta.json` の `transcription.engine` と `model` を実際に使った値で更新する。部分結果の保存にはモデルの表示名を使う。

### 相槌と擬音の除去

- `src/main/transcript-cleanup.ts` を追加する。
  - `CLEANUP_CHUNK_CHARS = 8_000`。
  - `buildCleanupSystemPrompt()` と `buildCleanupUserPrompt(chunk)` を追加する。
  - `splitTranscriptForCleanup(body, maxChars)` は行単位で重複なしに分割する。
  - `cleanTranscript(options)` は各区間を LLM に送り、出力のタイムスタンプ、話者ラベル、本文が入力の削除だけで得られることを検査する。失敗した区間は元の本文を使い、`fallbackChunks` を返す。
  - `cleanup` の状態は `completed`、`partial`、`failed`、`skipped` のいずれかとする。
- `src/main/summary.ts` の `generateSummary` に `cleanupFillers` を追加し、要約の前に `cleanTranscript` を呼ぶ。使用トークンと区間数を合算する。失敗時は元の本文で続行する。
- `src/main/processing.ts` の `createSummaryPreview` で `cleanupEnabled` と `cleanupEstimatedTokens` を返し、`generateSummary` で `cleanup` を `meta.json` と戻り値に記録する。
- `src/main/meeting-meta.ts` に `MeetingMetaSummaryCleanup` を追加する。

### 画面

- `src/renderer/src/SettingsPanel.tsx` の「文字起こし」にエンジンの選択、OpenAI のプロファイルとモデル、制約の表示を追加する。API キーの設定は「要約」タブの ChatGPT プロファイルで行う旨を表示し、タブを切り替えるボタンを置く。
- 同画面の「要約」に相槌と擬音の除去のチェックボックスを追加する。
- `src/renderer/src/MeetingDetail.tsx` の送信確認ダイアログに、相槌と擬音の除去で 2 回送信する旨と、追加の概算トークンを表示する。生成結果の `cleanup.state` が `failed` または `partial` のときは、元の文字起こしで要約した旨を表示する。
- `src/shared/i18n.ts` に日本語と英語の文言を追加する。
- `src/renderer/src/styles.css` に必要な最小限のスタイルを追加する。

### テスト

- `tests/openai-transcription.test.ts` を追加する。
  - エンドポイント、モデル、タイムスタンプの有無、言語の正規化、区間数の見積もりを固定する。
  - multipart の本文とヘッダーを固定する。
  - 429 と 5xx の再試行、400 と 413 の非再試行、部分結果、キャンセルを固定する。
  - 25 MiB を超えないこと、区間の開始時刻が加算されることを固定する。
- `tests/wav.test.ts` に区間分割と WAV の書き出しを追加する。無音への境界の寄せ、最大バイト数、PCM の一致、ヘッダーの整合を固定する。
- `tests/transcription-runner.test.ts` を追加する。エンジンの解決、確認の拒否によるローカルへのフォールバック、モデル未取得、API キー未設定を固定する。
- `tests/summary.test.ts` に相槌除去の呼び出し順、プロファイルの共有、使用トークンの合算、検査失敗時のフォールバック、設定が無効なときの呼び出しなしを追加する。
- `tests/processing.test.ts` に OpenAI エンジンのメタデータ、フォールバック、部分結果の保存を追加する。
- `tests/settings.test.ts` に設定の既定値と正規化を追加する。
- `src/renderer/src/SettingsPanel.test.tsx` にエンジン選択、OpenAI のモデル、制約、相槌除去の設定を追加する。
- `tests/i18n.test.ts` と `tests/i18n-usage.test.ts` の既存検査で、追加した文言を検証する。

### 文書

- `docs/prd/kataribe.md` に `REQ-TRANS-001` と `REQ-SUMMARY-002` を追加し、スコープ、非機能要件、アーキテクチャ、ユーザーフロー、画面、リスクを更新する。
- `docs/adr/0024-openai-transcription-api.md`、`docs/adr/0025-filler-removal-before-summary.md`、`docs/adr/0026-reuse-not-adopted-for-transcription.md` を追加する。
- `docs/adr/0006-whisper-cpp-and-model-management.md` と `docs/adr/0013-privacy-boundary.md` を更新する。
- `docs/testing/reuse-speech-enhancement.md` を追加する。
- `README.md` の文字起こし、設定、プライバシーの節を更新する。
- `CHANGES.md` の `## develop` に OpenAI 文字起こしと相槌除去の追加を記録し、`### misc` に ADR、検証記録、README の更新を記録する。

## 実施結果

- OpenAI 文字起こしは `TranscriptionRunner` でエンジンを解決し、`OpenAiTranscriptionService` で 25 MiB 以下、最大 10 分の区間に分割して送信する。送信前に確認ダイアログを出し、承認しなかった場合はローカルの whisper.cpp に切り替える。API キーは ChatGPT プロファイルのキーを使う。
- 相槌と擬音の除去は `transcript-cleanup.ts` で行い、要約の前に同じ LLM プロファイルで実行する。タイムスタンプ、話者ラベル、本文が入力の文字の削除だけで得られることを検査し、失敗した区間は元の本文を使う。
- 設定画面の追加 UI は `TranscriptionEngineSettings.tsx` と `SummaryCleanupSetting.tsx` に分けた。既存の CSS クラスで足りたため、`styles.css` は変更していない。
- テストは `src/main/wav.test.ts`、`tests/openai-transcription.test.ts`、`tests/transcription-runner.test.ts`、`tests/summary.test.ts`、`tests/processing.test.ts`、`tests/settings.test.ts`、`src/renderer/src/SettingsPanel.test.tsx`、`src/renderer/src/TranscriptionEngineSettings.test.tsx`、`src/renderer/src/SummaryCleanupWarning.test.tsx` に追加した。
- `npm run typecheck`、`npm test` (462 件)、`npm run build` が通る。
- RE-USE の検証は `docs/testing/reuse-speech-enhancement.md` と ADR-0026 に記録し、入力時にも文字起こしの前処理にも採用しない判断にした。先行モデルの `nvidia/RE-USE` も同じ移植先で動くが、NSCLv1 が非商用の研究・教育目的に限るため、アプリの選択肢にしない。
- 計画との差分: `wav` のテストは既存の `src/main/wav.test.ts` に追加した。`styles.css` は変更していない。設定画面の UI は `SettingsPanel.tsx` に直書きせず、新しい 2 つのコンポーネントに分けた。確認ダイアログの 2 回送信の警告は `SummaryCleanupWarning.tsx` に分け、テストを追加した。
