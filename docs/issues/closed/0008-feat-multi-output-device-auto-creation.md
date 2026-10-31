# MVP 後に Multi-Output Device の自動作成を導入するか決める

Created: 2026-10-29
Completed: 2026-10-31
Model: DeepSeek V4.1 Flash 1017
優先度: P2
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0001 (docs/adr/0001-electron-typescript-react-vite.md)、ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)
関連 PRD: U2、R-2、非機能要件の対応環境、権限、配布
依存: 0001、0007

## 背景

M0 では、CoreAudio の Aggregate Device を一時的に作成する補助ツールで、スピーカーまたは AirPods と BlackHole 2ch の Multi-Output Device を作り、録音を検証した。
この方法は `docs/m0/0003-system-audio/multi-output.swift` で動作することを確認している。

ADR-0003 は、MVP では利用者が Audio MIDI Setup で Multi-Output Device を作り、Kataribe は macOS の音声出力を自動で変更しないと決定した。
issue 0001 はこの決定に沿って、BlackHole の検出と、見つからない場合のシステム音声の無効化を実装する。
初回設定の手順は README に置き、アプリ内にセットアップ wizard は持たない。
issue 0007 は利用者向けの README とトラブルシュートを整備する。
したがって、MVP の方式は決定済みである。
この issue に残っているのは、MVP 後に自動作成へ置き換えるかどうかである。

BlackHole 2ch のインストールには管理者権限が必要だが、M0 の補助 CLI は管理者権限なしで Aggregate Device を作成し、既定の出力を変更できた。
Aggregate Device の作成と出力の変更では、M0 の環境で OS の権限ダイアログは出なかった。
一方で、利用者の音声出力をアプリが変更することへの同意、変更前の出力の復元、異常終了時の後始末を設計する必要がある。

## 目的

MVP 後に、Multi-Output Device の作成をアプリで支援するかを決める。
導入する場合は、ADR-0003 の決定を変更する範囲と、実装、テストの条件を明らかにする。

## 決定済みの範囲

- MVP は README による手動設定とする。アプリ内にセットアップ wizard は置かない（ADR-0003、issue 0001、issue 0007）。
- アプリは macOS の音声出力を自動で変更しない（ADR-0003）。
- この issue の結論は、issue 0001 と issue 0007 の完了条件ではない。両方の issue はこの issue を待たずに進める。

## やること

- README に GitHub Issues のテンプレートへのリンクを置き、利用者が再現手順とローカルのログを添えて報告できるようにする。
- MVP の利用者から、README の手順で手動設定を完了できたか、つまずいた箇所の報告を集める。
  テレメトリは収集しない。
- README による手動設定と、CoreAudio の Aggregate Device をアプリから作る案を比較する。
  比較軸は、初回設定の成功率、管理者権限と OS の権限ダイアログの有無、音声出力の変更範囲と変更前の出力の復元、作成したデバイスの削除と異常終了時の後始末、既存の Multi-Output Device との衝突、macOS のバージョン差、テストのしやすさとする。
- 自動作成を採る場合の設計を書く。
  - デバイス名と UID の付け方
  - 作成のタイミング
  - 終了時と異常終了時の削除
  - 変更前の出力の保存と復元
  - 既存の Multi-Output Device との衝突回避
  - 0002 の無音検出との整合
  - 対応する macOS のバージョンと検証方法
- 決定を ADR-0003 の「決定」と「未決事項」に反映する。
  ADR-0003 の決定を変更する場合は、新しい ADR を起こすか ADR-0003 を改訂するかを決める。
- 実装する場合は、別の issue に分ける。
- 導入しない場合は、その結論と根拠を ADR-0003 に残し、この issue を close する。

## 完了条件

- MVP 後の方針（自動作成を導入するか、README による手動設定を維持するか）が決まっている。
- 決定の根拠と、却下した案の理由が ADR-0003 に書かれている。
- 導入する場合は、実装用の issue が作られている。
- README による手動設定を維持する場合は、Audio MIDI Setup の手順が利用者向けの README にあることを確認している。

## pending にした理由

