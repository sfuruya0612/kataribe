# 文字起こし前の RE-USE 強調と、生 / 強調の文字起こし比較を追加する

- Requirements: REQ-ENHANCE-002, REQ-DIAR-003 (REQ-DIAR-002 の既存の再利用を維持する)
- Priority: High
- Created: 2026-11-03
- Completed: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-transcription-accuracy

## 目的

文字起こしの前に RE-USE の音声強調を適用するかどうかを選べるようにする。
生の 16 kHz 音声で文字起こしした結果と、強調した音声で文字起こしした結果を保存し、会議詳細で切り替えて比較できるようにする。
要約と翻訳は `transcript.md`、ToDo は `summary.md` を正とし、比較用の文字起こしを混ぜない。

## 優先度根拠

WebGPU エンジン、モデル管理、音声のチャンク処理は issue 0023 で作る。
メタデータ、一時ファイル、処理状態は issue 0026 で作る。
この issue は、文字起こしの処理と比較 UI に集中できる。
文字起こしの精度は会議の検索と要約の品質を直接決めるため、実会議で比較できる経路を早く用意する。

## 現状

- 録音停止後は、16 kHz WAV を 1 つ作り、whisper.cpp または OpenAI の文字起こし API に渡す。
- 文字起こしの結果は `transcript.md` に 1 つだけ保存する。生と強調を比較するファイルはない。
- 要約と翻訳は `transcript.md` を読み、ToDo は `summary.md` を読む。
- 会議詳細の再文字起こしは、文字起こしがないとき、またはエラーのときだけ表示される。
- issue 0023 で、商用モデルの管理、WebGPU エンジン、音声のチャンク処理が入る。
- issue 0026 で、`enhancement.json`、一時ファイル、`enhancing` 状態が入る。
- `enhanceBeforeTranscription` の設定は、この issue で追加する。

## 設計方針

### 対象範囲

- この issue では、文字起こし前の強調、生 / 強調の文字起こし比較、会議詳細からの再実行、OpenAI の二重送信防止を扱う。
- 録音停止後の保存音声の強調は issue 0025 で扱う。
- モデルのダウンロードと WebGPU エンジンは issue 0023 で扱う。
- `enhancement.json` の schema と一時ファイルの後始末は issue 0026 で扱う。
- REQ-DIAR-003 の話者分離キャッシュをこの issue で扱う。
- 録音中の入力へのリアルタイム強調は扱わない。
- アプリが扱うモデルは、商用利用が可能な `nemotronlabs` だけとする。
  研究および教育用のモデルは、比較の選択肢、文字起こし、メタデータのいずれにも含めない。

### 文字起こしエンジンの解決

- `processMeeting` の開始時に `TranscriptionRunner` のエンジン解決を 1 回だけ行い、比較フロー全体で同じ解決結果を使う。
- `TranscriptionRunner` に `plan` を公開し、確認ダイアログを含む解決を 1 回だけ実行する。
  `run` は `plan` を受け取り、2 回目以降は解決と確認をやり直さない。
- 解決結果が `openai` のときは、文字起こし前の強調が ON なら強調した音声だけを 1 回送り、OFF なら生の音声だけを 1 回送る。強調に失敗したときは生の音声を送る。
  送信を承認しなかったときは、解決結果をローカルに切り替え、設定に応じて比較フローまたは通常のローカル文字起こしを実行する。
- 強調に失敗したときは、生の音声だけで文字起こしする。
- OpenAI の確認ダイアログには、強調の設定と成否に応じて送る音声を表示する。
  比較を行わないことと、比較用ファイルを削除することも表示する。
- OpenAI の文字起こし API では、比較用の `transcript.raw.md` と `transcript.nemotronlabs.md` を作らない。
  既存の比較用ファイルがあるときは削除する。

### 比較セッションの流れ

比較セッションは、1 つの 16 kHz WAV から生と強調の文字起こしを作る単位とする。

1. 比較セッションの入力にする `audio.16k.wav` を用意する。
   録音直後と再実行のどちらも、`audio.mp3` から `audio.16k.wav` を 1 回だけ作り、生と強調の共通の親にする。
   PCM から `audio.16k.wav` は作らない。
   既存の PCM 由来の `audio.16k.wav` があれば削除してから作り直す。
