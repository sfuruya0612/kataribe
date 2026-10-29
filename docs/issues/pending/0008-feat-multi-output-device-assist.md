# Multi-Output Device の作成をアプリで支援する方法を決める

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: R-2、F-2、非機能要件の権限
依存: 0001

## 背景

M0 では、CoreAudio の Aggregate Device を一時的に作成する補助ツールで、スピーカーまたは AirPods と BlackHole 2ch の Multi-Output Device を作り、録音を検証した。
この方法は `docs/m0/0003-system-audio/multi-output.swift` で動作することを確認している。
一方で、MVP の利用者に Audio MIDI Setup での手動作成を求めるか、アプリから Aggregate Device を作るかは決めていない。

アプリから作る場合は、利用者の音声出力設定を変更する権限、作成したデバイスの名前、削除のタイミング、失敗時の復旧を設計する必要がある。
手動の場合は、初回設定の手順とトラブルシュートが重要になる。

## 目的

Multi-Output Device の作成を、MVP で手動案内にするか、アプリから支援するかを決める。
決めた内容を ADR-0003 に反映する。

## やること

- 手動案内と、CoreAudio の Aggregate Device をアプリから作る案を比較する。
  比較軸は、初回設定の成功率、管理者権限、音声出力の変更範囲、削除と復旧、macOS のバージョン差、テストのしやすさとする。
- アプリから作る場合の、デバイス名、作成のタイミング、終了時の削除、既存の Multi-Output Device との衝突を設計する。
- 手動案内にする場合の、Audio MIDI Setup の手順と、設定後のテスト録音を設計する。
- 決定を ADR-0003 の「決定」と「未決事項」に反映する。
- 実装する場合は、別の issue に分ける。

## 完了条件

- 手動案内と自動支援のどちらを MVP に採るかが決まっている。
- 決定の根拠と、却下した案の理由が ADR-0003 に書かれている。
- 実装する場合は、実装用の issue が作られている。
- 手動案内の場合は、Audio MIDI Setup の手順が利用者向けの文書に入っている。

## pending にした理由

MVP では手動案内でも U2 を満たせる。
アプリからの Aggregate Device 作成は、音声出力の変更と削除の設計が必要で、M0 の完了後に判断する。
そのため、今は設計判断の issue として保留する。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/m0/0003-system-audio/multi-output.swift`
- `docs/m0/0003-system-audio/README.md`
