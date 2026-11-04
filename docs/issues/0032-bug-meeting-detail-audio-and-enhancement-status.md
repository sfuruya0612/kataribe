# 会議詳細の生音声の再生と音声強調の状態表示を修正する

- Requirements: REQ-ENHANCE-001
- Priority: High
- Created: 2026-11-04
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/bug-meeting-detail-audio-and-enhancement-status

## 目的

会議詳細で生音声を確実に再生できるようにし、音声強調の状態が画面上部を常時圧迫しない表示へ変える。

## 優先度根拠

生音声を再生できないと、会議の内容確認と強調音声との聞き比べができない。
音声強調の状態表示は利用者が求めた画面改善であり、文字起こしと要約の閲覧領域を狭めている。

## 現状

`kataribe-audio://meeting/{id}` の URL は会議 ID だけで決まる。
処理中は生音声が `audio.wav`、処理後は `audio.mp3` になるが、URL が変わらないため、`AudioPlayer` は同じ音声要素を再利用する。
ブラウザは同じ URL の応答をキャッシュするため、ファイルを置き換えても古い応答を再生し続ける。
`audio.load()` を同じ URL で呼んでも、5 秒の mp3 を 12 秒の mp3 に置き換えた場合に長さが 5 秒のままになることを Electron 45.1.0 で再現した。

`EnhancementStatus` は `MeetingDetail` の `detail-head` に直接置かれ、保存音声と文字起こし前の強調の全項目を縦に並べる。
項目が多い会議ではタイトル、メタデータ、音声プレイヤーの下に複数行が常時表示され、文字起こしと要約の表示領域を押し下げる。

## 設計方針

### 生音声の URL

- `MeetingStore.list` が音声ファイルの `stat` から更新時刻とサイズを取得し、`?v=<mtimeMs>-<size>` を URL に付ける。
- `kataribe-audio` の URL 解析は、`v` だけをクエリとして受け付け、ほかのクエリとフラグメントを拒否する。
- 処理で `audio.wav` から `audio.mp3` に切り替わったとき、または音声を再変換したときに URL が変わる。
- `AudioPlayer` は音声要素の `key` に選択中の URL を使い、URL が変わったら新しい要素で読み込む。
- 会議を切り替えたときだけ生音声へ戻す。音声の URL が変わっただけでは、利用者が選んだ音声の種類を変えない。

### 強調音声の URL

- `enhancement.json` の `saved_audio.nemotronlabs.output.sha256` を URL の `v` に使う。
- 会議詳細からの再実行で強調音声を置き換えたとき、URL が変わり、古い応答を再生しない。
- 強調音声の選択肢は `meta.json` の `enhancedModels` に従う。`enhancement.json` を読めないときはバージョンなしの URL を使い、再生できるファイルを残す。

### 音声強調の状態表示

- `detail-head` から `EnhancementStatus` を外す。
- タイトル行に、音声強調の状態を 1 行のボタンとして置く。ボタンは状態のチップと「詳細」を表示する。
- ボタンを押すとモーダルを開き、保存音声と文字起こし前の強調の詳細、処理時間、使用モデル、エラーを表示する。
- 状態の要約は、実行中、失敗または中断、成功、キャンセル済み、未実行の順に優先する。読み込みに失敗したときは、その旨を最優先で表示する。
- モーダルの詳細本文は既存の `EnhancementStatus` を使い、見出しの重複を避けるため見出しを表示しない切り替えを追加する。

### 対象外

- 音声の変換形式、文字起こし、要約、検索の処理は変えない。
- 音声強調の状態の項目と意味は変えない。
- PRD の要求と受入基準は変えない。

## 完了条件