2. 比較セッションの入力ハッシュを `enhancement.json.transcription.source_input_sha256` に記録する。
3. `audio.16k.wav` で文字起こしし、完了した結果だけを `transcript.raw.md` に保存する。話者分離は行わない。
4. `audio.16k.wav` を WebGPU で強調し、`audio.16k.enhanced.wav` を作る。
5. `audio.16k.enhanced.wav` で文字起こしし、完了した結果を `transcript.nemotronlabs.md` に保存する。話者分離は行わない。
6. 強調した結果を `transcript.md` に保存し、話者分離を行う。
   強調に失敗したときは、生の結果を `transcript.md` に保存し、話者分離を行う。
7. 比較セッションの入力、各結果の入力と出力のハッシュ、使用モデル、設定、処理時間を `enhancement.json` に記録する。
8. `audio.16k.enhanced.wav` は文字起こしが終わったら削除する。
   `audio.16k.wav` は ADR-0005 に従い、比較セッションの生と強調のどちらかが失敗、キャンセル、タイムアウトしたときは再試行のために残す。
9. 比較セッションの開始時に `meta.status` と `ProcessingState.stage` を `enhancing` にし、生の比較、強調、強調後の文字起こしの進捗を更新する。

- 比較用の文字起こしは、完了した結果だけを保存する。部分結果は保存しない。
- 比較用の文字起こしは読み取り専用のスナップショットとし、本文は生成時の内容を保持する。front matter の title は会議タイトルに追従する。
- `transcript.md` は強調した結果を正とし、強調に失敗したときは生の結果を正とする。
  どちらを正にしたかを `enhancement.json.transcription.primary` に記録する。
- 強調に失敗した理由は `enhancement.json.transcription.entries[].error` に記録し、会議詳細は `MeetingDetail.enhancement` から表示する。
- 話者分離のキャッシュキーには、`audio.mp3` の SHA-256、入力の種類 (`raw` または `enhanced:nemotronlabs`)、強調モデルの SHA-256、強調設定を含める。
  `raw` のときは PCM 由来と mp3 由来の WAV を同じキーにし、通常の再文字起こしでキャッシュを再利用する。
  強調の有無で入力が変わったときに、古いターンを再利用しない。
- 文字起こし前の強調を OFF にして再文字起こししたとき、OpenAI の文字起こし API を選んだとき、比較セッションの入力が変わったときの比較用ファイルの削除は、issue 0026 の `invalidateEnhancement` を `comparison` の範囲で使う。
- モデルの重みの SHA-256 が変わったときの削除は、issue 0026 の `invalidateEnhancement` を `all` の範囲で使う。
- `audio.mp3` のハッシュが変わったときの削除は、issue 0026 の `invalidateEnhancement` を `all` の範囲で使う。

### 失敗とキャンセル

#### 初回の文字起こし

- WebGPU が使えないときは、強調を実行せず、生の文字起こしを `transcript.md` と `transcript.raw.md` に保存し、理由を会議詳細に表示する。
- 強調の実行または強調した文字起こしに失敗したときは、生の文字起こしを `transcript.md` と `transcript.raw.md` に保存し、`transcript.nemotronlabs.md` は作らない。
  失敗理由を `enhancement.json` と会議詳細に表示する。
- 生の文字起こしに失敗したが、強調した文字起こしに成功したときは、`transcript.md` と `transcript.nemotronlabs.md` を正とし、`transcript.raw.md` は作らない。
  失敗理由を記録する。
- 初回の文字起こしで両方に完了結果がないときは、`transcript.md` にその時点までの部分結果を保存する (ADR-0007)。
  比較用は完了した側だけを保存する。強調した文字起こしに部分結果があればそれを、なければ生の部分結果を `transcript.md` とする。部分結果が 0 セグメントのときは `transcript.md` を作らない。
- 初回の文字起こしの途中でキャンセルされたときは、`transcript.md` は ADR-0007 に従い、その時点までの部分結果を保存する。
  比較用の `transcript.raw.md` と `transcript.nemotronlabs.md` は、完了した側だけを保存する。
- 比較用の文字起こしには、部分結果の保存、再開、話者分離を行わない。

#### 再実行

- 再実行は、生と強調の両方の文字起こしが成功したときだけ成功とする。
- どちらかが失敗したときは、`transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` を変更せず、失敗理由を会議詳細に表示する。
  `transcript.previous.md` は残す。
  `transcript.previous.md` は履歴なので、会議タイトルを変えても front matter の title を更新しない。
