# Kataribe（語り部）

Kataribe は、macOS で会議音声を録音し、端末内で文字起こしし、任意の LLM で要約と ToDo を Markdown にまとめるデスクトップアプリです。
Zoom や Google Meet の相手の声と自分の声を 1 本の mp3 に録音し、会議後に mp3、文字起こし、要約、ToDo を 1 つのフォルダに保存します。

## 名前について

Kataribe（語り部）は、その場で聞いた出来事を記憶し、後の人に語り継ぐ役を表します。
録音、文字起こし、要約の 3 工程をそのまま表す名前です。
同名のツールと区別するため、配布時は「Kataribe 会議録」と併記します。
GitHub のリポジトリ名もアプリ名と同じ `kataribe` にします。

## ステータス

開発中です。
アプリ基盤、録音中核、メニューバー、会議一覧、会議詳細、設定の土台は実装済みです。
M0 のシステム音声検証は完了しています。
会議一覧と会議詳細の本実装、設定値の保存、mp3 への変換、文字起こし、要約はまだ実装されていません。
この README の初期セットアップ手順は、録音機能を使う利用者向けです。

## ドキュメント

- [PRD](docs/prd/kataribe.md)
- [ADR 一覧](docs/adr/)
- [Issue 一覧](docs/issues/)
- [変更履歴](CHANGES.md)
- [M0 システム音声検証](docs/m0/0003-system-audio/README.md)

主な ADR:

- [ADR-0001: Electron + TypeScript + React + Vite](docs/adr/0001-electron-typescript-react-vite.md)
- [ADR-0002: Web Audio 録音とチャンク](docs/adr/0002-web-audio-recording-and-chunks.md)
- [ADR-0003: システム音声は BlackHole 経由](docs/adr/0003-system-audio-virtual-device.md)
- [ADR-0012: メニューバーとメインウィンドウ](docs/adr/0012-menu-bar-and-main-window.md)
- [ADR-0014: DMG 配布と署名、公証](docs/adr/0014-distribution-dmg-notarization.md)

## 動作環境

- macOS 14.2 Sonoma 以降を目標
- Apple Silicon
- 検証済み: macOS 26.7.1 (25G241)、arm64
- Intel Mac は対象外
- BlackHole 2ch 0.7.1 で検証済み
- 開発には Node.js 24.21.0 以降と npm が必要

macOS 14.2 以降のすべての版で動作を保証するものではありません。
検証は macOS 26.7.1 で行っています。

## 初期セットアップ

Kataribe でシステム音声を録音するには、BlackHole 2ch と Multi-Output Device の設定が必要です。
Kataribe は macOS の音声出力を自動で変更しません。

### 1. BlackHole 2ch をインストールする

