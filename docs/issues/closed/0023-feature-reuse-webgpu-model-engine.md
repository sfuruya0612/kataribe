# RE-USE の商用モデル管理と WebGPU 音声強調エンジンを追加する

- Requirements: REQ-ENHANCE-001, REQ-ENHANCE-002 (モデル、WebGPU、プロトコル、ライセンスの共通基盤)
- Priority: High
- Created: 2026-11-03
- Completed: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-transcription-accuracy

## 目的

RE-USE の商用モデルのダウンロードと検証、WebGPU エンジン、専用 Worker、カスタムプロトコル、共通の音声強調サービスを追加する。
保存音声の強調は issue 0025、文字起こし前の強調と比較は issue 0024、メタデータと後始末は issue 0026 が担う。

## 優先度根拠

issue 0025、0026、0024 が、この issue のモデル管理、エンジン、Worker、プロトコル、強調サービスに依存する。
モデルとエンジンがなければ比較機能を実装できないため、最初に完了させる。

## 現状

- モデルのダウンロードは whisper.cpp と話者分離だけで、RE-USE の重みを管理する仕組みはない。
- `src/renderer/src/reuse/` は存在せず、WebGPU の推論エンジンはアプリにない。
- 既存の `downloadAsset` は `verifyExisting` を指定しないと、サイズが一致する既存ファイルをハッシュなしで成功扱いする。
- カスタムプロトコルは `kataribe-audio` だけが `protocol.registerSchemesAsPrivileged` に登録されている。
- 音声強調の設定と UI はまだない。

## 設計方針

### 対象範囲

- この issue では、商用モデルの管理、WebGPU エンジン、専用 Worker、カスタムプロトコル、共通の強調サービス、モデル管理の設定 UI を扱う。
- 保存音声の強調と再生 UI は issue 0025 で扱う。
- 文字起こし前の強調と比較 UI は issue 0024 で扱う。
- `enhancement.json`、一時ファイルの後始末、`enhancing` 状態は issue 0026 で扱う。
- 録音中の入力へリアルタイムに強調をかける処理は扱わない。
- アプリが扱うモデルは、商用利用が可能な `nvidia/NVIDIA-NemotronLabs-RE-USE` だけとする。
  研究および教育用の `nvidia/RE-USE` は、モデル一覧、設定、ダウンロード、Worker のいずれにも含めない。
  2 つのモデルの比較は、配布物の外で `docs/testing/reuse-speech-enhancement.md` の手順に従って行う。

### モデルのダウンロード

- `src/main/reuse-models.ts` に `ReuseModelManager` を追加する。
  保存先は `~/Library/Application Support/Kataribe/models/reuse/` とする。
- モデルは次の 1 つとする。

| ID | 表示名 | ライセンス | URL | SHA-256 | サイズ |
| --- | --- | --- | --- | --- | --- |
| `nemotronlabs` | 商用利用が可能なモデル | OpenMDW-1.1 | `https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/31f82f2efad1095034492f236e8dac9239ba713b/model.safetensors` | `06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1` | 38,592,940 bytes |

- ファイル名は `nemotronlabs.safetensors` とし、モデル ID とファイル名の対応を固定する。
- URL、SHA-256、サイズは実装時に Hugging Face の実ファイルで再確認する。値が変わっていたら、この issue とテストを更新する。
- ダウンロードは HTTPS で行い、`.part` ファイル、HTTP Range による再開、SHA-256 の照合、進捗、キャンセル、削除を提供する。
  既存の `downloadAsset` に `verifyExisting: true` を渡し、サイズが同じでもハッシュが一致しないファイルは削除して再取得する。
- `installedPath` はサイズだけでなく SHA-256 を照合する。
  強調ジョブが使っているモデルの削除は拒否する。
- モデルの重みはアプリに同梱しない。
  ライセンスの本文を `resources/licenses/` に置き、設定画面のモデル一覧、ダウンロード確認、アプリメニューのライセンス項目から開けるようにする。