- 再実行の途中でキャンセルされたときも、以前の結果を残す。
- 再実行の部分結果は保存しない。
- 再実行に成功したときだけ、`transcript.raw.md`、`transcript.nemotronlabs.md`、`transcript.md` を新しい結果で置き換える。

### 会議詳細からの再実行

- 会議詳細に「文字起こし前の強調を再実行」ボタンを追加する。
  文字起こしが完成している会議でも実行できるようにする。
- 再実行の前に、既存の `transcript.md` を `transcript.previous.md` にコピーし、上書きを確認する。
  既存の `transcript.previous.md` は上書きする。
  `transcript.md` がない会議ではコピーせず、上書きの確認も出さない。
  コピー後も `transcript.md` は成功するまで変更しない。
- 比較セッションの入力は毎回 `audio.mp3` から作り、生と強調で共有する。
  通常の文字起こしの入力とは異なることを画面に表示する。
- 再実行中は進捗とキャンセルを表示し、同じ会議の文字起こしを同時に実行しない。
- 再実行は、`audio.mp3` があり、モデルがインストール済みで、WebGPU が使えるときだけ有効にする。
- 再実行に成功したときは、`transcript.raw.md`、`transcript.nemotronlabs.md`、`transcript.md` を新しい結果で置き換える。
  失敗またはキャンセルのときは、以前の結果を残す。
- 既存の要約と翻訳は、再実行した文字起こしに基づかないことを会議詳細に表示し、再生成を促す。
- 文字起こし前の強調を OFF にして再文字起こししたときは、比較用の文字起こしを削除する。
- 比較用の文字起こしを表示しているときは、編集、翻訳、話者名の変更を無効にし、比較用であり検索、翻訳、要約、ToDo の入力ではないことを表示する。

### ファイルとデータ

- `transcript.raw.md` と `transcript.nemotronlabs.md` は `transcript.md` と同じ Markdown 形式 (ADR-0011) で保存する。
  front matter の `model` は whisper.cpp のモデル名とし、強調の情報は `enhancement.json` に置く。
- `transcript.raw.md` は生の文字起こしのスナップショット、`transcript.nemotronlabs.md` は強調した文字起こしのスナップショットとする。
- `transcript.md` は強調した結果、または強調に失敗したときの生の結果とする。
  編集、翻訳、話者名の変更、要約の対象は `transcript.md` だけにする。
- 会議タイトルを変更したときは、`transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` の front matter の `title` を更新する。
  本文は変更しない。
- 要約と翻訳は `transcript.md` を使い、ToDo は `summary.md` を使う。
  `transcript.raw.md` と `transcript.nemotronlabs.md` は要約、翻訳、検索、ToDo の入力にしない。
- issue 0026 が追加する `MeetingSummary.hasRawTranscript` と `transcriptModels` を、比較用の文字起こしの生成時に更新する。
  `transcriptModels` は比較用の文字起こしがあるモデル ID の一覧とする。
- `MeetingDetail` に `transcriptComparisons` を追加する。
  `{ raw: TranscriptDocument | null; models: Partial<Record<ReuseModel, TranscriptDocument>> }` の形にする。
- `MeetingStore` で `transcript.raw.md` と `transcript.nemotronlabs.md` を読み、`transcript.md` とは別に返す。
  `transcript.md` がない場合は、比較用の文字起こしも返さない。
- `MeetingSearchIndex` の文字起こしの取り込み元は `transcript.md` だけにする。
  `MeetingRow`、`upsert`、`rowToMeeting` の `has_raw_transcript` と `transcript_models` の列は issue 0026 が追加する。この issue では、比較用の文字起こしの生成時に値を更新する。
- 会議の削除、再文字起こし、設定変更で不要になった比較用ファイルを削除する。

### 画面

- `src/renderer/src/TranscriptComparison.tsx` を追加する。
  - 選択肢は「現在の文字起こし」(`transcript.md`)、「生」(`transcript.raw.md`)、「強調」(`transcript.nemotronlabs.md`) とする。
  - 既定は「現在の文字起こし」とする。
  - 比較用を選んだときは、編集、翻訳、話者名の変更を無効にする。
  - 比較用であること、読み取り専用のスナップショットであること、検索、翻訳、要約、ToDo の入力ではないことを表示する。
