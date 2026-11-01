# 1000 行を超えるソースファイルを責務単位に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-large-source-files

## 目的

1000 行を超えるソースファイルを責務単位に分割し、変更の影響範囲とレビュー負荷を小さくする。
UI の表示言語の切り替えを追加したときに、既存の巨大ファイルへさらに変更を加えたことをきっかけに起票する。

## 優先度根拠

機能追加ではないが、今後の変更で毎回巨大ファイルを読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

次のファイルが 1000 行を超えている。

| ファイル | 行数 | 主な責務 |
| --- | --- | --- |
| `src/main/index.ts` | 1754 | アプリ起動、IPC 登録、メニュー、ダイアログ、電源イベント |
| `src/main/processing.ts` | 1593 | 変換、文字起こし、話者分離、要約、翻訳、保存 |
| `src/renderer/src/SettingsPanel.tsx` | 1583 | 4 つの設定タブ、LLM プロファイル、モデル、Multi-Output |
| `src/renderer/src/MeetingDetail.tsx` | 1405 | 文字起こし、要約、翻訳、話者名、確認ダイアログ |
| `src/renderer/src/use-recorder.ts` | 1247 | 録音グラフ、デバイス、チャンク、権限、復旧 |

`code-style` のファイル長の閾値は 1000 行で、既存コードが閾値を超えていることは追加変更の正当化にならない。
UI の表示言語の切り替えでは文言の置き換えが中心だったため、分割は行っていない。

## 設計方針

- 振る舞いを変えない。既存のテストを分割の前後で同じ内容のまま通す。
- 画面はタブ、ダイアログ、ペインの単位でコンポーネントを分ける。状態は親に残すか、責務ごとの custom hook に移す。
- main は IPC の領域 (設定、会議、録音、処理、LLM、Multi-Output) と、ウィンドウ、メニュー、トレイ、電源イベントの単位で module を分ける。
- processing は変換、文字起こし、話者分離、要約、翻訳のフェーズごとに module を分ける。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。
- 1 つの issue で全ファイルを分割すると大きすぎるため、ファイルごとに子 issue を起票して進める。

## 完了条件

- [ ] 対象ファイルがすべて 1000 行以下になる。
- [ ] 分割の前後で利用者に見える振る舞いが変わらない。
- [ ] 既存のテストが分割の前後で同じ結果になる。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] 新しい module の責務と依存方向を ADR またはコードの doc コメントに記録する。
- [ ] CHANGES.md の `### misc` にリファクタリングのエントリを追加する。

## 解決方法

- `src/renderer/src/SettingsPanel.tsx` を `SettingsGeneralTab`、`SettingsRecordingTab`、`SettingsTranscriptionTab`、`SettingsSummaryTab`、`LlmProfileForm`、設定データ取得の hook に分ける。
- `src/renderer/src/MeetingDetail.tsx` を `TranscriptPane`、`SummaryPane`、`SummaryConfirmDialog`、`TranslationConfirmDialog`、`SpeakerRenameDialog`、会議詳細取得の hook に分ける。
- `src/renderer/src/use-recorder.ts` を録音グラフ、デバイス検出、チャンク保存、権限、復旧の hook に分ける。
- `src/main/index.ts` を `window.ts`、`app-menu.ts`、`tray.ts`、`ipc/settings.ts`、`ipc/meetings.ts`、`ipc/recording.ts`、`ipc/processing.ts`、`ipc/llm.ts`、`ipc/multi-output.ts` に分ける。
- `src/main/processing.ts` を変換、文字起こし、話者分離、要約、翻訳の phase module に分ける。
- 分割ごとにテストの配置を見直し、同じ性質を複数の層で重複して検証しないようにする。
