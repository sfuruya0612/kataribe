# UI の表示言語を日本語と英語で切り替える

- Requirements: REQ-UI-001
- Priority: Medium
- Created: 2026-11-01
- Completed: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-ui-language-switching

## 目的

設定画面で UI の表示言語を日本語と英語から選べるようにする。
選択した言語を、画面、メニューバー、アプリケーションメニュー、確認ダイアログ、エラーメッセージに再起動なしで反映する。

## 優先度根拠

主ユーザーは日本語話者であり、録音、文字起こし、要約の主要な経路を止めない。
英語話者との共有や、英語環境での確認に必要になる。

## 現状

画面の固定文言は React コンポーネントに日本語で直書きしている。
トレイメニュー、アプリケーションメニュー、確認ダイアログ、進捗メッセージ、エラーメッセージも main プロセスに日本語で直書きしている。
`AppSettings` は表示言語を持たず、設定画面にも言語の選択肢がない。
`MeetingSearchHit` は検索種別の表示名を main プロセスで生成しているため、言語を切り替えても検索結果の種別名が変わらない。

## 設計方針

- `AppSettings.uiLanguage` を `'ja' | 'en'` で追加し、既定を `'ja'` にする。設定ファイルへの保存と再起動後の復元は既存の `SettingsStore` に任せる。
- `src/shared/i18n.ts` に、日本語の原文をキーにした英語の辞書を置く。`translate` はプレースホルダーを展開し、`translateCount` は単数と複数を使い分ける。辞書にない日本語を `t` へ渡すと型検査が失敗するため、翻訳の追加漏れを検出できる。
- Renderer は `I18nProvider` と `useI18n` で現在の言語とメッセージ関数を配る。`App` は読み込んだ設定の `uiLanguage` を provider に同期する。
- main プロセスは `src/main/i18n.ts` の `setUiLanguage` を使い、`SettingsStore` の値を `index.ts` から同期する。`tray-menu.ts`、`index.ts`、`meetings.ts`、`processing.ts`、`llm-profiles.ts`、`multi-output.ts`、`media.ts`、`recording.ts`、`meeting-meta.ts`、`summary.ts`、`translation.ts`、`transcription.ts` は `t` で文言を返す。
- 設定の変更時は main の言語を更新し、アプリケーションメニューとトレイメニューを組み直す。Renderer は provider の言語を更新して即時反映する。
- 会議のタイトル、文字起こし、翻訳、要約、話者名、会議フォルダ名、LLM のプロンプトは翻訳しない。これらは保存済みの内容であり、表示言語の切り替えで書き換えない。
- 保存済みの録音エラーなど、過去に生成したメッセージは生成時の言語を保つ。新しく生成するメッセージは現在の言語を使う。
- 検索結果の種別名は main で生成せず、Renderer が `MeetingSearchHit['kind']` から表示名を選ぶ。言語の切り替えが既存の検索結果にも反映される。
- 新しい依存は追加しない。辞書とメッセージ関数はプロジェクト内で持つ。

## 完了条件

- [x] REQ-UI-001 の受入基準「設定画面の一般で日本語と英語のいずれかを選べる」を満たす。
- [x] REQ-UI-001 の受入基準「選んだ言語は設定に保存され、再起動しても適用される」を満たす。
- [x] 起動時に保存した UI 言語で初回描画し、別の言語で一瞬描画しない。
- [x] REQ-UI-001 の受入基準「言語の変更は再起動なしで画面、メニューバー、アプリケーションメニュー、確認ダイアログ、エラーメッセージに反映される」を満たす。
- [x] REQ-UI-001 の受入基準「既定の表示言語は日本語」を満たす。
- [x] REQ-UI-001 の受入基準「画面、メニューバー、アプリケーションメニュー、確認ダイアログ、エラーメッセージの固定文言はすべて日本語と英語の辞書に存在し、辞書にない文言を表示しない」を、辞書の型、`tests/i18n.test.ts` のプレースホルダー検査、`tests/i18n-usage.test.ts` の静的検査で満たす。
- [x] REQ-UI-001 の受入基準「会議のタイトル、文字起こし、翻訳、要約、話者名、会議フォルダ名は表示言語を切り替えても変更しない」を満たす。
- [x] REQ-UI-001 の受入基準「表示言語の変更は要約の出力言語を変更しない」を満たす。
- [x] REQ-UI-001 の受入基準「保存済みのメッセージは生成時の言語を保つ」を満たす。
- [x] REQ-UI-001 の受入基準「日付は選択した言語の形式で表示する」を満たす。
- [x] `tests/i18n-usage.test.ts` が、辞書を通らない日本語の UI リテラルを静的検査で検出しないことを検証する。
- [x] `tests/i18n.test.ts` が翻訳の存在、プレースホルダーの一致、単数と複数の選択を検証する。
- [x] `tests/settings.test.ts` が既定値、正規化、保存と再読み込みを検証する。
- [x] `src/main/tray-menu.test.ts` が日本語と英語のトレイメニューを検証する。
- [x] `src/renderer/src/recording-utils.test.ts` が日本語と英語の入力ソース、状態、日付の表記を検証する。
- [x] `src/renderer/src/SettingsPanel.test.tsx` が設定画面の言語選択を日本語と英語で描画して検証する。
- [x] `src/renderer/src/SearchResults.test.tsx` が検索結果の種別名と件数を日本語と英語で描画して検証する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] PRD、ADR、CHANGES.md、README を同じ変更で更新する。