- `src/renderer/src/MeetingDetail.tsx` の文字起こしペインに `TranscriptComparison` を組み込む。
- `src/renderer/src/ReuseSettings.tsx` に、文字起こし前の強調の ON/OFF と、OpenAI では比較しない旨を追加する。
- 処理中は、`文字起こし前の音声を強調しています`、`生の音声で文字起こししています`、`強調した音声で文字起こししています` を進捗に表示する。
- `src/shared/i18n.ts` に日本語と英語の文言を追加する。1000 行を超える場合は `src/shared/i18n-reuse.ts` に分ける。

### 既存の処理との統合

- `src/main/processing.ts` の `transcribe` を、1 つの WAV を文字起こしして保存する処理と、比較セッションを進行する処理に分ける。
- 比較の進行、入力ハッシュの照合、`enhancement.json` の更新は `src/main/transcript-comparison.ts` に分ける。古い比較用ファイルの削除は issue 0026 の `invalidateEnhancement` を使う。
  `processing.ts` は `processMeeting` からその関数を呼ぶだけにする。
- `TranscriptionRunner` に `plan` を追加し、`processMeeting` が 1 回だけ解決する。
  OpenAI の確認ダイアログを 2 回出さないため、比較を行うのは解決結果がローカルのときだけにする。
- 既存の部分結果、再開、ハードリミット、話者分離、翻訳の話者名の書き換えは、初回の文字起こしでは `transcript.md` に対して従来どおり動かす。
  再実行では部分結果を保存せず、両方成功したときだけ置き換える。
- 速度比の学習は primary の 1 回だけ行い、比較用の生文字起こしと強調した文字起こしでは更新しない。
- 比較用の文字起こしでは、部分結果の保存、再開、話者分離を行わない。
  タイムアウトや失敗の扱いは、既存の `TranscriptionService` の結果を使うが、比較用のファイルには完了した結果だけを書く。
- 要約前の相槌の除去は `transcript.md` だけを対象にし、比較用の文字起こしには適用しない。

### 1000 行超のファイル

- 新しいロジックと UI は `src/main/transcript-comparison.ts`、`src/renderer/src/TranscriptComparison.tsx`、`src/renderer/src/StaleTranscriptNotice.tsx` に置く。
- `src/main/processing.ts`、`src/main/meetings.ts`、`src/renderer/src/MeetingDetail.tsx` へは配線だけを追加する。
- `src/shared/i18n.ts` が 1000 行を超える場合は、音声強調の文言を `src/shared/i18n-reuse.ts` に分ける。
- open の issue 0018 の分割方針に従い、既存の 1000 行超ファイルの分割をこの issue の範囲に含めない。

## 完了条件

- [x] REQ-ENHANCE-002 の受入基準「設定画面の「文字起こし」で、文字起こし前の強調を ON/OFF できる。既定は OFF とする」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「強調を ON にした会議は、比較セッションで `audio.mp3` から 16 kHz WAV を 1 回だけ作り、生の文字起こしと強調の入力の共通の親にする。強調した 16 kHz WAV はその WAV から作る。比較セッションでは PCM 由来の `audio.16k.wav` を作らない」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「比較用に、生の音声で文字起こしした `transcript.raw.md` と、強調した音声で文字起こしした `transcript.nemotronlabs.md` を保存する。`transcript.md` は強調した結果を正とし、強調に失敗したときは生の結果を正とする」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「会議詳細の文字起こしペインで、生と強調の文字起こしを切り替えて比較できる。比較用の文字起こしは読み取り専用のスナップショットとし、本文は生成時の内容を保持する。front matter の title は会議タイトルに追従する」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「会議詳細から、インストール済みの商用モデルで文字起こし前の強調を再実行できる。再実行の前に既存の `transcript.md` を `transcript.previous.md` にコピーし、上書きを確認する。コピー後も `transcript.md` は成功するまで変更しない」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「再実行は、生と強調の両方の文字起こしが成功したときだけ成功とする。成功したときは比較用の文字起こしと `transcript.md` を新しい結果で置き換え、どちらかが失敗またはキャンセルしたときは以前の結果を残す」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「文字起こしの再実行に成功したときは、既存の要約と翻訳が以前の文字起こしに基づくことを会議詳細に表示する」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「初回の文字起こしで強調に失敗したときは、生の音声で文字起こしし、失敗理由を会議詳細に表示する。比較用は成功した側だけを保存する」を満たす。
- [x] WebGPU が使えないとき、強調を実行せず生の音声で文字起こしし、理由を表示することをテストで固定する。
- [x] REQ-ENHANCE-002 の受入基準「OpenAI の文字起こし API を選んだときは、音声の二重送信を避けるため、生との比較を行わない。文字起こし前の強調が ON なら強調した音声だけを 1 回送り、OFF なら生の音声だけを 1 回送る。強調に失敗したときは生の音声を送る。送信の確認ダイアログには、強調の設定と成否に応じて送る音声を表示する」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「要約と翻訳は `transcript.md` を使い、ToDo は `summary.md` を使う。`transcript.raw.md` と `transcript.nemotronlabs.md` は比較用であり、要約、翻訳、検索、ToDo の入力にしない」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「強調と文字起こしの処理時間、使用モデル、設定、入出力のハッシュを `enhancement.json` に記録する」を満たす。
- [x] REQ-ENHANCE-002 の受入基準「`audio.mp3` のハッシュが変わったとき、文字起こし前の強調を OFF にして再文字起こししたとき、OpenAI の文字起こし API を選んだとき、比較セッションの入力が変わったとき、モデルの重みの SHA-256 が変わったときは、古い比較用の文字起こしを削除する」を満たす。
- [x] OpenAI 文字起こしを選んだときは比較を行わず、音声を二重送信しないことをテストで固定する。
  送信を承認したときと拒否したときの両方で、送信回数を固定する。
