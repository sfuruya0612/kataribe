# 再文字起こしで話者ラベルと話者名を保持する

- Requirements: REQ-DIAR-002
- Priority: Medium
- Created: 2026-11-01
- Completed: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-preserve-speaker-labels

## 目的

再文字起こしのたびに話者分離を実行し直さず、保存済みの話者ターンを新しい文字起こしセグメントに再割り当てする。
手で付けた話者名を、同じ音声と同じ話者分離設定の再文字起こし後も保持する。

## 優先度根拠

モデル変更や失敗時の再実行で再文字起こしが起きるたびに、話者名を付け直す必要がある。
60 分の音声の話者分離に約 4 分かかるため、同じ音声で同じ結果になる処理を繰り返すコストも無視できない。

## 現状

`ProcessingCoordinator.transcribe` は、話者分離が有効なとき、文字起こしが完了するたびに `runDiarization` を呼ぶ。
再文字起こしは `transcript.md` を作り直し、`meta.speakers` を新しい自動ラベルで上書きする。
話者分離の生ターンは保存していないため、同じ音声と同じ設定でも CLI を毎回実行する。
部分文字起こしの保存時には `clearDiarization` が `meta.speakers` を削除するため、旧ラベルは部分結果の時点で見えなくなる。
`transcript.ja.md` と `transcript.en.md` は残るが、話者ラベルは古いままになる。
ADR-0020 は「再文字起こしをすると話者ラベルは自動ラベルに戻る。話者名は会議ごとに付け直す」と記録している。

再現:

1. 話者分離を有効にして文字起こしを完了する。
2. 会議詳細で `話者A` を `田中`、`話者B` を `佐藤` に変更する。
3. 同じ会議を再文字起こしする。
4. `transcript.md` の話者名が `話者A` と `話者B` に戻り、`田中` と `佐藤` は失われる。

## 設計方針

### キャッシュの保存

会議フォルダに `diarization.json` を置く。
ファイルは一時ファイルに書いてから rename し、パーミッションは 0600 にする。
形式は次のとおり。

```json
{
  "schema_version": 1,
  "key": {
    "audio_sha256": "audio.mp3 の SHA-256",
    "segmentation_sha256": "セグメンテーションモデルの SHA-256",
    "embedding_sha256": "話者埋め込みモデルの SHA-256",
    "speaker_count": "auto",
    "cluster_threshold": 0.9,
    "threads": 4
  },
  "turns": [
    { "start": 0.318, "end": 6.865, "cluster": "speaker_00" }
  ],
  "names": {
    "speaker_00": "田中"
  },
  "labels": {
    "田中": "speaker_00",
    "話者B": "speaker_01"
  }
}
```

`names` はクラスタ ID に付けた話者名だけを持つ。
`labels` は現在の表示名からクラスタ ID への対応を持ち、話者名の変更と翻訳の置換に使う。
クラスタ ID に話者名がない場合は、自動ラベルを表示名にする。

### キャッシュキー

キャッシュキーは、キャッシュ形式のバージョン、会議の audio.mp3 の SHA-256、セグメンテーションモデルの SHA-256、話者埋め込みモデルの SHA-256、話者数設定、クラスタ閾値、実行スレッド数とする。
whisper のモデルと文字起こしセグメントはキーに含めない。
ターンは音声と話者分離設定だけで決まり、新しいセグメントへの再割り当ては毎回行えるためである。
音声ハッシュは `src/main/asset-download.ts` の `hashFile` で計算する。
モデルの SHA-256 は `src/main/diarization-models.ts` の `DIARIZATION_ASSETS` が持つ最終ファイルのハッシュを使う。
スレッド数は `DiarizationService` が解決した値を使う。

### キャッシュヒット時

`DiarizationService` は CLI を起動せず、保存済みターンを新しいセグメントに再割り当てする。
クラスタ ID に話者名があればその名前を、なければ自動ラベルを付ける。
自動ラベルは文字起こしで最初に現れた順に付ける。
話者名はクラスタ ID で保持するため、セグメントの順序が変わって自動ラベルの順が変わっても名前を維持できる。
再割り当ての結果から新しい `labels` を作り、キャッシュを更新する。
既存の翻訳がある場合は、変更前の `labels` と新しい `labels` から表示名の対応を作り、`renameTranscriptSpeakers` で話者名を置き換える。話者名を保持していない行は変更しない。