- [ ] REQ-ENHANCE-001 の受入基準「会議詳細の音声プレイヤーで、生音声と強調音声を切り替えて再生できる」を満たす。生音声のファイルが `audio.wav` から `audio.mp3` に変わったとき、または同じ名前で置き換わったときに、URL が変わり、新しい音声を読み込む。
- [ ] REQ-ENHANCE-001 の受入基準「再実行に成功したときは以前の強調音声を新しい結果で置き換え、失敗したときは以前の強調音声を残す」を満たす。成功した再実行で強調音声の URL が変わり、古い音声を再生しない。`enhancement.json` を読めないときも、`meta.json` の `enhancedModels` に従って強調音声を再生できる。
- [ ] `parseMeetingAudioUrl` が `?v=<version>` を受け付け、ほかのクエリ、空の `v`、フラグメントを拒否する。
- [ ] 音声ファイルの更新時刻またはサイズが変わると、`MeetingSummary.audioUrl` が変わる。
- [ ] 音声強調の状態はタイトル行の 1 行のボタンに収まり、詳細はモーダルで表示する。画面上部に詳細の行を常時表示しない。
- [ ] 状態の要約が、読み込み失敗、実行中、失敗または中断、成功、キャンセル済み、未実行の優先順位で決まる。
- [ ] 音声強調のデータがない会議では、状態ボタンを表示しない。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] CHANGES.md の `### FIX` と `### UPDATE` を更新する。
- [ ] README とリリースチェックリストは、利用手順と確認項目が変わらないため更新しない。

## 解決方法

### 共有の URL 生成

- `src/shared/meeting-audio-url.ts` を追加する。
  - `meetingAudioUrl(meetingId, version)` が生音声の URL を返す。
  - `enhancedMeetingAudioUrl(meetingId, model, version)` が強調音声の URL を返す。
  - バージョンは `encodeURIComponent` でエンコードする。

### メインプロセス

- `src/main/meetings.ts` の `locateAudio` が `stat` の `mtimeMs` と `size` からバージョンを作り、`audioUrl` に付ける。
- `src/main/search-index.ts` は `audio_url` をそのまま保存するため、列と移行の変更は不要である。
- `src/main/meeting-audio.ts` の `parseMeetingAudioUrl` を、`?v=` だけを受け付ける形に変える。

### 画面

- `src/renderer/src/AudioPlayer.tsx`
  - `<audio>` の `key` に `selectedSrc` を設定する。
  - 読み込み条件を `selectedSrc` に統一する。
  - `src` の変更で生音声へ戻す副作用を削除する。
- `src/renderer/src/MeetingDetail.tsx`
  - `AudioPlayer` の `key` に会議 ID を設定する。
  - 強調音声の URL を `enhancedMeetingAudioUrl` と `detail.enhancement` の出力ハッシュから作る。出力がないときはバージョンなしの URL にする。
  - `detail-head` から `EnhancementStatus` を外し、タイトル行に `EnhancementStatusSummary` を置く。
- `src/renderer/src/EnhancementStatusSummary.tsx` を追加する。
  - 1 行のボタンと詳細のモーダルを持つ。
- `src/renderer/src/enhancement-state.ts` を追加する。
  - 状態の優先順位を決める純粋関数と、チップの class を返す関数を持つ。
- `src/renderer/src/EnhancementStatus.tsx`
  - 見出しを表示するかどうかの prop を追加する。
- `src/renderer/src/styles.css`
  - 1 行の状態ボタンとモーダルの幅を定義する。
- `src/shared/i18n.ts`
  - 状態ボタンとモーダルに必要な日本語と英語の文言を追加する。

### テスト

- `tests/meeting-audio-url.test.ts` を追加し、生音声と強調音声の URL、バージョンのエンコード、バージョンなしの URL を固定する。
- `tests/meeting-audio.test.ts` に、`?v=` の受理と不正なクエリの拒否を追加する。
- `tests/meetings.test.ts` に、音声ファイルの更新で `audioUrl` のバージョンが変わることを追加する。
- `src/renderer/src/EnhancementStatusSummary.test.tsx` を追加し、状態の優先順位、読み込み失敗、データなしの非表示、1 行のボタンを固定する。
- `src/renderer/src/EnhancementStatus.test.tsx` に、見出しを隠す表示を追加する。