- [x] 強調、生文字起こし、強調文字起こしの成功、片側失敗、両側の部分結果、強調の失敗の組み合わせで、`transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` の内容が設計方針どおりになることをテストで固定する。
- [ ] キャンセルしたときの `transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` の内容をテストで固定する。
- [x] 初回の文字起こしで両方に完了結果がないとき、`transcript.md` に部分結果を保存し、強調の部分結果を優先し、なければ生の部分結果を使い、比較用は完了した側だけになることをテストで固定する。
- [x] 再実行でどちらかが失敗したとき、`transcript.md` と比較用の文字起こしが変わらないことをテストで固定する。
- [x] 比較用の文字起こしが検索索引に使われないことをテストで固定する。
- [ ] 翻訳、要約、ToDo が `transcript.md` だけを使い、比較用の文字起こしを使わないことを結合テストで固定する。
- [x] 話者分離が `transcript.md` にだけ行われ、比較用の文字起こしには行われないことをテストで固定する。
- [x] 話者分離のキャッシュキーが、`audio.mp3` のハッシュ、入力の種類、強調モデルの SHA-256、強調設定を含み、raw の PCM と mp3 の差では一致し、enhanced の強調モデルまたは強調設定の変更では一致しないことをテストで固定する。
- [x] REQ-DIAR-003 の受入基準「同じ `audio.mp3`、同じ入力の種類、同じ強調モデル、同じ強調設定で再文字起こししたとき、話者分離の CLI を起動せず、保存済みターンでラベルを付ける」を満たす。
- [x] REQ-DIAR-003 の受入基準「入力の種類が `raw` のときは、PCM 由来と mp3 由来の 16 kHz WAV の差を同一視する」を満たす。
- [x] REQ-DIAR-003 の受入基準「入力の種類、強調モデル、強調設定のいずれかが変わったとき、キャッシュを無効化して話者分離を再実行する」を満たす。
- [x] REQ-DIAR-003 の受入基準「キャッシュの読み書きに失敗しても、文字起こしと話者分離は完了する」を満たす。
- [x] 入力ハッシュが変わった再文字起こしで、古い比較用文字起こしが削除されることをテストで固定する。
- [x] `enhanceBeforeTranscription` を OFF にした再文字起こしで、比較用ファイルが削除されることをテストで固定する。
- [x] 会議詳細の生 / 強調の切り替え、編集と翻訳の無効化、比較用の表示を UI テストで固定する。
- [x] 会議タイトルを変更したとき、比較用の文字起こしの front matter の `title` が更新され、本文が変わらないことをテストで固定する。
- [x] 既存の会議と、文字起こし前の強調を OFF にした会議の文字起こし、要約、翻訳、検索が変わらないことをテストで固定する。
- [ ] 実会議で生と強調の CER を比較し、`docs/testing/reuse-speech-enhancement.md` に記録する。改善が確認できなければ ADR-0027 の削除条件を判断する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README、CHANGES.md、リリースチェックリストを更新する。
- [x] PRD と ADR-0027、ADR-0021、ADR-0005 の記述を、実装した比較の範囲に合わせて更新する。

## 解決方法

### 共有の型と設定