### WebGPU エンジン

- `geronimi73/re-use-demo` の MIT ライセンスのエンジンを、commit を固定して同梱する。
  commit は実装時に一次情報で確認し、`resources/licenses/` と ADR-0027 に記録する。
  MIT ライセンスの表示と出典を `resources/licenses/` に追加し、アプリメニューのライセンス項目と README から参照する。
  対象は STFT / iSTFT、safetensors の読み込み、重みのパッキング、WGSL カーネル、モデルの実行、チャンク処理である。
- エンジンは `src/renderer/src/reuse/` に置き、`.js` のまま使う。
  5 つの `.js` モジュールに `.d.ts` を追加し、`allowJs` を有効にせずに strict TypeScript の typecheck を通す。
  純粋な DSP と safetensors の読み込みは Vitest で検証し、WebGPU の実行は Electron のスモークテストで検証する。
- WebGPU が使えないときは、設定画面に理由を表示し、音声強調を無効にする。
  CPU への暗黙のフォールバックをしない。

### Worker とプロトコル

- 音声強調はメインウィンドウの Renderer に作る専用の Web Worker で実行する。
  メインウィンドウは閉じても破棄されず隠れるため、処理中は Worker が生存する。
  ウィンドウが破棄された場合は処理を失敗させ、呼び出し元へエラーを返す。
- メインプロセスは入力 WAV の情報 (サンプルレート、チャンネル数、データの開始位置、データ長、長さ) を読み、ジョブごとに一度だけ有効なトークンを発行する。
- Renderer は `kataribe-temp://enhance/<token>` から WAV を Range リクエストで読み、5 秒のチャンク、2.5 秒のホップ、0.5 秒のクロスフェードで処理する。
  44.1 kHz または 48 kHz の長い音声でも、音声全体を Float32 の配列として保持しない。
- 強調した PCM は、重複する区間をクロスフェードしてから、メインプロセスへチャンク単位で送る。
  メインプロセスは WAV ヘッダーを作り、チャンクを順番に追記する。
- 進捗は処理したチャンクの割合で返す。キャンセルは Worker とメインプロセスの両方へ伝える。
- モデルの重みは `kataribe-model://reuse/nemotronlabs` から読む。
  プロトコルは許可したモデル ID と保存済みのファイルだけを返し、任意のパスを読ませない。
- `kataribe-temp` と `kataribe-model` を `protocol.registerSchemesAsPrivileged` に追加する。
  既存の `kataribe-audio` と同じく `standard: false`、`secure: true`、`supportFetchAPI: true`、`stream: true` を設定する。
  URL の解析は既存の `kataribe-audio` と同じく手動で行う。
  CSP の `connect-src` に両方を追加する。
- トークンとモデル ID の許可リストを使い、Range リクエストには 206 を返す。
  期限切れのトークンと許可外のパスを拒否する。

### 設定と画面

- `src/shared/types.ts` に `ReuseModel`、`ReuseModelInfo`、`ReuseModelList` を追加する。
  `ReuseModel` は `'nemotronlabs'` だけを持つ。
- `src/renderer/src/ReuseSettings.tsx` を追加し、設定 > 文字起こし に置く。
  - モデルの表示名、ライセンス、サイズ、インストール状態、進捗、削除
  - ライセンス本文への導線
  - WebGPU の可用性と、使えない場合の理由
- `src/renderer/src/SettingsPanel.tsx` の transcription タブに `ReuseSettings` を組み込む。
- 音声強調の ON/OFF は issue 0025 と issue 0024 が追加する。
  研究および教育用モデルの同意設定と、モデルを選択する設定は追加しない。

### 1000 行超のファイル

