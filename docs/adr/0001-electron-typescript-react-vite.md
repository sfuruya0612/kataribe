# ADR-0001: アプリ基盤に Electron、TypeScript、React、Vite を採用する

Created: 2026-10-28
Model: DeepSeek V4.1 Flash 1017
Status: Accepted

## 背景

Kataribe は macOS 上で会議音声を録音し、端末内で文字起こしを行い、任意の LLM で要約するデスクトップアプリである。
対応環境は macOS 14.2 Sonoma 以降で、Apple Silicon のみを対象とする。
Intel Mac は動作保証外とする（PRD の「非機能要件」）。
画面はメニューバー、会議一覧、会議詳細、設定の 4 つで、録音中と文字起こし中も UI が固まらないことが求められる（PRD の「ユーザーフローと画面構成」）。

PRD はアプリ基盤に Electron、TypeScript、React、Vite を指定している。
録音は Renderer の Web Audio で行い、エンコードと文字起こしは子プロセスに逃がす（PRD の「アーキテクチャと技術選定」）。
Electron はメインプロセスと Renderer の 2 層を持ち、Renderer から Web Audio と `getUserMedia` を利用できる。
メインプロセスはウィンドウ、トレイ、子プロセス、ファイル、ネットワーク、Keychain を扱う。

この構成では、UI の部品と録音の Web API を同じ Renderer に置ける一方、OS の機能と長時間ジョブはメインプロセスに集まる。
その境界を決めておかないと、Renderer に Node の権限が漏れたり、重い処理が UI を止めたりする。

## 決定

- アプリ基盤は Electron、TypeScript、React、Vite とする。
- メインプロセスは、ウィンドウとトレイのライフサイクル、子プロセスの起動と監視、会議フォルダの読み書き、LLM への通信、safeStorage、SQLite の索引を担当する。
- Renderer は、画面の描画、マイクとシステム音声の取得、録音中の入力レベルの計算を担当する。
- Renderer の Node.js 連携は無効にし、`nodeIntegration` を false、`contextIsolation` を true にする。
  Renderer が必要とする操作は preload の `contextBridge` で限定した API として公開する。
- Renderer の sandbox は有効にする。
  子プロセスの起動やファイルの書き込みは Renderer から直接行わず、preload の API を経由してメインプロセスに依頼する。
- 画面は React のコンポーネントで作り、ビルドと開発サーバーには Vite を使う。
- 対応 OS は macOS 14.2 Sonoma 以降とする。
  Apple Silicon のみを対象とし、Intel Mac は動作保証外とする（PRD の「非機能要件」）。
- メディア処理と文字起こしは Node.js のネイティブアドオンではなく、同梱バイナリの子プロセスで行う（ADR-0004）。
  アプリ独自のネイティブコードは持たないが、既製のネイティブモジュールと同梱バイナリは例外とする。
  SQLite の `better-sqlite3` は例外的にネイティブモジュールを使う（ADR-0010）。
  Electron の版を上げるときは `better-sqlite3` の再ビルドが必要になる。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| SwiftUI と AppKit のネイティブアプリ | システム音声や子プロセスの制御は素直に書けるが、PRD が Electron を指定している。UI と録音の実装を別の言語体系で持つことにもなる |
| Tauri | バイナリは小さくなるが、Renderer の Web Audio と入力デバイスの取得に相当する部分を Rust 側で作り直す必要がある。PRD の Electron 指定からも外れる |
| Flutter の macOS デスクトップ | UI は作れるが、macOS の音声ループバックと子プロセスの扱いに独自のプラグインが要る。PRD の Electron 指定からも外れる |
| Electron と JavaScript | 型のない IPC と設定の受け渡しが増え、会議データの schema を保ちにくい。TypeScript を指定した PRD にも反する |
| Electron と Webpack | 開発時の起動が遅く、Vite を指定した PRD に反する。設定の複雑さも増える |
| Renderer に Node.js の権限を残す | 画面の不具合や外部コンテンツからファイルシステムと子プロセスに触れられる。会議音声と API キーを守る構成に反する |

## 結果

- 配布物に Chromium と Node.js が含まれるため、アプリ本体は Electron の分だけ大きくなる。
  PRD の 300 MB 以下という目標に対して、同梱する ffmpeg と whisper.cpp のサイズを含めて測る必要がある（ADR-0014）。
- Electron のセキュリティ更新を追う必要がある。
  マイナー版の更新で音声入力の挙動が変わる可能性があるため、BlackHole 2ch の入力取得と録音の検証（ADR-0003）とセットで版を固定する。
- メインプロセスと Renderer の間の IPC が、画面と OS 機能の唯一の境界になる。
  IPC のチャネル名、引数、戻り値、エラーの形を preload で定義し、Renderer から任意のチャネルを呼べないようにする。
  メインプロセス側でも `event.senderFrame` と引数の schema を検証し、Renderer から絶対パスを受け取らない。
  preload で公開する API は、録音の制御、会議データの読み書き、設定の取得と更新、LLM の送信依頼など、画面に必要な操作に限定する。
- 録音中は Renderer が背面にあっても音声処理を続ける必要がある。
  Electron の background throttling を無効にする設定を、録音を行う Renderer に適用する（ADR-0002）。
- Vite は Renderer の開発に使い、メインプロセスと preload のビルド構成は別に決める。
  Electron 向けの Vite プラグインを使うか、TypeScript のコンパイラを併用するかは実装時に選ぶ。
- Intel Mac は動作保証外とする。
  Electron 自体は動作する可能性があるが、whisper.cpp の速度と Metal の利用を保証しない。

## 未決事項

- Electron のメジャーバージョンと更新方針。
  システム音声は BlackHole 2ch などの入力デバイスとして取得するため、Electron の版は BlackHole 2ch の入力取得と録音の検証（ADR-0003）で固定する。
- メインプロセスと preload のビルド方法。
  electron-vite などの構成を使うか、Vite と tsc を分けるか。
- preload で公開する API の一覧と、メインプロセス側の IPC ハンドラの命名規則。
- 自動更新の仕組みを入れるか（ADR-0014）。