- `src/shared/types.ts` に `TranscriptComparison` を追加する。`MeetingSummary` の `hasRawTranscript` と `transcriptModels` は issue 0026 が追加する。
- `src/shared/types.ts` の `MeetingDetail` に `transcriptComparisons` と `transcriptionFinishedAt: string | null` を追加する。
- `AppSettings` に `enhanceBeforeTranscription: boolean` を追加し、既定値を `false` にする。
- `GenerateSummaryResult`、翻訳、ToDo の型は変更しない。正は `transcript.md` と `summary.md` のままとする。
- `src/shared/settings.ts` の `DEFAULT_APP_SETTINGS` と `normalizeAppSettings` を更新し、`tests/settings.test.ts` に既定 false と正規化を追加する。

### メインプロセス

- `src/main/transcript-comparison.ts` に、比較セッションの進行、比較セッションの入力 `audio.16k.wav` のハッシュ照合、`enhancement.json` の更新を置く。削除は issue 0026 の `invalidateEnhancement` を使う。
- `src/main/processing.ts` の文字起こし処理を、次の関数に分ける。
  - `transcribeRawComparison`: 生の 16 kHz WAV を文字起こしし、完了した結果だけを `transcript.raw.md` に保存する。話者分離は行わない。
  - `transcribeEnhanced`: 強調した 16 kHz WAV を 1 回だけ文字起こしし、完了した結果を `transcript.nemotronlabs.md` に保存する。同じ結果に話者分離を行い、`transcript.md` に保存する。
    完了時に `meta.transcription.finished_at` を更新する。
  - `transcribePrimaryWithoutEnhancement`: 強調に失敗したとき、または強調を OFF にしたときに、生の WAV を文字起こしして `transcript.md` に保存する。話者分離を行う。
  - `runEnhancedTranscription`: 比較セッションの入力を作り、生の比較、強調、強調後の文字起こしを順に実行する。
    比較セッションの入力は `audio.mp3` から作り、PCM から作った `audio.16k.wav` は作らない。
- `TranscriptionRunner` に `plan` を追加し、`processMeeting` が 1 回だけ解決する。
  `run` は `plan` を受け取り、解決と確認をやり直さない。
- `TranscriptionRunner` の `run` を、生の比較と強調後の文字起こしの 2 回呼ぶ。
  OpenAI のときは比較を行わず、強調後の 1 回だけにする。
  強調後の文字起こしを 2 回実行しない。
- `src/main/reuse-enhancement.ts` の `ReuseEnhancementService` を使って、生の 16 kHz WAV を `audio.16k.enhanced.wav` に強調する。強調ジョブの入力 `audio.16k.wav` のハッシュを `enhancement.json.transcription` に記録する。
- `DiarizationCacheKey` の `raw` では `enhancement_model_sha256` と `enhancement_settings` を null にし、`parseKey` は raw の null を許可する。`enhanced:nemotronlabs` では値を持つ。
- `src/main/meeting-meta.ts` は issue 0026 の `MeetingMetaEnhancement` を使う。
- `src/main/meetings.ts` に `transcript.raw.md` と `transcript.nemotronlabs.md` の読み取りを追加する。
  `detail` の `transcriptComparisons` に返す。`transcript.md` がない場合は `null` とする。
- `src/main/search-index.ts` は `transcript.md` だけを読み、`src/main/todos.ts` は `summary.md` だけを読む。比較用の文字起こしを索引と ToDo の対象にしない。
- 会議の削除、再文字起こし、設定変更で `transcript.raw.md` と `transcript.nemotronlabs.md` を削除するときは、issue 0026 の `invalidateEnhancement` を使う。
- `src/main/reuse-enhancement.ts` に強調ジョブの入力 `audio.16k.wav` のハッシュ照合を追加し、削除は issue 0026 の `invalidateEnhancement` を `comparison` の範囲で使う。
- `src/main/diarization-cache.ts` の `DiarizationCacheKey` と `matchesCacheKey` に `input_kind`、`enhancement_model_sha256`、`enhancement_settings` を追加し、`DIARIZATION_CACHE_SCHEMA_VERSION` を上げる。
  `parseKey` でも 3 つの項目を検証する。
  `processing.ts` で、話者分離の入力の種類、強調モデルの SHA-256、強調設定を渡す。
