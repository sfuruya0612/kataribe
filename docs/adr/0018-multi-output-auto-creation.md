# ADR-0018: Multi-Output Device は利用者の明示操作で自動作成する

Created: 2026-10-31
Model: DeepSeek V4.1 Flash 1017
Status: Accepted

## 背景

Kataribe は、システム音声を BlackHole 2ch から録音するために、スピーカーまたはヘッドホンと BlackHole 2ch を含む Multi-Output Device を必要とする。
MVP では利用者が Audio MIDI Setup で手動作成し、Kataribe は macOS の音声出力を変更しないと決めていた（ADR-0003）。
手動設定は初見の利用者にとって負担が大きく、出力デバイスの選択を誤るとシステム音声が録音されない。

2026-10-31 に、利用者から Multi-Output Device の自動作成を求める要件が示された。
macOS の CoreAudio API は、管理者権限なしで Aggregate Device を作成し、既定の出力に設定できる。
M0 の補助 CLI で、この操作が macOS 26.7.1 の arm64 で動くことを確認している。

自動作成は macOS の音声出力を変更する。
変更の範囲を利用者に示さず実行すると、会議中に音が出なくなるなどの事故につながる。
したがって、アプリ起動時や録音開始時に自動で実行せず、設定画面での明示操作に限る。

## 決定

- Multi-Output Device は、設定画面の「録音」タブから利用者が出力デバイスを選び、「自動作成して出力に設定」を押したときだけ作成する。
- 作成前に、選択した出力デバイス、BlackHole 2ch、作成するデバイス名、macOS の出力が変わることを確認ダイアログに表示する。
- 作成する Aggregate Device の名前は **Kataribe Multi-Output** とする。
- 既存の Kataribe Multi-Output がある場合は削除して作り直す。
  同じ名前の Aggregate Device が複数残らないようにする。
- 作成後、macOS の既定出力とシステム出力を Kataribe Multi-Output に設定する。
- 設定画面から Kataribe Multi-Output を削除できるようにする。
  削除時も確認ダイアログを出す。
- 録音中または文字起こしなどの処理中は、作成と削除を実行しない。
- 出力デバイスの一覧は CoreAudio から取得し、BlackHole と既存の Aggregate Device を通常の出力先として選べないようにする。
- 実装は Swift の小さなヘルパー `kataribe-multi-output` に分離し、Electron のメインプロセスから子プロセスとして起動する。
  アプリ本体に CoreAudio のコードを直接持たせない。
- ヘルパーは `resources/bin/<arch>/` に同梱し、ビルドスクリプトで再生成できるようにする。
- 作成に失敗した場合は、失敗した理由を設定画面に表示し、macOS の出力を自動で元に戻さない。
  利用者が Audio MIDI Setup またはシステム設定で出力を選び直す。
- macOS 14.2 から 26.7.0 はベストエフォートとし、検証済みの環境を README に記録する。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| 起動時に自動で作成する | 利用者の同意なく音声出力を変更することになり、会議中に音が出ない事故につながる |
| 録音開始時に自動で作成する | 録音開始のたびに出力が変わり、会議アプリ側の出力設定も変わる。利用者が変更を把握できない |
| 手動設定のままにする | 初見の利用者が Audio MIDI Setup でつまずく。システム音声が録音されない原因をアプリから特定しにくい |
| Electron のメインプロセスから CoreAudio を直接呼ぶ | Node.js から CoreAudio を直接扱えず、ネイティブアドオンが必要になる。クラッシュがアプリ全体に波及する |
| サードパーティの仮想オーディオデバイスを同梱する | BlackHole の再配布条件と署名の対象が増える。利用者に別途インストールしてもらう方針を維持する |

## 結果

- 利用者は設定画面から数クリックで Multi-Output Device を作成できる。
- 音声出力の変更は明示操作に限定され、変更内容は確認ダイアログに表示される。
- Swift のヘルパーが増えるため、ADR-0001 の「アプリ独自のネイティブコードを持たない」方針を一部変更する。
- ヘルパーのバイナリを arch ごとに同梱する必要がある。
- 作成後の出力復元は自動で行わない。
  異常終了時に Kataribe Multi-Output が残る可能性があるため、設定画面から削除できるようにする。
- CoreAudio の Aggregate Device API の挙動は macOS の版に依存する。
  検証は macOS 26.7.1 の arm64 で行い、他の版はベストエフォートとする。

## 未決事項

- 作成前の出力デバイスを保存し、アプリ終了時に自動で戻すか。
- 異常終了時に残った Kataribe Multi-Output を次回起動時に検出して削除するか。
- 既存の手動 Multi-Output Device と Kataribe Multi-Output が併存した場合の優先順位。
- macOS 14.2 から 26.7.0 での Aggregate Device 作成の検証。
- ヘルパーの署名と公証を、配布ビルドでどう扱うか。
