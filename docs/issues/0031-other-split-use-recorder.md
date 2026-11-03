# use-recorder.ts を録音グラフ、デバイス、チャンク、権限、復旧の単位に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-use-recorder

## 目的

`src/renderer/src/use-recorder.ts` が 1200 行を超え、録音グラフ、デバイス検出、チャンク保存、権限、復旧、レベル監視が 1 つの hook に混在している。
責務ごとの hook に分割し、録音の変更を局所化する。

## 優先度根拠

機能追加ではないが、録音と復旧の変更のたびに巨大な hook を読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

`src/renderer/src/use-recorder.ts` は 1245 行で、次の責務を 1 つの hook に持つ。

- AudioContext、AudioWorklet、録音グラフの生成と破棄
- マイク、BlackHole、Multi-Output Device の検出
- チャンクの生成、送信、失敗時の処理
- マイク権限の確認と要求
- 復旧できる録音の一覧と復旧
- 入力レベル、クリッピング、無音、デバイス切断、スリープ復帰の監視

`code-style` のファイル長の閾値は 1000 行であり、既存コードが閾値を超えていることは追加変更の正当化にならない。

## 設計方針

- 振る舞いを変えない。既存のテストを同じ内容のまま通す。
- 次の hook と module に分ける。
  - `use-recording-graph.ts`: AudioContext、AudioWorklet、録音グラフ
  - `use-audio-devices.ts`: マイクと BlackHole の検出、デバイス変更の監視
  - `use-chunk-writer.ts`: チャンクの生成、送信、失敗時の再試行
  - `use-microphone-permission.ts`: 権限の確認と要求
  - `use-recording-recovery.ts`: 復旧できる録音の一覧と復旧
  - `use-recording-monitor.ts`: レベル、クリッピング、無音、切断、スリープ復帰
- `useRecorder` は公開 API と状態の合成だけを持ち、各 hook を呼ぶ。
- 状態の所有者を 1 つに保ち、同じ状態を複数の hook が持たない。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。

## 完了条件

- [ ] `src/renderer/src/use-recorder.ts` が 1000 行以下になる。
- [ ] 録音の開始、停止、チャンク保存、権限、復旧、レベル監視が分割前と同じである。
- [ ] 既存の録音の hook と回帰テストが同じ内容で通り、分割した hook のテストを追加する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md の `### misc` を更新する。
- [ ] 新しい npm 依存を追加しない。

## 解決方法

- 録音グラフの生成と破棄を `use-recording-graph.ts` へ移す。
- デバイスの列挙と変更の監視を `use-audio-devices.ts` へ移す。
- チャンクの生成と送信を `use-chunk-writer.ts` へ移す。
- 権限の確認と要求を `use-microphone-permission.ts` へ移す。
- 復旧の一覧と復旧を `use-recording-recovery.ts` へ移す。
- レベル、クリッピング、無音、切断、スリープ復帰を `use-recording-monitor.ts` へ移す。
- `useRecorder` の公開 API と戻り値の形を変えず、既存の呼び出し元を更新しない。