- `src/main/index.ts` に `meetings:rerun-enhanced-transcription` を追加する。引数は会議 ID とし、既存の `ProcessingCoordinator` の進捗とキャンセルを使う。
  `src/preload/index.ts` と `src/renderer/src/env.d.ts` に同じ API を追加する。
- `src/main/processing.ts` の既存の処理キュー (全体直列 + 会議単位の重複拒否) を使い、`requestRerunEnhancedTranscription` を追加する。
- `src/renderer/src/MeetingDetail.tsx` で、再実行の前に上書き確認を表示し、`meetings:rerun-enhanced-transcription` を呼ぶ。

### 画面

- `src/renderer/src/MeetingDetail.tsx` に `transcriptComparisons` の状態を追加する。
  - 文字起こしペインの `TranscriptComparison` で「現在の文字起こし」「生」「強調」を切り替える。
  - 比較用を選んだときは、編集、翻訳、話者名の変更を無効にする。
  - 比較用であることと、検索、翻訳、要約、ToDo の入力ではないことを表示する。
  - 比較用には生成時のスナップショットであることを表示する。
- `src/renderer/src/TranscriptComparison.tsx` を追加し、セレクタと読み取り専用の表示をテストできるようにする。
- `src/renderer/src/StaleTranscriptNotice.tsx` を追加し、再実行後に要約と翻訳が以前の文字起こしに基づくことを表示する。
  `transcriptionFinishedAt` が `summary.generatedAt` より新しいとき、または翻訳の `generatedAt` より新しいときに表示する。
- `src/main/meetings.ts` の `detail()` は、`meta.transcription.finished_at` を `transcriptionFinishedAt` として返す。
- `src/renderer/src/MeetingDetail.tsx` は `StaleTranscriptNotice` を組み込む。
- `src/renderer/src/ReuseSettings.tsx` に、文字起こし前の強調の ON/OFF、モデルの状態、OpenAI では比較しない旨を追加する。
- `src/shared/i18n.ts` に文言を追加する。

### テスト

- `tests/processing.test.ts` に、次の組み合わせを追加する。
  - 強調成功、生文字起こし成功、強調文字起こし成功。
  - PCM 由来の `audio.16k.wav` が残っていても、比較セッションで `audio.mp3` から作り直す。
  - 強調失敗、生文字起こし成功。初回は `transcript.raw.md` を保存し、`transcript.nemotronlabs.md` を作らない。
  - 生文字起こし失敗、強調文字起こし成功。初回は `transcript.raw.md` を作らない。
  - 強調文字起こし失敗、生文字起こし成功。初回は `transcript.nemotronlabs.md` を作らない。
  - 両方失敗。初回は `transcript.md` に部分結果を保存し、強調の部分結果を優先し、比較用は完了した側だけになる。
  - 再実行で生だけ成功、強調だけ成功、両方失敗、キャンセルのそれぞれで、以前の結果を残す。
  - 再実行の途中で部分結果が出ても `transcript.md` を変更しない。
  - 再実行で両方成功したときだけ `transcript.md` と比較用を置き換える。
  - 初回の生文字起こしのキャンセル、強調文字起こしのキャンセルで、`transcript.md` に部分結果が残り、比較用は完了した側だけになる。
  - OpenAI 文字起こしで比較を行わない。
  - OpenAI の送信を承認したときと拒否したときの送信回数。
  - OpenAI の ON/OFF と承認/拒否の組み合わせで、ON は enhanced または生へのフォールバック、OFF は生の音声だけを送り、送信回数が 1 回になる。
  - 入力ハッシュが変わった再文字起こしで、古い比較用文字起こしを削除する。
  - `enhanceBeforeTranscription` を OFF にした再文字起こしで、比較用ファイルを削除する。