### キャッシュミス時

CLI を実行し、生ターンとクラスタ ID ごとの自動ラベルを保存する。
音声、セグメンテーションモデル、埋め込みモデル、話者数、閾値、スレッド数のいずれかが変わった場合は、古いクラスタ ID と新しいクラスタ ID が対応しないため、話者名は自動ラベルに戻す。
キャッシュの読み込みに失敗した場合と内容が不正な場合は、キャッシュを無視して CLI を実行する。
キャッシュの書き込みに失敗した場合はログに残し、文字起こしと話者分離は完了させる。

### 話者名の更新

会議詳細の「話者名を編集」は、`transcript.md` と翻訳を書き換えるのと同じ操作で、`diarization.json` の `names` と `labels` を更新する。
現在の表示名からクラスタ ID を引くために `labels` を使う。
`meta.speakers` は既存会議の読み取りと、現在の表示名のスナップショットにだけ使う。新規の話者名の解決は `diarization.json` を優先する。
要約は自動で書き換えない。話者名を変えた後に要約を再生成するかは利用者が決める。

### 部分文字起こし、失敗、キャンセル

部分文字起こし、失敗、キャンセルのときは `diarization.json` を削除しない。
`clearDiarization` は `meta.speakers` を消すが、`diarization.json` は残す。
次に文字起こしが完了したときに、キャッシュが一致すれば話者名を復元する。

### 会議の削除

会議フォルダを削除すると `diarization.json` も削除される。
追加の削除処理は持たない。

### 範囲外

- 話者分離だけを再実行する UI。再文字起こしをせずにキャッシュを更新する操作は issue 0016 で扱う。
- 音声が変わった場合の話者名の引き継ぎ。クラスタ ID が変わるため対応しない。
- 手動で文字起こしの話者名を書き換えた場合の追跡。対応する操作は会議詳細の話者名の変更に限定する。
- 要約の話者名の自動更新。

## 完了条件