## 解決方法

- `src/shared/types.ts` に `UiLanguage` と `AppSettings.uiLanguage` を追加する。
- `src/shared/settings.ts` に既定値と正規化を追加する。
- `src/shared/i18n.ts` に英語辞書、`translate`、`translateCount`、`interpolate`、`placeholders` を追加する。
- `tests/i18n-usage.test.ts` に、辞書を通らない日本語の UI リテラルを検出する静的検査を追加する。
- `src/renderer/src/i18n.tsx` に `I18nProvider` と `useI18n` を追加し、`main.tsx` で provider を置く。
- `preload/index.ts` に `getUiLanguage` を追加し、`main.tsx` はその結果を `I18nProvider` の初期言語にする。
- 画面コンポーネントと `use-recorder.ts` の日本語の固定文言を `t` に置き換える。
- `src/main/i18n.ts` に `setUiLanguage`、`getUiLanguage`、`t` を追加する。
- `src/main/index.ts` で設定の読み込み後と変更時に `setUiLanguage` を呼び、アプリケーションメニューとトレイメニューを更新する。
- `src/main/tray-menu.ts`、`tray.ts`、`meetings.ts`、`processing.ts`、`llm-profiles.ts`、`multi-output.ts`、`media.ts`、`recording.ts`、`meeting-meta.ts`、`summary.ts`、`translation.ts`、`transcription.ts` の文言を `t` に置き換える。
- `src/shared/llm.ts` の `validateEndpointUrl` と `src/shared/speakers.ts` の `validateSpeakerNames` に言語の引数を追加する。
- `MeetingSearchHit` から `kindLabel` を削除し、`src/main/search-index.ts` と `src/main/meetings.ts` の生成箇所を削除する。表示名は `src/renderer/src/SearchResults.tsx` で選ぶ。
- `tests/i18n.test.ts`、`tests/i18n-usage.test.ts`、`tests/settings.test.ts`、`src/main/tray-menu.test.ts`、`src/renderer/src/recording-utils.test.ts`、`src/renderer/src/SettingsPanel.test.tsx`、`src/renderer/src/SearchResults.test.tsx` を追加または更新する。
- `docs/prd/kataribe.md`、`docs/adr/0022-ui-language-switching.md`、`CHANGES.md`、`README.md` を更新する。

## 実施結果

`AppSettings.uiLanguage`、共有の辞書、Renderer の context、main の言語同期を追加した。
画面、トレイ、アプリケーションメニュー、ダイアログ、進捗、新しく生成するエラーメッセージを辞書経由にした。
保存済みの会議データと LLM のプロンプトは翻訳の対象外とした。
`MeetingSearchHit.kindLabel` を削除し、検索種別の表示名を Renderer で選ぶようにした。
React の描画テストは、`react-dom/server` で設定画面と検索結果を描画して言語切替を確認する形にした。ブラウザの DOM を使うテスト基盤は追加していない。
受入基準 3 の操作による即時反映は、DOM を使うテスト基盤が無いため自動テストの対象外とし、描画テスト、トレイメニューの言語切替テスト、リリースチェックリストの手動確認で補う。
起動時の初回描画は preload の `getUiLanguage` で現在の言語を取得してから行う。
`SettingsPanel.tsx` と `MeetingDetail.tsx` は 1000 行を超えている。今回の変更は文言の置き換えが中心のため分割せず、構造の分割は issue 0018 として起票した。