保留しているのは、MVP 後に自動作成へ置き換えるかどうかである。
MVP の方式は決定済みであり、この issue の元の問い「MVP で手動か自動か」は未決ではない。
2026-10-29 時点では、自動作成を採る根拠が揃っていないため、次の 4 点の見通しが立つまで待つ。

1. 手動設定が利用者の負担になっているかが未検証である。
   M0 は手順を理解した状態で成功しただけで、初見の利用者が完了できるかは測っていない。
   U2 を満たせることと、初回設定の成功率が高いことは別である。
2. 自動作成は、ADR-0003 の「アプリは macOS の音声出力を自動で変更しない」という決定を覆す。
   覆すには、変更への同意、変更前の出力の保存と復元、異常終了時の後始末、既存デバイスとの衝突回避を設計し、issue 0002 の無音検出とも整合させる必要がある。
   自動作成には CoreAudio の Aggregate Device API を呼ぶネイティブコードが必要で、ADR-0001 の「アプリ独自のネイティブコードを持たない」方針も変更する必要がある。
   ADR-0014 の署名対象も増える。
3. M0 の `multi-output.swift` は検証用の補助 CLI であり、製品コードの土台にできない。
   デバイス名は固定、UID は毎回新規、既存デバイスとの衝突処理なし、作成途中で失敗した場合の復旧なしという制約がある。
   動作を確認した環境も macOS 26.7.1 の arm64 だけである。
4. MVP の手動方式も、検証済みは macOS 26.7.1 のみで、macOS 14.2 から 26.7.0 はベストエフォートである。
   自動作成を入れると、Aggregate Device の作成と削除についても、同じベストエフォート範囲を広げることになる。
   CoreAudio API の版差を追加で検証する必要がある。

MVP のリリース後 4 週間、または再現可能な報告が 3 件集まった時点で一度見直す。
再開する条件は、次のいずれかを満たしたときとする。

- README の手順で Multi-Output Device の作成を完了できない、または短いテスト録音が失敗する再現可能な報告が得られた。
- 手動設定の負担が、初回設定を諦める主要因だと判断できる事例が得られた。
- 自動作成を必須とする具体的な要件、または特定の macOS バージョンで手動作成が失敗する再現報告が出た。

MVP の利用で README の手順が定着した場合は、自動作成を導入しないと決定してこの issue を close し、その結論を ADR-0003 に追記する。
issue 0001 の入力デバイス検出、issue 0007 の README、issue 0002 の無音検出は、この issue の結論を待たずに進める。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0001-electron-typescript-react-vite.md`
- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/m0/0003-system-audio/multi-output.swift`
- `docs/m0/0003-system-audio/README.md`
- `docs/prd/kataribe.md` の U2、R-2、非機能要件
## 解決方法

2026-10-31 に、設定画面から Multi-Output Device を自動作成する方針を採用した。
決定は ADR-0018 に記録し、ADR-0001 と ADR-0003 を改訂した。

- 設定画面の「録音」タブに、出力デバイスの選択、自動作成、削除の操作を追加した。
- 作成前に、選択した出力デバイス、BlackHole 2ch、macOS の出力が変わることを確認ダイアログに表示する。
- 作成する Aggregate Device の名前は `Kataribe Multi-Output` とし、既存の同名デバイスは削除して作り直す。
- 作成後、macOS の既定出力とシステム出力を Kataribe Multi-Output に設定する。
- 録音中または処理中は、作成と削除を実行しない。
- CoreAudio を扱う Swift ヘルパー `kataribe-multi-output` を `resources/bin/arm64/` に同梱し、`npm run binaries` で再生成できるようにした。
- ヘルパーの `list` と `remove` は macOS 26.7.1 の arm64 で確認した。
  実際の `create` はシステムの音声出力を変更するため、自動テストでは実行していない。
  アプリの確認ダイアログを経た操作でのみ実行する。
- 検証は macOS 26.7.1 の arm64 に限る。
  macOS 14.2 から 26.7.0 はベストエフォートとする。

残る未決事項は ADR-0018 に記録した。
