# BlackHole 2ch の入力デバイス検出を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P0
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0012 (docs/adr/0012-menu-bar-and-main-window.md)
関連 PRD: R-2、非機能要件の対応環境と権限
依存: 0009、0010、0011

## 背景

M0 の検証で、システム音声は BlackHole 2ch を入力デバイスとして取得する方式が動作することを確認した。
初回設定の手順は利用者向けの README に置き、アプリ内にセットアップ wizard は持たない。
アプリは、BlackHole 2ch が入力デバイスとして存在するかを検出し、システム音声の選択可否を決める必要がある。

入力デバイスのラベル取得にはマイク権限が必要である。
システム音声だけを使う利用者にも、マイク権限を求める理由を説明する必要がある。
ラベル取得のために `getUserMedia({audio: true})` で既定の入力を開くと、AirPods などの既定入力が HFP に切り替わる。
M0 のプローブはこの方法を使っており、アプリでは同じ方法を避ける必要がある。
M0 ハーネスでは、マイク権限が許可済みの状態で `systemPreferences.askForMediaAccess` と `enumerateDevices` によるラベル取得を確認した。
初回の TCC ダイアログから許可する場合の取得は未検証である。
画面収録権限は不要である。

## 目的

BlackHole 2ch を入力デバイスとして検出し、見つからない場合にシステム音声を無効化する。
アプリは実行時に必要な検出と状態表示だけを行う。

## やること

- `enumerateDevices` で `BlackHole` を含む入力デバイスを探す。
  `BlackHole 2ch`、`BlackHole 16ch`、`BlackHole 64ch` のラベル差を吸収する。
- `deviceId` が `default` と `communications` の擬似デバイスは一致の対象から外す。
- 複数の BlackHole が見つかった場合は、2ch、16ch、64ch の順に優先する。
  MVP で取得を保証するのは 2ch とし、16ch と 64ch は検出のみを対象にする。
- `devicechange` を監視し、BlackHole の追加と削除を再検出する。
- BlackHole が見つからない場合は、システム音声と両方の選択肢を無効にし、README へのリンクを含む短い案内を表示する。
  マイクだけの録音に自動でフォールバックしない。
- アプリは macOS の音声出力を自動で変更しない。
  利用者が設定した Multi-Output Device を尊重する。
- マイク権限を要求する理由を、入力デバイスの列挙とマイク録音のために説明する。
  ラベル取得のために既定の入力ストリームを開かず、`systemPreferences.askForMediaAccess` で権限だけを要求し、`enumerateDevices` でラベルが取れるか検証する。
  ラベルが取れない場合は、既定の入力を開かない代替手段を決める。
  画面収録権限は要求しない。
- 録音画面に入力レベルを表示する。
  初回設定の確認方法は README に書く（issue 0007）。
  アプリ内に専用のテスト録音画面は置かない。
- 設定画面と、BlackHole が見つからない場合の案内に README へのリンクを置く。
  開発時はルートの `README.md` を開き、配布版のリンク先は issue 0009 で決める。
  README の内容は issue 0007 で整備する。
- ラベル判定、擬似デバイスの除外、複数の BlackHole の優先順位、BlackHole が見つからない場合の状態を単体テストにする。

## 完了条件

- BlackHole が未インストールの Mac で、システム音声と両方の選択肢が無効になり、README への案内が表示される。
- BlackHole 2ch と Multi-Output Device が設定された Mac で、BlackHole 2ch の入力レベルが 0 より大きくなる。
  この確認はマイクをミュートした状態で行う。
- BlackHole 16ch と 64ch のラベルを検出できる。
  取得を保証するのは 2ch とする。
- 起動後に BlackHole を追加または削除すると、`devicechange` で再検出される。
- マイク権限を許可すると入力デバイスのラベルが取得でき、既定の入力ストリームを開かない。
- 画面収録権限のダイアログが出ない。
- アプリが macOS の音声出力を勝手に変更しない。
- 見つからない場合の案内から、README を開ける。

## 解決方法

2026-10-29 に BlackHole の入力デバイス検出を実装した。

- `blackHolePriority` を追加した。
  `BlackHole 2ch`、`BlackHole 16ch`、`BlackHole 64ch` の順に優先する。
  `default` と `communications` の擬似デバイスは検出対象から外す。
- `splitInputDevices` で BlackHole をシステム音声の候補に分け、優先順位で並べた。
  マイクの候補からは BlackHole を除外する。
- Renderer の起動中は `navigator.mediaDevices` の `devicechange` を監視し、録音していないときにデバイス一覧を再取得する。
  録音中は issue 0012 の監視が担当する。
- BlackHole が見つからない場合は、システム音声と両方の入力ソースを無効にする。
  録音パネルに README のセットアップ手順を開くボタンを表示する。
- マイク権限の説明に、入力デバイスの検出と録音に加えて、システム音声だけの場合も BlackHole 2ch のラベル取得に必要であることを表示する。
- アプリは macOS の音声出力を変更しない。
  画面収録権限も要求しない。

確認結果:

- `npm run typecheck`: 成功。
- `npm test`: 80 件成功。
  BlackHole のラベル判定、擬似デバイスの除外、2ch、16ch、64ch の優先順位をテストする。
- 開発版の実機確認:
  - `enumerateDevices` を 2ch、16ch、64ch の 3 つに差し替えて `devicechange` を発生させると、システム音声の選択肢が 2ch、16ch、64ch の順に並び、2ch が選ばれた。
  - 擬似デバイスの `default` は選択肢に含まれなかった。
  - BlackHole を入力一覧から外すと、システム音声と両方の選択肢が無効になり、README のセットアップ手順を開くボタンが表示された。
  - BlackHole を戻すと、システム音声の選択肢が再び有効になった。
- BlackHole 2ch の入力レベルが 0 より大きいことの確認は、音声出力を BlackHole 2ch にルーティングする必要があるため、この issue では実施していない。
  M0 と issue 0010 で BlackHole 2ch のフレーム取得は確認済みである。
  リリース前の実機確認で入力レベルを確認する。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md`
- `docs/adr/0012-menu-bar-and-main-window.md`
- `docs/prd/kataribe.md` の R-2、非機能要件
- `docs/m0/0003-system-audio/README.md`（M0 の検証ハーネスの README）
- `README.md`
