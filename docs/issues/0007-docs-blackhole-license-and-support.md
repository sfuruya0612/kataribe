# BlackHole 2ch のライセンス、配布、サポート資料を整備する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)
関連 PRD: 非機能要件のプライバシー、配布、権限
依存: 0001

## 背景

Kataribe は BlackHole 2ch をアプリに同梱せず、利用者が公式の配布元からインストールする。
BlackHole は GPLv3 のソフトウェアである。
インストールには管理者権限が必要で、macOS のアップデート後に再インストールが必要になる場合がある。
AirPods の HFP、Multi-Output Device の作成、出力デバイスの変更など、利用者がつまずきやすい点がある。

## 目的

BlackHole 2ch のライセンスと配布の条件を明確にし、利用者向けのサポート資料を整備する。

## やること

- アプリ内の設定画面と About 画面に、BlackHole 2ch を同梱していないこと、GPLv3 のソフトウェアであること、公式の配布元を表示する。
- 対応する BlackHole 2ch のバージョンを固定し、インストール手順とアンインストール手順を書く。
- Multi-Output Device の作成、出力の選択、テスト録音、音が出ない場合のトラブルシュートを、スクリーンショット付きで整理する。
- Bluetooth ヘッドホンで HFP に切り替わる問題と、入力に AirPods を選ばない推奨を書く。
- 出力デバイスを変更したときに、システム音声が届かなくなることを書く。
- macOS のアップデート後に BlackHole が見つからない場合の再インストール手順を書く。
- 配布物に BlackHole のバイナリやインストーラを含めないことを、リリースチェックリストで確認する。

## 完了条件

- 設定画面と About 画面に、BlackHole のライセンスと公式の配布元が表示される。
- インストール、設定、アンインストール、トラブルシュートの手順が `docs/` にある。
- リリースチェックリストに、BlackHole を同梱していないことの確認がある。
- AirPods と Multi-Output Device の注意点が、利用者向けの文書に含まれている。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/m0/0003-system-audio/README.md`
- `docs/prd/kataribe.md` の非機能要件
