# 話者分離を 2〜10 人に対応し、話者名を変更できるようにする

- Requirements: REQ-DIAR-001
- Priority: High
- Created: 2026-11-01
- Completed: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-multi-speaker-diarization

## 目的

話者分離を 2 人固定から 2〜10 人の会議に対応させる。
あわせて、推定した話者名を会議ごとに変更できるようにする。

## 優先度根拠

3 人以上の定例会議では、現行の `話者A` と `話者B` の 2 ラベルが実態と合わず、文字起こしと要約の担当者を誤らせる。
話者分離は実装済みの機能であり、会議の記録としての価値を直接左右する。

## 現状

`src/main/diarization.ts` は、文字起こしセグメントごとの RMS、ゼロ交差率、ピッチを 3 次元の特徴量にして 2-means でクラスタリングする。
話者を常に 2 人と仮定し、`話者A` と `話者B` だけを返す。
分離の手掛かりが足りない場合はラベルを付けないが、3 人以上の会議でも 2 クラスタに押し込むため、誤ったラベルが付く。
話者名を変更する UI と API はなく、利用者は文字起こしを手で編集するしかない。
PRD は話者分離を次フェーズに置いたままで、要求 ID と受入基準を持たない。
ADR-0006 は、話者分離を入れるときに別の ADR を起こすとしている。

## 設計方針

### 話者分離の方式

sherpa-onnx のオフライン話者分離を使う。
話者セグメンテーションに pyannote segmentation 3.0、話者埋め込みに 3D-Speaker ERes2Net Base を使う。
実行ファイルは `sherpa-onnx-offline-speaker-diarization` を whisper-cli と ffmpeg と同じ子プロセス方式で起動する。
ONNX Runtime の dylib を同梱し、2 つのモデルは初回利用時に `Application Support/Kataribe/models/diarization/` へダウンロードする。
モデルは HTTPS で取得し、SHA-256 を照合してから使う。中断したダウンロードは `.part` から再開する。

### 話者数の扱い

設定に `speakerCount` を追加する。値は `auto` または 2〜10 の整数とする。
`auto` では `--clustering.cluster-threshold=0.90` を渡す。
自動検出が 10 人を超えた場合は `--clustering.num-clusters=10` で 1 回だけ再実行する。
指定値がある場合は `--clustering.num-clusters=<N>` を渡す。
1 人しか検出されない場合はラベルを付けない。

### 文字起こしセグメントへの割り当て

話者分離の出力は `開始秒 -- 終了秒 speaker_XX` の行を持つ。
各行を話者ターンとして読み、whisper.cpp のセグメントと時間の重なりが最も大きいターンの話者を割り当てる。
重なりがない場合は、セグメントの区間にもっとも近いターンが 1 秒以内にあるときだけ割り当てる。
話者ラベルは最初に現れた順に `話者A` から `話者J` とする。
1 つのセグメントに複数の話者が含まれる場合は、最も長く重なった 1 人を代表とする。

### 話者名の変更

会議詳細に話者名の変更 UI を追加する。
変更は `transcript.md`、`transcript.ja.md`、`transcript.en.md` の行頭の `話者名: ` を置換する。
置換は元の行に対して 1 回だけ行い、話者名の交換でも衝突しない。
話者名は 1〜40 文字、重複なし、コロン、改行、角括弧を含まない名前に制限する。
翻訳が話者名を保持していない行は変更しない。

### 失敗時の扱い

話者分離とモデルのダウンロードに失敗しても、文字起こしの保存と完了は継続する。
失敗理由は `meta.json` の `diarization` に残し、会議詳細に警告として表示する。
処理のキャンセル時は子プロセスを停止し、文字起こしだけを保存する。

### 範囲外

- マイクとシステム音声をステレオの別チャネルで録音する方式。
- 1 つの whisper セグメントを話者境界で分割する処理。
- 会議をまたいだ話者の同一性判定。
- クラウドの話者分離 API。
- 話者分離モデルの削除 UI。破損時はハッシュ不一致で再取得する。

## 完了条件