- `tests/diarization-cache.test.ts` に、raw はモデルまたは設定が変わっても一致し、enhanced はモデルまたは設定が変わると不一致になること、`DIARIZATION_CACHE_SCHEMA_VERSION` が上がることを追加する。入力の種類を `raw` から `enhanced:nemotronlabs` に変えたときも不一致になることを追加する。
- `tests/transcript-comparison.test.ts` に、入力ハッシュの照合、古い比較用ファイルの削除、`enhancement.json` の更新を追加する。
- `tests/search-index.test.ts` に、比較用の文字起こしの内容が検索結果に出ないことを追加する。
- `tests/todos.test.ts` に、比較用の文字起こしが ToDo の対象にならないことを追加する。
- `src/renderer/src/TranscriptComparison.test.tsx` に、生 / 強調の切り替え、編集と翻訳の無効化、比較用の表示を追加する。
- `src/renderer/src/StaleTranscriptNotice.test.tsx` に、`transcriptionFinishedAt` と `summary.generatedAt` の比較で陳腐化を表示することを追加する。翻訳の `generatedAt` が `transcriptionFinishedAt` より古い場合に表示し、新しい場合は表示しないことを固定する。
- `tests/processing.test.ts` に、再実行に成功したとき `meta.transcription.finished_at` が更新されることを追加する。
- `tests/meetings.test.ts` に、会議タイトル変更で `transcript.md`、`transcript.raw.md`、`transcript.nemotronlabs.md` の front matter の `title` が更新され、本文が変わらないことを追加する。
- `tests/settings.test.ts` に、`enhanceBeforeTranscription` の既定 false と正規化を追加する。
- `tests/processing.test.ts` に、`transcript.previous.md` の内容が再実行前の `transcript.md` と一致することを追加する。
- `tests/processing.test.ts` に、`requestRerunEnhancedTranscription` が同じ会議のキューを使い、同時実行しないことを追加する。
- `tests/processing.test.ts` に、`meetings:rerun-enhanced-transcription` の IPC が会議 ID を受け取り、coordinator のメソッドを呼ぶことを追加する。
- `src/renderer/src/ReuseSettings.test.tsx` に、文字起こし前の強調の ON/OFF と OpenAI の注意を追加する。
- `tests/i18n.test.ts` と `tests/i18n-usage.test.ts` の既存検査で、追加した文言を検証する。
- UI テストは `renderToStaticMarkup` と純粋関数で状態を固定する。
  `jsdom` と Testing Library は追加しない。
- PBT と Fuzzing は新しい依存を追加しないため採用しない。
  境界は Example-based test で網羅し、文字起こしの組み合わせは表駆動のテストで固定する。
- テスト名または module doc に、対応する `REQ-ENHANCE-002` と `REQ-DIAR-003` を書く。

### 文書

- `docs/prd/kataribe.md` の `REQ-ENHANCE-002` に、比較セッション、再実行、ToDo の正本を追加する。
- `docs/adr/0027-reuse-webgpu-enhancement.md` に、文字起こし前の比較の範囲と OpenAI の扱いを追加する。
- `docs/adr/0005-audio-formats-mp3-and-16khz-wav.md` に、比較セッションでは `audio.mp3` から 16 kHz WAV を作る例外を追加する。
- `docs/adr/0021-speaker-diarization-cache.md` に、入力の種類、強調モデル、強調設定を追加する。
- `README.md` に、文字起こし前の強調、生 / 強調の比較、OpenAI では比較しないこと、処理時間を追加する。
- `CHANGES.md` の `## develop` に、文字起こし前の音声強調と比較を追加する。
- `docs/release-checklist.md` に、生 / 強調の文字起こし、検索と翻訳の対象外、OpenAI の二重送信防止の確認を追加する。

## 実施結果

- 設定に `enhanceBeforeTranscription` を追加し、既定を OFF にした。
- 比較セッションは `audio.mp3` から 16 kHz WAV を 1 回だけ作り、生と強調の文字起こしを `transcript.raw.md` と `transcript.nemotronlabs.md` に保存する。`transcript.md` は強調した結果を正とし、強調に失敗したときは生の結果を使う。
- 会議詳細に比較の切り替えと読み取り専用の表示を追加し、編集、翻訳、話者名の変更を無効にした。
- 再実行は `transcript.md` を `transcript.previous.md` にコピーし、生と強調の両方が成功したときだけ比較用と `transcript.md` を置き換える。失敗時は以前の結果を残す。
- OpenAI の文字起こしでは比較せず、強調に成功した音声または生の音声を 1 回だけ送る。確認ダイアログに送る音声を表示する。
- 話者分離のキャッシュキーに `input_kind`、`enhancement_model_sha256`、`enhancement_settings` を追加し、スキーマを 2 に上げた。
- `npm run typecheck`、`npm test` (574 件)、`npm run build` が通る。
- 実会議の CER 比較は未実施である。WebGPU エンジンを使った比較は `docs/testing/reuse-speech-enhancement.md` の「実会議での比較」に従って行う必要がある。
- 比較のキャンセル時のファイル内容、翻訳、要約、ToDo の結合テストは未追加である。完了条件で未チェックの項目として残す。