- 新しいロジックと UI は新しい module に置く。
- `src/main/processing.ts`、`src/main/index.ts`、`src/renderer/src/MeetingDetail.tsx`、`src/renderer/src/SettingsPanel.tsx` へは配線だけを追加する。
- `src/shared/i18n.ts` が 1000 行を超える場合は、音声強調の文言を `src/shared/i18n-reuse.ts` に分ける。
- open の issue 0018 の分割方針に従い、既存の 1000 行超ファイルの分割をこの issue の範囲に含めない。
  ただし、新しいファイルを追加する前に、触るファイルの行数と分割の要否を最終報告に書く。

## 完了条件

ライセンス、プロトコル、Range、DSP の条件は、issue 0025 と issue 0024 の受入基準を支える共通基盤として確認する。

- [x] 商用利用が可能な `nemotronlabs` だけがモデル一覧に表示され、研究および教育用のモデルが設定画面とモデル一覧に存在しないことをテストで固定する。
- [x] モデルの URL、SHA-256、サイズ、ライセンス、ファイル名をテストで固定する。
- [x] アプリメニューのライセンス項目と設定画面から、WebGPU エンジンとモデルのライセンス本文を開けることをテストで固定する。
- [x] `reuse:open-license` が `'engine' | 'model'` 以外を拒否することをテストで固定する。
- [x] ダウンロードの再開、進捗、キャンセル、削除、SHA-256 の不一致をテストで固定する。
- [x] サイズが同じで内容が違う既存ファイルを、別モデルとして受け入れないことをテストで固定する。
- [x] 強調ジョブが使っているモデルの削除を拒否することをテストで固定する。
- [x] WebGPU が使えない環境で、機能を無効にして理由を表示することをテストで固定する。
- [x] `kataribe-temp` と `kataribe-model` が `registerSchemesAsPrivileged` に登録され、CSP の `connect-src` に含まれることをテストで固定する。
- [x] 許可外のモデル ID、許可外のパス、期限切れのトークンを拒否することをテストで固定する。
- [x] Range リクエストに対して 206 と正しい範囲を返すことをテストで固定する。
- [x] WAV の Range 読み込み、チャンクの順序、クロスフェード、途中キャンセル、出力 WAV のヘッダーと長さをテストで固定する。
- [x] DSP の STFT / iSTFT のラウンドトリップと、safetensors の読み込みをテストで固定する。
- [x] `.js` エンジンの `.d.ts` を追加し、`npm run typecheck` が通ることを確認する。
- [x] Electron の WebGPU スモークテストで、短い WAV の強調が完了し、出力が入力と異なり、有限のサンプルを含むことを確認する。WebGPU が使えない環境では能力ゲートとして明示する。
- [ ] 短い WAV で 16 kHz と 44.1 kHz / 48 kHz の処理時間を測り、60 分への線形外挿を `docs/testing/reuse-speech-enhancement.md` に記録する。M1 と M3 で PRD の目標値を満たすか確認する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README、CHANGES.md、リリースチェックリストを更新する。
- [x] ADR-0027、ADR-0010、ADR-0013、ADR-0005 の記述を、この issue の範囲に合わせて更新する。
- [x] 実行時の npm 依存を追加しない。`@webgpu/types` だけを devDependency に追加する場合は、その理由を記録する。
- [x] テスト名または module doc に `REQ-ENHANCE-001` を書く。共通基盤だけを確かめるテストは `共通基盤` と理由を書く。

## 解決方法

### 共有の型

- `src/shared/types.ts` に `ReuseModel`、`ReuseModelInfo`、`ReuseModelList` を追加する。
- `ReuseModel` は `'nemotronlabs'` とする。
- `ReuseModelInfo` は `id`、`label`、`license`、`sizeBytes`、`installed`、`downloading`、`progress`、`error` を持つ。
- `ReuseModelList` は `models: ReuseModelInfo[]` と `modelsDir: string` を持つ。

### モデル管理

- `src/main/reuse-models.ts` を追加する。
- `ReuseModelManager` は `downloadAsset` を使って `.part`、Range、SHA-256、進捗、キャンセル、削除を実装する。
  `verifyExisting: true` を渡し、`installedPath` でも SHA-256 を照合する。
