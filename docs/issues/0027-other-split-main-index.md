# main/index.ts をウィンドウ、メニュー、IPC の領域に分割する

- Requirements: なし (構造のリファクタであり、PRD の要求ではない)
- Priority: Low
- Created: 2026-11-03
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/other-split-main-index

## 目的

`src/main/index.ts` が 2000 行を超え、アプリ起動、ウィンドウ、メニュー、トレイ、IPC、ダイアログ、電源イベントが 1 ファイルに混在している。
責務ごとの module に分割し、変更の影響範囲を小さくする。

## 優先度根拠

機能追加ではないが、IPC や画面の変更のたびに巨大なファイルを読み直すコストと、無関係な差分が混ざるリスクに効く。
現在の機能を止めないため、優先度は Low とする。

## 現状

`src/main/index.ts` は 2148 行で、次の責務を 1 ファイルに持つ。

- アプリの起動と終了、単一インスタンス、`app.whenReady`
- メインウィンドウの生成、表示、閉じる操作、`ready-to-show`
- アプリメニュー、About、ライセンス項目
- トレイの生成と操作
- 音声と音声強調のカスタムプロトコル
- 設定、会議、録音、処理、LLM、モデル、Multi-Output の IPC
- 保存先と README を開くダイアログ、スリープ復帰
- スモークテストと音声強調のスモークテスト

`code-style` のファイル長の閾値は 1000 行であり、既存コードが閾値を超えていることは追加変更の正当化にならない。

## 設計方針

- 振る舞いを変えない。既存のテストを同じ内容のまま通す。
- 次の module に分ける。
  - `src/main/window.ts`: メインウィンドウの生成、表示、閉じる操作、読み込み失敗、破棄時の処理
  - `src/main/app-menu.ts`: アプリメニュー、About、ライセンス項目
  - `src/main/ipc/settings.ts`: 設定、保存先、LLM プロファイル、API キー
  - `src/main/ipc/meetings.ts`: 会議一覧、詳細、検索、削除、タイトル、翻訳
  - `src/main/ipc/recording.ts`: 録音の開始、停止、チャンク、復旧、レベル、権限
  - `src/main/ipc/processing.ts`: 処理状態、キャンセル、要約、再文字起こし
  - `src/main/ipc/models.ts`: whisper、話者分離、RE-USE のモデル管理
  - `src/main/ipc/multi-output.ts`: Multi-Output Device
- 依存する manager は生成関数の引数で渡し、module がグローバル変数を読まないようにする。
- 起動順と IPC の登録順は変えない。登録の重複と欠落をテストで固定する。
- 分割のたびに `npm run typecheck`、`npm test`、`npm run build` を通す。

## 完了条件

- [ ] `src/main/index.ts` が 1000 行以下になる。
- [ ] アプリの起動、ウィンドウ、メニュー、トレイ、IPC の登録順と内容が分割前と同じである。
- [ ] 既存の Main プロセスのテストが同じ内容で通り、IPC の登録漏れがないことをテストで固定する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README、CHANGES.md の `### misc` を更新する。
- [ ] 新しい npm 依存を追加しない。

## 解決方法

- `src/main/index.ts` からウィンドウ関連を `src/main/window.ts` へ移す。
- アプリメニューを `src/main/app-menu.ts` へ移し、`reuseLicenseMenuItems` を組み込む。
- IPC を領域ごとの `src/main/ipc/*.ts` へ移し、`registerIpc` は各 module の登録関数を呼ぶだけにする。
- プロトコル登録を `src/main/protocols.ts` へ移す。
- スモークテストの分岐を `src/main/smoke.ts` へ移す。
- 移した関数のシグネチャは変えず、呼び出し元だけを更新する。
- 既存のテストを移した module のテストへ分割し、振る舞いの検証を減らさない。
