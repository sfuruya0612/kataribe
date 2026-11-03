# SettingsPanel.tsx をタブ、LLM プロファイル、設定取得の単位に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-settings-panel

## 目的

`src/renderer/src/SettingsPanel.tsx` が 1600 行を超え、一般、録音、文字起こし、要約のタブ、LLM プロファイル、モデル管理、Multi-Output、会議索引が 1 ファイルに混在している。
タブと責務の単位に分割し、設定項目の追加を局所化する。

## 優先度根拠

機能追加ではないが、設定項目の追加のたびに巨大なファイルを読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

`src/renderer/src/SettingsPanel.tsx` は 1621 行で、次の責務を 1 ファイルに持つ。

- 一般、録音、文字起こし、要約のタブ切り替え
- 保存先、外観、UI の言語、About、会議索引
- 入力デバイス、mp3 ビットレート、クリッピング、無音検出、話者分離
- whisper モデル、OpenAI 文字起こし、RE-USE モデル、音声強調の使用量
- LLM プロファイルの一覧、作成、編集、削除、API キー
- 要約プロンプト、要約前の相槌の除去

`code-style` のファイル長の閾値は 1000 行であり、既存コードが閾値を超えていることは追加変更の正当化にならない。

## 設計方針

- 振る舞いを変えない。既存のテストを同じ内容のまま通す。
- 次の component と hook に分ける。
  - `SettingsGeneralTab.tsx`: 保存先、外観、UI の言語、About、会議索引
  - `SettingsRecordingTab.tsx`: 入力デバイス、mp3、クリッピング、無音検出、話者分離、Multi-Output
  - `SettingsTranscriptionTab.tsx`: whisper、OpenAI、RE-USE、音声強調の使用量
  - `SettingsSummaryTab.tsx`: LLM プロファイル、要約プロンプト、相槌の除去
  - `LlmProfileForm.tsx`: LLM プロファイルの作成と編集
  - `use-settings-panel.ts`: モデル、プロファイル、Multi-Output、索引の取得と購読
- タブの状態は `SettingsPanel` に残し、各タブは props で値と操作を受け取る。
- 既存の CSS クラスと表示文言を変えない。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。

## 完了条件

- [ ] `src/renderer/src/SettingsPanel.tsx` が 1000 行以下になる。
- [ ] 4 つのタブの表示、設定の保存、モデルのダウンロード、LLM プロファイル、Multi-Output、索引の再構築が分割前と同じである。
- [ ] 既存の `SettingsPanel.test.tsx` と各設定 component のテストが同じ内容で通る。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md の `### misc` を更新する。
- [ ] 新しい npm 依存を追加しない。

## 解決方法

- タブごとの JSX を `SettingsGeneralTab`、`SettingsRecordingTab`、`SettingsTranscriptionTab`、`SettingsSummaryTab` へ移す。
- LLM プロファイルのフォームと一覧を `LlmProfileForm` へ移す。
- `useEffect` と取得関数を `use-settings-panel.ts` へ移し、`SettingsPanel` はフックの戻り値をタブへ渡す。
- `SettingsPanel.test.tsx` は `SettingsPanel` の統合テストとして残し、タブ component の表示テストを追加する。
- 既存の文言とキーを変えず、i18n の辞書を更新しない。