- [x] REQ-DIAR-001 の受入基準「2 人以上の話者が検出された場合、最初に現れた順に `話者A` から `話者J` のラベルが付く」を満たす。
- [x] REQ-DIAR-001 の受入基準「話者数は自動検出を既定とし、2〜10 人を指定できる」を満たす。
- [x] REQ-DIAR-001 の受入基準「自動検出が 10 人を超えた場合、10 人にまとめる」を満たす。
- [x] REQ-DIAR-001 の受入基準「話者名を会議ごとに変更でき、文字起こしと、話者名を保持している既存の翻訳の話者ラベルに反映される」を満たす。
- [x] REQ-DIAR-001 の受入基準「話者分離に失敗しても文字起こしは保存され、失敗理由が会議詳細に表示される」を満たす。
- [x] REQ-DIAR-001 の受入基準「話者分離モデルは初回利用時にダウンロードされ、SHA-256 を照合してから使われる」を満たす。
- [x] 話者ターンの解析、重なりによる割り当て、ラベルの順序、10 人への統合をテストで固定する。
- [x] 子プロセスの起動、引数、進捗、失敗、キャンセルを、実際に起動するスタブ CLI で固定する。
- [x] モデルのダウンロード、Range 再開、SHA-256 不一致、tar.bz2 の展開を、ローカル HTTP サーバーと実ファイルで固定する。
- [x] 話者名の置換を、交換、接頭辞が重なる名前、ラベルなし行、翻訳ファイル、不正な名前で固定する。
- [x] `npm run typecheck` と `npm test` が通る。
- [x] `npm run build` と `npm run package` が通り、`npm run verify:mac` がアプリサイズ 300 MB 以下と同梱物を確認する。
- [x] PRD、ADR-0020、CHANGES.md、README、リリースチェックリスト、ライセンス表示を同じ変更で更新する。

## 解決方法

### 依存と同梱物

- `scripts/build-binaries.sh` に sherpa-onnx v2.0.1 の `sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts.tar.bz2` の取得を追加する。
  アーカイブの SHA-256 は `4fcc6c77c8d8d2e2f04cfdc17c6fd224c01469b78529370eb9d8e0e5ec97ac79` とする。
- `bin/sherpa-onnx-offline-speaker-diarization` と `lib/libonnxruntime.dylib` を展開する。
  dylib は `strip -x` で縮小し、ad-hoc 署名を付ける。
  実行ファイルの rpath `@loader_path/../lib` に合わせて `resources/bin/lib/libonnxruntime.dylib` に置く。
- `resources/licenses/` に sherpa-onnx (Apache-2.0)、ONNX Runtime (MIT)、pyannote segmentation 3.0 (MIT)、3D-Speaker ERes2Net Base (Apache-2.0) のライセンスを追加する。
- `scripts/verify-mac-bundle.cjs` に実行ファイル、dylib、ライセンスの同梱確認を追加する。

### モデルのダウンロード

- `src/main/asset-download.ts` を追加し、`downloadAsset`、`fileSize`、`hashFile` を提供する。
  `.part`、HTTP Range、サイズと SHA-256 の照合、空き容量の確認、進捗通知を持つ。