- モデルのマニフェストはテストから差し替えられるようにする。
- `src/main/index.ts` で `ReuseModelManager` を生成し、IPC を追加する。
  - `reuse:list-models`
  - `reuse:download-model`
  - `reuse:cancel-download`
  - `reuse:delete-model`
  - `reuse:open-license`。`'engine' | 'model'` だけを受け、固定パスを `shell.openPath` で開く。パスを返さない。
- `src/preload/index.ts` と `src/renderer/src/env.d.ts` に同じ API を追加する。
- アプリメニューにライセンス項目を追加し、WebGPU エンジンとモデルのライセンス本文への導線を置く。

### WebGPU エンジン

- `src/renderer/src/reuse/` に `dsp.js`、`kernels.js`、`model.js`、`enhance.js`、`gpu-check.js` と、それぞれの `.d.ts` を MIT の表示付きで追加する。
- `resources/licenses/` にエンジンの MIT 表示と出典を置き、README に記載する。
- `src/renderer/src/reuse/enhancement.worker.ts` を追加する。
  - `ReuseGPU` をモデル ID ごとにキャッシュし、同じモデルの強調で再利用する。
  - `kataribe-model://reuse/nemotronlabs` から重みを取得する。
  - `kataribe-temp://enhance/<token>` から WAV を Range で読み、5 秒チャンク、2.5 秒ホップ、0.5 秒クロスフェードで処理する。
  - 進捗、チャンク、完了、エラー、キャンセルを `postMessage` で返す。
- `src/renderer/src/reuse/enhancement-client.ts` を追加し、Worker の生成、リクエストの対応付け、タイムアウト、キャンセルを扱う。
- `src/main/reuse-enhancement.ts` を追加する。
  - 入力 WAV の `readWavInfo` を読む。
  - 一時トークンを発行し、`kataribe-temp` で入力 WAV を返す。
  - メインウィンドウへ `enhancement:start` を送る。
  - `enhancement:progress`、`enhancement:chunk`、`enhancement:done`、`enhancement:error` を待つ。
  - 出力 WAV のヘッダーを作り、チャンクを順番に書き込む。
  - キャンセル、タイムアウト、ウィンドウ破棄を処理する。
- `src/main/index.ts` で `ReuseEnhancementService` を生成し、issue 0025 と issue 0024 から使えるようにする。
- `kataribe-temp` と `kataribe-model` のプロトコルを `protocol.handle` で登録する。
  - `protocol.registerSchemesAsPrivileged` に追加する。
  - トークンとモデル ID の許可リストを使う。
  - Range リクエストに対応する。
  - 期限切れのトークンを拒否する。
- `electron.vite.config.ts` の CSP に `kataribe-model:` と `kataribe-temp:` を追加する。

### 画面

- `src/renderer/src/ReuseSettings.tsx` を追加する。
  - モデル一覧、ライセンス、サイズ、インストール状態、進捗、削除
  - ライセンス本文への導線
  - WebGPU の可用性
- `src/renderer/src/SettingsPanel.tsx` の transcription タブに `ReuseSettings` を組み込む。
- `src/shared/i18n.ts` に文言を追加する。1000 行を超える場合は `src/shared/i18n-reuse.ts` に分ける。

### テスト

- `tests/reuse-models.test.ts` を追加する。
  - 1 つのモデルの URL、SHA-256、サイズ、ライセンス、ファイル名を固定する。
  - ローカル HTTP サーバからダウンロードし、SHA-256 を照合する。
  - 進捗、キャンセル、削除、再開を固定する。
  - サイズが同じで内容が違うファイルを拒否する。
  - 強調ジョブの実行中に削除を拒否する。
- `tests/reuse-protocol.test.ts` を追加する。
  - 許可外のモデル ID、許可外のパス、期限切れのトークンを拒否する。
  - Range リクエストに 206 を返す。
  - `registerSchemesAsPrivileged` と CSP の設定を固定する。
  - `reuse:open-license` の許可外の種別を拒否する。