- [x] REQ-DIAR-002 の受入基準「同じ音声と同じ話者分離設定で再文字起こししたとき、話者分離の CLI を起動せず、保存済みターンでラベルを付ける」を満たす。
- [x] REQ-DIAR-002 の受入基準「クラスタ ID に付けた話者名が、再文字起こし後の文字起こしと、話者名を保持している翻訳に残る」を満たす。
- [x] REQ-DIAR-002 の受入基準「音声、話者セグメンテーションモデル、話者埋め込みモデル、話者数、クラスタ閾値のいずれかが変わったとき、キャッシュを無効化して話者分離を再実行する」を満たす。
- [x] REQ-DIAR-002 の受入基準「キャッシュの読み書きに失敗しても、文字起こしと話者分離は完了する」を満たす。
- [x] REQ-DIAR-002 の受入基準「会議を削除すると、話者分離のキャッシュも削除される」を満たす。
- [x] キャッシュキーの一致と不一致、キャッシュヒット時の再割り当て、クラスタ ID ごとの話者名の保持をテストで固定する。
- [x] 音声、セグメンテーションモデル、埋め込みモデル、話者数、閾値、スレッド数の変更でキャッシュが無効になることをテストで固定する。
- [x] `diarization.json` の破損、読み込み失敗、書き込み失敗で文字起こしが失敗しないことをテストで固定する。
- [x] 部分文字起こし、失敗、キャンセルの後もキャッシュと話者名が残ることをテストで固定する。
- [x] 再文字起こし時の翻訳の話者名の置換と、話者名を保持していない行が変わらないことをテストで固定する。
- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run package`、`npm run verify:mac` が通る。
- [x] PRD、ADR-0021、CHANGES.md、README を同じ変更で更新する。

テストと文書の条件は、受入基準を検証可能にし、変更を利用者へ伝えるための条件である。

## 解決方法

### キャッシュ

- `src/main/diarization-cache.ts` を追加する。
  - `DiarizationCacheKey`、`DiarizationCacheTurn`、`DiarizationCache`、`DiarizationCacheValidationError` を定義する。
  - `readDiarizationCache(path): Promise<DiarizationCache | null>` を追加する。JSON の解析、schema、配列、数値、文字列を検証し、不正なら null を返す。
  - `writeDiarizationCache(path, cache): Promise<void>` を追加する。一時ファイル、`fsync`、chmod 0600、rename を使う。
  - `matchesCacheKey(left, right): boolean` を追加する。
  - 会議フォルダの `diarization.json` のパスを返す関数を追加する。

### 話者分離

- `src/main/diarization.ts` を拡張する。
  - `DiarizationResult` に `turns`、`labels`、`names`、`segments` を持たせる。
  - `DiarizationService.diarize` にキャッシュと `namesByCluster` を受け取る経路を追加する。
    キャッシュが一致する場合は CLI を起動せず、`assignSpeakerTurns` に保存済みターンを渡す。
  - `assignSpeakerTurns` にクラスタ ID ごとの表示名を受け取る引数を追加する。表示名がないクラスタには自動ラベルを付ける。
  - `buildCacheKey` を追加する。audio.mp3 のハッシュ、モデルのハッシュ、話者数、閾値、スレッド数、schema バージョンをまとめる。
  - `DiarizationService` の解決済みスレッド数と閾値を公開する。
- `src/main/diarization-models.ts` の `DIARIZATION_ASSETS` からセグメンテーションモデルと埋め込みモデルの最終ハッシュを取得する。

### 文字起こし処理

- `src/main/processing.ts` を変更する。
  - 文字起こし完了後、audio.mp3 のハッシュを計算し、`diarization.json` を読む。
  - キャッシュが一致する場合は CLI を実行せず、保存済みターンで再割り当てする。
  - キャッシュが一致しない場合は CLI を実行し、成功後に `diarization.json` を書く。
  - 話者名の表示と `meta.speakers` のスナップショットを更新する。
  - 再文字起こしでキャッシュを使った場合、既存の翻訳の話者名を `renameTranscriptSpeakers` で置き換える。
  - 部分文字起こし、失敗、キャンセルでは `diarization.json` を削除しない。

### 会議詳細

- `src/main/meetings.ts` を変更する。
  - `detail` は `diarization.json` があればその `names` と `labels` を使い、なければ `meta.speakers` と文字起こしの行頭から話者を返す。
  - `renameSpeakers` は `diarization.json` の `names` と `labels` を更新し、`meta.speakers` と文字起こし、翻訳を更新する。
  - キャッシュがない既存会議は、現在の `meta.speakers` と `recoverTranscriptSpeakers` の経路を維持する。

### テスト

- `tests/diarization-cache.test.ts`: 読み書き、schema 検証、破損、キー一致、キー不一致、アトミック書き込み。
- `tests/diarization.test.ts`: キャッシュヒット時に CLI を起動しないこと、再割り当て、クラスタ ID ごとの話者名、自動ラベルの順序変更、キー不一致時の再実行。
- `tests/processing.test.ts`: 再文字起こしのキャッシュ利用、翻訳の置換、キャッシュ書き込み失敗時の文字起こし、失敗とキャンセルの後のキャッシュ保持。
- `tests/meetings.test.ts`: `detail` と `renameSpeakers` が `diarization.json` を更新すること、既存会議のフォールバック。
- `tests/speakers.test.ts`: 表示名からクラスタ ID への対応と、話者名を保持しない行の扱い。
- キャッシュキーの比較は、キーの各要素を変えた組み合わせで Example-based test として固定する。キーの値の組み合わせは有限で、PBT の新しい依存を追加しない。
- キャッシュ JSON の任意入力は、既存のテスト基盤にファズハーネスがないため、不正な JSON、型違い、欠損、範囲外の値の Example-based test で固定する。ファズハーネスの追加は別 issue とする。

### 文書

- `docs/prd/kataribe.md` に `REQ-DIAR-002` と `diarization.json` を追加する。
- `docs/adr/0021-speaker-diarization-cache.md` を追加する。
- `CHANGES.md` の `## develop` に `[ADD]` または `[UPDATE]` を追加する。
- `README.md` の話者分離の説明と既知の制約を更新する。
- リリースチェックリストに、キャッシュヒット時の再文字起こしと話者名の保持を追加する。