1. [BlackHole の公式配布元](https://existential.audio/blackhole/) から BlackHole 2ch をダウンロードします。
2. インストーラを実行します。管理者権限が必要です。
3. インストール後に `coreaudiod` を再起動するか、Mac を再起動します。

BlackHole 2ch は GPLv3 のソフトウェアです。
Kataribe は BlackHole 2ch を同梱せず、再配布しません。

### 2. Multi-Output Device を作る

1. `Audio MIDI Setup` を開きます。
2. 左下の `+` から `Create Multi-Output Device` を選びます。
3. スピーカーまたはヘッドホンと `BlackHole 2ch` にチェックを入れます。
4. 主デバイス（一覧の先頭）をスピーカーまたはヘッドホンにします。
5. Bluetooth 出力で音が飛ぶ場合は、BlackHole 2ch の `Drift Correction` を有効にします。

Multi-Output Device では macOS の音量キーが効かない場合があります。
音量はスピーカー、ヘッドホン、BlackHole 側で調整してください。

### 3. macOS の音声出力を Multi-Output Device にする

1. `System Settings` の `Sound` を開きます。
2. `Output` で作成した Multi-Output Device を選びます。

BlackHole 2ch を単体で出力に選ぶと、Mac から音が聞こえません。
必ず Multi-Output Device を選んでください。

### 4. Kataribe の入力を設定する

Kataribe の設定画面で、入力を次のようにします。

- システム音声: `BlackHole 2ch`
- マイク: Mac の内蔵マイクまたは USB マイク

システム音声だけを録音する場合は、マイクを使わなくてもかまいません。
マイクとシステム音声の両方を録音する場合は、両方を設定します。

### 5. テスト録音をする

1. 会議アプリまたは音楽プレイヤーで音を再生します。
2. Kataribe で 10 秒程度の録音を開始します。
3. 入力レベルが動くことを確認します。
4. 録音を停止し、mp3 に相手の声と自分の声が入っていることを確認します。

システム音声の入力レベルが動かない場合は、[トラブルシューティング](#トラブルシューティング) を確認してください。

## Bluetooth を使う場合

Bluetooth ヘッドホンのマイクを入力に使うと、macOS は HFP に切り替えます。
AirPods では HFP は 24 kHz モノラルになり、会議音声や音楽の品質が下がります。
Kataribe はこの切り替えを防げません。

推奨する組み合わせは次のとおりです。

| 項目 | 推奨 |
| --- | --- |
| 出力 | AirPods などの Bluetooth ヘッドホン（A2DP） |
| マイク入力 | Mac の内蔵マイクまたは USB マイク |
| Multi-Output Device | Bluetooth 出力 + BlackHole 2ch |
| macOS の音声出力 | 上記の Multi-Output Device |
| macOS の入力 | 内蔵マイクまたは USB マイク |
| 会議アプリのマイク | 内蔵マイクまたは USB マイク |
| Kataribe のシステム音声入力 | BlackHole 2ch |
| Kataribe のマイク入力 | 内蔵マイクまたは USB マイク |

Bluetooth ヘッドホンを入力と出力の両方に使わないでください。
Bluetooth 出力を使うときは、接続した状態で Multi-Output Device を作成します。
切断した場合は、再接続して macOS の出力を選び直してください。
Bluetooth 出力には遅延があります。

## 起動方法

### 配布版

配布版はまだありません。
リリース後は GitHub Releases から DMG をダウンロードし、Applications に移動して起動します。
初回の録音時または入力デバイスの検出時に、マイク権限のダイアログが出ます。

### 開発版

必要なもの:

- Node.js 24.21.0 以降
- npm

```sh
npm install
npm run dev
```

ビルドと確認:

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run test:window
npm run package
```

`npm run package` は署名なしの `release/mac-arm64/Kataribe.app` を作る。
`npm run test:window` は、メインウィンドウを閉じてもアプリが終了せず、ウィンドウが非表示になることを確認する。
署名と公証は [issue 0013](docs/issues/0013-feat-release-checklist-and-entitlements.md) で行う。

起動するとメニューバーにマイクのアイコンが表示されます。

- アイコンを左クリックすると、録音を開始または停止します。
- アイコンを右クリックすると、状態、経過時間、録音の開始と停止、入力ソース、メインウィンドウを開く項目、終了のメニューが表示されます。
- メインウィンドウを閉じてもアプリは終了せず、メニューバーに残ります。
- 2 つ目の Kataribe を起動すると、既存のウィンドウが前面に表示されます。

開発版の録音パネルでは、次の流れを確認できます。

1. 入力ソースにマイク、システム音声、両方のいずれかを選びます。
2. マイクと BlackHole 2ch の入力デバイスを選びます。
3. 録音を開始し、経過時間、ピーク、RMS、実フレーム数を確認します。
4. 録音を停止すると、`~/Documents/Kataribe/YYYY/YYYY-MM-DD_HHMM_タイトル未入力/` に `audio.wav` と `meta.json` を保存します。

録音中の音声は 10 秒ごとに一時ディレクトリへ WAV チャンクとして書き出します。
停止時にチャンクを `audio.wav` に結合し、一時ファイルを削除します。
mp3 と 16 kHz wav の生成はまだ実装していません。
録音中にアプリが異常終了した場合は、次回起動時に録音パネルへ復旧できる録音が表示されます。

会議一覧、会議詳細、設定は画面の土台だけを実装しています。
会議一覧と会議詳細の本実装、設定値の保存、モデルのダウンロードは次の issue で追加します。
設定画面の入力ソースは、メニューバーとメインウィンドウの録音パネルに同期します。
BlackHole 2ch のセットアップ手順は、設定画面から README を開いて確認できます。

## 初回起動後の設定

設定画面は土台だけを実装しています。
設定値の保存はまだ実装していません。
現在の保存先は `~/Documents/Kataribe/` 固定です。

1. 保存先フォルダを設定します。既定は `~/Documents/Kataribe/` です。
2. whisper.cpp のモデルを選び、ダウンロードします。large-v3-turbo は約 1.6 GB です。
3. LLM プロバイダを選び、エンドポイント URL、API キー、モデル名を設定します。API キーは macOS Keychain に保存されます。
4. 必要なら要約の出力言語を変更します。既定は日本語です。

## 権限

- マイク: 入力デバイスの検出とマイク録音に使います。初回の入力デバイス検出時または録音開始時に要求します。システム音声だけを使う場合も、BlackHole 2ch の検出のためにマイク権限が必要です。
- 書類フォルダ: 会議の保存先に使います。
- 画面収録: 使いません。Kataribe は画面収録権限を要求しません。

## プライバシー

音声と文字起こしは端末内に保存します。
LLM に送るのは文字起こし結果の Markdown だけで、利用者が明示的に操作したときだけ送ります。
テレメトリは収集しません。

## トラブルシューティング

### BlackHole 2ch が見つからない

- BlackHole 2ch がインストールされているか確認します。
- インストール後に `coreaudiod` を再起動するか、Mac を再起動します。
- macOS のアップデート後に見つからない場合は、BlackHole 2ch を再インストールします。
- Kataribe を再起動し、設定画面で再検出します。
- BlackHole 16ch や 64ch もインストールしている場合は、Multi-Output Device と Kataribe の入力で同じものを選びます。推奨は 2ch です。

### システム音声の入力レベルが動かない

- macOS の音声出力が Multi-Output Device になっているか確認します。
- Multi-Output Device に BlackHole 2ch が入っているか確認します。
- 出力がミュートされていないか、音量が 0 でないか確認します。
- Kataribe のシステム音声入力が BlackHole 2ch になっているか確認します。
- テスト音が実際に再生されているか確認します。
- Multi-Output Device を複数作っている場合は、macOS の出力で使うものを 1 つにします。

### 音が聞こえない

- macOS の音声出力が Multi-Output Device になっているか確認します。
- BlackHole 2ch を単体で出力にしていないか確認します。
- Multi-Output Device にスピーカーまたはヘッドホンが入っているか確認します。
- 音量が 0 またはミュートになっていないか確認します。

### AirPods の音質が悪い

- AirPods のマイクを入力に使うと HFP に切り替わります。
- macOS の入力、会議アプリのマイク、Kataribe のマイクを、内蔵マイクまたは USB マイクにします。
- AirPods は出力だけに使います。

### 録音中に音声出力が変わった

- macOS の音声出力を Multi-Output Device に戻します。
- Kataribe は無音を検出すると警告します。
- 録音中に出力を変更すると、システム音声が録音されないことがあります。

### 録音中に Mac がスリープした

- 録音中は Kataribe がシステムスリープを抑止します。
- 強制的にスリープした場合は、スリープ中の音声が欠落します。
- 復帰後に録音が再開しても、欠落区間は元に戻りません。

### スピーカーで録音すると自分の声が二重になる

- スピーカーから出た相手の声をマイクが拾っています。
- ヘッドホンを使ってください。
- エコーキャンセルは、会議アプリの音声には効かない場合があります。

## アンインストール

1. Kataribe を終了します。
2. Applications から Kataribe を削除します。
3. 必要に応じて `~/Library/Application Support/Kataribe/` と保存先フォルダを削除します。
4. Audio MIDI Setup から使わなくなった Multi-Output Device を削除します。
5. BlackHole 2ch が不要な場合は、公式の手順でアンインストールします。

## ライセンスと第三者ソフトウェア

- BlackHole 2ch は GPLv3 のソフトウェアです。Kataribe は同梱せず、再配布しません。
- BlackHole 2ch の公式配布元: <https://existential.audio/blackhole/>
- ffmpeg と whisper.cpp のライセンスと著作権表示は、アプリの配布物に含めます（ADR-0014）。

## 開発

- [PRD](docs/prd/kataribe.md)
- [ADR 一覧](docs/adr/)
- [Issue 一覧](docs/issues/)
- [リリースチェックリスト](docs/release-checklist.md)
- [M0 システム音声検証](docs/m0/0003-system-audio/README.md)

Issue は番号の小さい順に進めます。
アプリ基盤の [issue 0009](docs/issues/closed/0009-feat-electron-app-foundation.md)、録音中核の [issue 0010](docs/issues/closed/0010-feat-recording-core.md)、メニューバーと画面の土台の [issue 0011](docs/issues/closed/0011-feat-app-shell-and-recording-ui.md) は実装済みです。
次は issue 0012 以降を進めます。
保留中の issue は `docs/issues/pending/` にあります。
