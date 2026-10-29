# BlackHole 2ch のライセンス、配布、サポート資料を整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)
関連 PRD: 非機能要件のプライバシー、配布、権限
依存: 0010、0011、0013

## 背景

Kataribe は BlackHole 2ch をアプリに同梱せず、利用者が公式の配布元からインストールする。
BlackHole は GPLv3 のソフトウェアである。
インストールには管理者権限が必要で、macOS のアップデート後に再インストールが必要になる場合がある。
AirPods の HFP、Multi-Output Device の作成、出力デバイスの変更など、利用者がつまずきやすい点がある。

## 目的

BlackHole 2ch のライセンスと配布の条件を明確にし、利用者向けのサポート資料を整備する。

## やること

- README と About 画面に、BlackHole 2ch を同梱していないこと、GPLv3 のソフトウェアであること、公式の配布元を表示する。
  About 画面は ADR-0015 で定義されている。
  BlackHole 2ch を再配布しないため GPLv3 の表示義務は生じないが、利用者が入手先を確認できるよう出典を書く。
- 動作確認済みの BlackHole 2ch のバージョンを明記し、インストール手順とアンインストール手順を書く。
- README に、Multi-Output Device の作成、出力の選択、短いテスト録音、音が出ない場合のトラブルシュートを、スクリーンショット付きで整理する。
- README に、Multi-Output Device の主デバイスをスピーカーまたはヘッドホンにすること、Bluetooth 出力で音が飛ぶ場合の Drift Correction、Multi-Output Device では音量キーが効かない場合があることを書く。
- README に、Bluetooth の品質と推奨構成を書く。
  - AirPods では、Bluetooth 出力は A2DP の 48 kHz ステレオ、Bluetooth 入力は HFP の 24 kHz モノラルになる。
    これは M0 で確認した値であり、機種とファームウェアは記録していない。
  - Bluetooth ヘッドホンのマイクを入力に使うと、macOS は HFP に切り替え、出力も HFP に切り替わり品質が下がる。
  - HFP は、Kataribe のマイクだけでなく、macOS の既定入力や会議アプリのマイクが AirPods を開いた場合にも起きる。
  - システム音声とマイクを同時に録る場合の推奨構成は、出力に AirPods などの Bluetooth ヘッドホン、入力に内蔵マイクまたは USB マイクを使うこと。
  - Multi-Output Device には Bluetooth 出力と BlackHole 2ch を入れ、macOS の音声出力に設定する。
  - macOS の既定入力、会議アプリのマイク、Kataribe のマイクを、内蔵マイクまたは USB マイクにする。
  - Kataribe のシステム音声入力は BlackHole 2ch にする。
  - Bluetooth ヘッドホンを入力と出力の両方に使わない。
  - 接続した状態で Multi-Output Device を作成し、切断したら再接続して出力を選び直す。遅延があることも書く。
- 出力デバイスを変更したときに、システム音声が届かなくなることを書く。
- macOS のアップデート後に BlackHole が見つからない場合の再インストール手順を書く。
- 配布物に BlackHole のバイナリやインストーラを含めないことを、リリースチェックリストで確認する。
- README の手順どおりに Multi-Output Device を作り、録音を 1 回通す。

## 完了条件

- README と About 画面に、BlackHole 2ch を同梱していないこと、GPLv3 であること、公式の配布元が書かれている。
- インストール、設定、アンインストール、トラブルシュートの手順が利用者向けの README にある。
- README に、Bluetooth 入力の HFP による品質低下と、Bluetooth 出力 + 内蔵/USB マイクの推奨構成、macOS の既定入力と会議アプリのマイクの設定が書かれている。
- README の手順どおりに作った Multi-Output Device で、録音を 1 回通せる。
- リリースチェックリストに、BlackHole を同梱していないことの確認がある。

## 解決方法

2026-10-29 に BlackHole 2ch のライセンス、配布、サポート資料を整備した。

- About 画面に、BlackHole 2ch が GPLv3 であること、Kataribe が同梱、再配布しないこと、公式の配布元を表示する `credits` を追加した。
- README に、動作確認済みの BlackHole 2ch 0.7.1、インストール、Multi-Output Device の作成、macOS の音声出力の選択、入力の設定、短いテスト録音、アンインストールを記載した。
- README のトラブルシューティングに、BlackHole が見つからない場合、入力レベルが動かない場合、音が聞こえない場合、AirPods の音質、録音中の出力変更、スリープ、スピーカーでのハウリングを記載した。
- README に、Bluetooth の HFP、推奨構成、Drift Correction、接続し直した場合の出力選択、遅延を記載した。
- README に、macOS のアップデート後に BlackHole を再インストールする手順を記載した。
- README にアプリの録音パネル、会議一覧、設定画面のスクリーンショットを追加した。
- リリースチェックリストに、BlackHole を同梱していないこと、ライセンス表示、About の出典の確認を追加した。

確認結果:

- `npm run typecheck`、`npm test`、`npm run build`、`npm run smoke`、`npm run test:window`: 成功。
- パッケージ済みアプリの `Info.plist` と `Resources` を `npm run verify:mac` で検査し、BlackHole のバイナリがないことを確認した。
- About 画面の出典表示は `app.setAboutPanelOptions` の `credits` で設定した。
- Audio MIDI Setup の画面そのもののスクリーンショットは環境依存のため含めず、手順をテキストで記載した。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/issues/0013-feat-release-checklist-and-entitlements.md`
- `docs/m0/0003-system-audio/README.md`
- `docs/prd/kataribe.md` の非機能要件