## 参照

- `docs/prd/kataribe.md` の「話者分離」
- `docs/adr/0020-speaker-diarization-with-sherpa-onnx.md`
- `docs/adr/0021-speaker-diarization-cache.md`
- `docs/issues/closed/0014-feature-multi-speaker-diarization.md`

## 実施結果

2026-11-01 に完了した。

- `diarization.json` に話者ターン、クラスタ ID ごとの話者名、現在の表示名からクラスタ ID への対応を保存する。
- キャッシュキーは audio.mp3 の SHA-256、分離モデルの SHA-256、話者数、閾値、スレッド数、schema バージョンで構成する。
- キャッシュが一致するときは CLI を起動せず、保存済みターンを新しいセグメントに再割り当てする。
- 話者名はクラスタ ID で保持し、再文字起こし後も表示名を維持する。
- 音声、分離モデル、話者数、閾値、スレッド数が変わるとキャッシュを無効にし、話者名を自動ラベルに戻す。
- キャッシュの破損、読み込み失敗、書き込み失敗はログに残して処理を続ける。
- 部分文字起こし、失敗、キャンセルでは `diarization.json` を削除しない。
- 会議フォルダの削除で `diarization.json` も削除する。
- 再文字起こしのキャッシュヒット時は、既存の翻訳の表示名を新しい表示名に置き換える。話者名を保持していない行は変更しない。
- `npm run typecheck`、`npm test` (345 件)、`npm run build`、`npm run package`、`npm run verify:mac`、`npm run smoke` が成功した。アプリサイズは 296 MB。
- `smoke` は起動中の Kataribe との single instance lock を避けるため、一時 user data directory で実行した。

レビュー後の追記:

- `ProcessingCoordinator` を通したキャッシュヒット、翻訳の置換、キャッシュ書き込み失敗時の文字起こし、話者分離の失敗とキャンセル後のキャッシュ保持を `tests/processing.test.ts` で固定した。
- `names` は現在の `labels` が指すクラスタだけに絞る。文字起こしに現れないクラスタの名前を残すと、後の改名で表示名が重複し、`diarization.json` が不正になるため。書き込み時も読み込みと同じ不変条件を検証する。
- 話者名の変更でキャッシュの書き込みに失敗したときは `diarization.json` を削除し、`meta.speakers` と文字起こしから改名できる状態に戻す。文字起こしの再処理でキャッシュの書き込みに失敗したときも同じ扱いにする。

計画との差分:

- 音声ハッシュは再生成される 16 kHz WAV ではなく、保存済みの audio.mp3 を使う。最初の文字起こしと再文字起こしで同じ音声を参照するため。
- 最初の文字起こしは元の WAV、再文字起こしは mp3 から 16 kHz WAV を作る。話者分離の入力は完全には一致しないが、キャッシュは audio.mp3 を同じ会議の音声として扱う。
- `DiarizationCacheValidationError` は作らず、`readDiarizationCache` が不正なキャッシュに `null` を返す形にした。呼び出し側はログを残して通常の分離へ進む。
- `assignSpeakerTurns` は `SpeakerAssignment` を返し、セグメント、制限後のターン、表示名からクラスタ ID への対応を含む。
- `DiarizationService` は `DiarizationResult` を返し、`cacheHit`、`cacheKey`、`turns`、`names`、`labels` を持つ。
- `runDiarization` が `diarization.json` の内容を組み立て、`processing.ts` が読み書きする。
- `meta.speakers` は現在の表示名のスナップショットとして残し、`diarization.json` をクラスタ名の正とする。
- 翻訳の表示名の置換は `buildLabelMapping` で対応を作り、`processing.ts` が翻訳ファイルへ適用する。
- 0016 の話者分離だけを再実行する UI は範囲外のまま。