- `tests/reuse-enhancement.test.ts` を追加する。
  - WAV の Range 読み込み、チャンクの順序、クロスフェード、出力 WAV のヘッダーと長さを固定する。
  - キャンセル、タイムアウト、ウィンドウ破棄、出力なしの失敗を固定する。
- `src/renderer/src/reuse/dsp.test.ts` を追加する。
  - STFT / iSTFT のラウンドトリップを固定する。
  - safetensors の読み込みと重みのパッキングを小さな fixture で固定する。
- `src/renderer/src/ReuseSettings.test.tsx` に、モデル一覧、ライセンス、進捗、WebGPU の理由の表示を追加する。
- アプリメニューのライセンス項目は、Electron のメニュー設定をテストで固定する。
- `scripts/reuse-smoke.cjs` または Electron のテストスクリプトを追加し、短い WAV の強調を実行する。
  - 出力が入力と異なること、無音でないこと、有限のサンプルを含むこと、長さとサンプルレートが入力と一致することを確認する。
  - 16 kHz と 44.1 kHz / 48 kHz の処理時間を測り、60 分への線形外挿を記録する。
  - スクリプトの引数、環境変数、出力先、失敗時の終了コード、WebGPU が使えない場合の能力ゲートの条件を書く。
- PBT と Fuzzing は新しい依存を追加しないため採用しない。
  境界は Example-based test で網羅し、safetensors と WAV の不正入力は表駆動のテストで固定する。
  この判断は issue 0015 と issue 0020 の理由を踏襲する。

### 文書

- `docs/adr/0027-reuse-webgpu-enhancement.md` の基盤部分を、この issue の範囲に合わせる。
- `docs/adr/0010-meeting-folder-and-sqlite-index.md` にモデルの配置、`docs/adr/0013-privacy-boundary.md` にプロトコルと CSP の記述を追加する。
- `docs/adr/0005-audio-formats-mp3-and-16khz-wav.md` に派生音声と比較セッションの例外を追加する。
- `README.md` に、商用モデルだけを使うこと、WebGPU の要件、モデルのダウンロード、ライセンス表示を追加する。
- `docs/testing/reuse-speech-enhancement.md` に、WebGPU の処理時間と再検証の結果を追加する。
- `CHANGES.md` の `## develop` に、モデル管理と WebGPU エンジンの追加を記録する。
- `docs/release-checklist.md` に、モデルのダウンロード、WebGPU の可用性、ライセンス表示の確認を追加する。

## 実施結果

- 商用モデル `nemotronlabs` のダウンロード、HTTP Range による再開、SHA-256 の照合、進捗、キャンセル、削除を実装した。
- `geronimi73/re-use-demo` の commit `0d54dca074597b111a8e8c78f6067a6fa0231f75` の WebGPU エンジンを同梱し、専用 Worker、`kataribe-temp` と `kataribe-model` のプロトコル、Range 応答、ライセンス表示を追加した。
- `npm run smoke:reuse -- /tmp/reuse-model.safetensors` で 16 kHz、44.1 kHz、48 kHz の 2 秒音声を処理し、出力が入力と異なり、長さとサンプルレートが一致することを確認した。
- M4 Pro (48 GB)、macOS 27.2 の実測は 16 kHz 455 ms、44.1 kHz 708 ms、48 kHz 747 ms で、60 分への線形外挿は 13.7 分、21.2 分、22.4 分だった。
- M1 と M3 の実機確認は未実施である。`docs/testing/reuse-speech-enhancement.md` に未検証として記録した。
- `npm run typecheck`、`npm test` (570 件)、`npm run build` が通る。
- 計画との差分: `@webgpu/types` を devDependency に追加した。カスタムプロトコルは Worker からの fetch に `corsEnabled` が必要だったため、4 つの privilege に追加した。