- `src/main/models.ts` の `ModelManager` を `downloadAsset` に委譲し、whisper モデルの挙動を変えない。
- `src/main/diarization-models.ts` を追加する。
  `DiarizationModelManager` は 2 つの資産を順に取得し、セグメンテーションモデルは tar.bz2 を `/usr/bin/tar` で展開してから SHA-256 を照合する。
  資産は次のとおり。
  - `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` (6958444 bytes、SHA-256 `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488`)
  - 展開後の `model.onnx` (5992913 bytes、SHA-256 `220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079`)
  - `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (39593761 bytes、SHA-256 `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b`)
- 進捗は `diarization:model-progress`、状態変化は `diarization:models-changed` で通知する。

### 話者分離

- `src/main/diarization.ts` を書き換える。
  `parseDiarizationOutput`、`parseDiarizationProgressLine`、`assignSpeakerTurns`、`DiarizationService` を持つ。
- `DiarizationService` は `BinaryLocator.sherpaDiarizationPath()` で実行ファイルを解決し、`runProcess` で起動する。
  引数は `--segmentation.pyannote-model`、`--embedding.model`、`--segmentation.num-threads`、`--embedding.num-threads`、クラスタ数または閾値、WAV パスとする。
  進捗が 5 分止まった場合は中断する。処理の `AbortSignal` で子プロセスを停止する。
- `src/shared/speakers.ts` を追加し、`extractTranscriptSpeakers`、`renameTranscriptSpeakers`、`validateSpeakerNames`、`speakerLabel` を提供する。
- `src/main/processing.ts` に `diarizationService` を注入し、文字起こし完了後に `runDiarization` を呼ぶ。
  成功時は `meta.diarization` に `state: completed` と話者数を書き、失敗時は `state: failed` と理由を書く。
- `src/main/meeting-meta.ts` に `diarization` を追加する。
- `MeetingDetail` に `speakers` と `diarizationError` を追加し、`MeetingStore.detail` で `meta.speakers` または文字起こしの行頭から話者を返す。

### UI と API

- `AppSettings.speakerCount` を追加し、既定を `auto` にする。
- 設定の「話者分離」に、話者分離の有効化、話者数の選択、モデルの状態とダウンロード、中止を追加する。
- 会議詳細に話者名の変更ダイアログを追加し、`meetings:rename-speakers` を呼ぶ。
- `MeetingStore.renameSpeakers` は翻訳ファイル、`transcript.md`、`meta.json` の順に更新する。
  `meta` の更新に失敗しても、文字起こしから話者を再計算できるようにする。
- preload と `env.d.ts` に次の API を追加する。
  - `getDiarizationModelStatus`
  - `downloadDiarizationModels`
  - `cancelDiarizationModelDownload`
  - `renameMeetingSpeakers`
  - `onDiarizationModelProgress`
  - `onDiarizationModelsChanged`

### テスト

- `tests/asset-download.test.ts`: ローカル HTTP サーバーで全体取得、Range 再開、SHA-256 不一致、HTTP エラー、空き容量不足を固定する。
- `tests/diarization-model.test.ts`: 小さな tar.bz2 を実際に作り、2 資産の取得、展開、再開、状態を固定する。
- `tests/diarization.test.ts`: 実際に起動するスタブ CLI で引数、進捗、失敗、キャンセル、10 人超の再実行を固定する。
  純粋関数の解析、割り当て、ラベル順、10 人への統合も固定する。
- `tests/speakers.test.ts`: 話者名の抽出、置換、交換、接頭辞、不正な名前を固定する。
- `tests/meetings.test.ts`: `renameSpeakers` が 3 つのファイルと `meta.json` を更新することを固定する。
- `tests/processing.test.ts`: `runDiarization` が失敗しても元のセグメントを返し、失敗状態を残すことを固定する。
- `tests/settings.test.ts`: `speakerCount` の正規化を固定する。
- `tests/media.test.ts`: `sherpaDiarizationPath` の解決を固定する。

## 実施結果

2026-11-01 に完了した。

- sherpa-onnx v2.0.1 の `sherpa-onnx-offline-speaker-diarization` と、strip した `libonnxruntime.dylib` を同梱した。
- 2 つのモデルを初回利用時に取得し、SHA-256 を照合する。取得中は `.part` から再開する。
- 2〜10 人の自動推定と人数指定、10 人を超えた場合の再実行、`話者A` から `話者J` のラベル付けを実装した。
- 会議詳細の「話者名を編集」から、文字起こしと、話者名を保持している翻訳の話者名を変更できる。
- 話者分離に失敗しても文字起こしを保存し、会議詳細に理由を表示する。
- `npm run typecheck`、`npm test` (310 件)、`npm run build`、`npm run package`、`npm run verify:mac`、`npm run smoke` が成功した。アプリサイズは 296 MB だった。
- 実モデルの URL と SHA-256 を取得して照合し、同梱バイナリを 4 話者のサンプル音声で実行して 4 話者を検出した。
- レビューで、長い話者ターン出力の取得、話者ラベルの順序、10 人超の再実行失敗時の復帰、実行ファイル欠落時のモデル取得順、モデル状態の復元を修正した。

計画との差分:

- `runDiarization` は `processing.ts` の行数を増やさないため、`src/main/diarization-run.ts` に分けた。
- `DiarizationSettings.tsx` を追加し、設定画面の話者分離の節を `SettingsPanel.tsx` から分けた。
- 実モデルを使うテストは CI でネットワークに依存しないよう、ローカル HTTP サーバーとスタブ CLI で固定した。実モデルは手動で確認した。
