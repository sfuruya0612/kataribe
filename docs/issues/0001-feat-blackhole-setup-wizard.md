# BlackHole 2ch のセットアップ wizard と入力デバイス検出を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P0
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)
関連 PRD: R-2、F-2、非機能要件の対応環境と権限
依存: なし

## 背景

M0 の検証で、システム音声は BlackHole 2ch を入力デバイスとして取得する方式が動作することを確認した。
一方で、利用者には BlackHole 2ch のインストール、Multi-Output Device の作成、macOS の出力設定が必要になる。
現在は手順が `docs/m0/0003-system-audio/README.md` にしかなく、アプリ内の導線がない。

入力デバイスのラベル取得にはマイク権限が必要である。
システム音声だけを使う利用者にも、マイク権限を求める理由を説明する必要がある。
AirPods の入力を使うと HFP に切り替わり、出力品質が下がる問題もある。
画面収録権限は不要である。

## 目的

初回起動時と設定画面で、BlackHole 2ch のセットアップを案内し、入力デバイスを検出できるようにする。
セットアップ後は、テスト音でシステム音声が BlackHole 2ch に届いていることを確認できるようにする。

## やること

- `enumerateDevices` で `BlackHole` を含む入力デバイスを探す。
  `BlackHole 2ch`、`BlackHole 16ch`、`BlackHole 64ch` のラベル差を吸収する。
- BlackHole が見つからない場合は、システム音声の選択肢を無効にし、インストール手順を表示する。
  マイクだけの録音に自動でフォールバックしない。
- セットアップ wizard を作り、次の順で案内する。
  1. BlackHole 2ch の公式配布元とインストール手順
  2. Audio MIDI Setup でスピーカーまたはヘッドホンと BlackHole 2ch の Multi-Output Device を作る手順
  3. macOS の音声出力を Multi-Output Device にする手順
  4. BlackHole 2ch を Kataribe の入力に選ぶ手順
  5. テスト音を再生し、BlackHole 2ch の入力レベルが 0 より大きいことを確認する手順
- アプリは macOS の音声出力を自動で変更しない。
  利用者が設定した Multi-Output Device を尊重する。
- 設定画面に、BlackHole 2ch の検出状態、入力レベル、テスト録音の結果を表示する。
- マイク権限を要求する理由を、入力デバイスの列挙とマイク録音のために説明する。
  画面収録権限は要求しない。
- AirPods などの Bluetooth 入力が選ばれた場合は、HFP に切り替わり出力品質が下がる旨を警告する。
  入力には内蔵マイクまたは USB マイクを推奨する。
- 検出とセットアップの状態をテストできるように、ラベル判定と不足時の状態を単体テストにする。

## 完了条件

- BlackHole が未インストールの Mac で、システム音声が無効になり、セットアップ手順が表示される。
- BlackHole 2ch と Multi-Output Device が設定された Mac で、テスト音の入力レベルが 0 より大きくなる。
- BlackHole 16ch と 64ch のラベルでも検出できる。
- 画面収録権限のダイアログが出ない。
- AirPods を入力に選んだ場合に、HFP の警告が出る。
- アプリが macOS の音声出力を勝手に変更しない。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/prd/kataribe.md` の R-2、F-2、非機能要件
- `docs/m0/0003-system-audio/README.md`
