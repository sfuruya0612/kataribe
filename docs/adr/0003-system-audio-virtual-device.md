# ADR-0003: システム音声は BlackHole などの仮想オーディオデバイス経由で取得する

Created: 2026-10-28
Model: DeepSeek V4.1 Flash 1017
Status: Accepted

## 背景

Kataribe は Zoom や Google Meet の打ち合わせで、相手の声と自分の声を 1 本の mp3 に録る（PRD の U2）。
入力ソースはマイク、システム音声、その両方から選べる（PRD の R-2）。
当初は Electron の desktopCapturer と `getDisplayMedia` のループバックを第一候補にした。
macOS 14.2 以降では `NSAudioCaptureUsageDescription` と「システム音声録音」の権限が必要になる。

2026-10-28 の M0 予備検証では、署名なしの Electron 45.1.0 で音声トラックが `readyState: "ended"` になり、サンプルが 1 つも届かなかった。
ScreenCaptureKit の最小 CLI でもオーディオバッファは 0 だった。
署名なしでは TCC のシステム音声録音権限を付与できず、desktopCapturer と ScreenCaptureKit のどちらも利用できない。

BlackHole 2ch は、macOS に仮想オーディオデバイスを追加するオープンソースのドライバである。
システム音声を BlackHole 2ch に出力し、Kataribe は BlackHole 2ch を通常の入力デバイスとして `getUserMedia` で取得できる。
この経路は画面収録やシステム音声録音の TCC 権限を必要としない。
マイクと BlackHole 2ch の音声は、同じ `AudioContext` で混合できる（ADR-0002）。

## 決定

- MVP のシステム音声は、BlackHole 2ch などの仮想オーディオデバイスを入力デバイスとして取得する。
  `desktopCapturer` と `getDisplayMedia` は MVP では使わない。
- 利用者は BlackHole 2ch をインストールし、スピーカーまたはヘッドホンと BlackHole 2ch を含む Multi-Output Device を作成する。
  macOS の音声出力をその Multi-Output Device に設定する。
  Kataribe は macOS の音声出力を自動で変更しない。
- Kataribe は `enumerateDevices` で `BlackHole 2ch` を含む入力デバイスを探す。
  見つかった場合は、そのデバイスをシステム音声の入力として使う。
  見つからない場合は、システム音声の選択肢を無効にし、インストールと Multi-Output Device の作成手順を画面に出す。
- システム音声とマイクを同時に録るときは、両方の `MediaStream` を同じ `AudioContext` で混合する（ADR-0002）。
  BlackHole 2ch はステレオで取得されるため、混合後にモノラルへ変換する（ADR-0005）。
- MVP では、画面収録権限とシステム音声録音権限を要求しない。
  `Info.plist` には `NSMicrophoneUsageDescription` と `NSDocumentsFolderUsageDescription` を残す。
- desktopCapturer は、将来 Developer ID で署名したビルドと TCC のシステム音声録音権限が使える場合の選択肢として残す。
  MVP の決定には含めない。
- アプリは BlackHole 2ch を同梱しない。
  利用者が公式の配布元からインストールする。
  BlackHole は GPLv3 のソフトウェアであり、アプリは再配布しない。
- 設定画面にシステム音声のセットアップ手順を置き、BlackHole 2ch の検出、Multi-Output Device の作成、出力の選択、テスト録音を案内する。
- 録音中に BlackHole 2ch が見つからなくなった場合は、録音を継続せず、エラーとして停止する。
  マイクだけの録音に自動で切り替えない。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| desktopCapturer と `getDisplayMedia` のループバック | 署名なしの M0 では音声トラックが `ended` になり、サンプルが届かなかった。署名済みビルドと TCC 権限が必要で、MVP の前提にできない |
| ScreenCaptureKit の Swift ヘルパー | 署名なしの CLI ではオーディオバッファが 0 だった。署名と公証、TCC の設計が必要で、MVP の範囲を超える |
| BlackHole 2ch を入力デバイスとして使う | 採用する。画面収録権限が不要で、署名なしでも入力デバイスとして取得できることを M0 で確認した |
| Loopback や Soundflower などの他の仮想デバイス | Loopback は有料、Soundflower はメンテナンスが止まっている。BlackHole 2ch を第一候補にする |
| システム音声を録らない | U2 を満たせない。オンライン会議の相手の声が残らない |
| アプリが仮想オーディオドライバを同梱する | ドライバの署名、インストール、更新、ライセンスの管理が必要になり、MVP の範囲を超える |
| システム音声をアプリごとに分離する | macOS の音声出力を仮想デバイスにまとめる方法では、会議アプリだけを分離できない |

## 結果

- 2026-10-28 に BlackHole 2ch 0.7.1 を使った M0 を実施し、成功した。
  - macOS 26.7.1 (25G241)、arm64、Electron 45.1.0、Chrome 156.0.8078.49。
  - 検証はこの Mac の macOS 26.7.1 のみで行う。
    macOS 14.2 での検証は行わない。
  - Intel Mac は動作保証外とし、検証しない。
  - macOS の出力を BlackHole 2ch に設定し、60 秒の 440 Hz の音を再生した。
  - `getUserMedia` で BlackHole 2ch を入力として取得したところ、トラックは `readyState: "live"`、ピーク 0.14999、RMS 0.1061、102,400 フレーム中 102,101 サンプルが非ゼロだった。
  - テスト後に macOS の出力を MacBook Pro のスピーカーに戻した。
- Multi-Output Device の経路も確認した。
  - MacBook Pro のスピーカーと BlackHole 2ch を含む Aggregate Device を CoreAudio で作成し、macOS の出力に設定した。
  - BlackHole 2ch の入力は `readyState: "live"`、ピーク 0.14999、RMS 0.1059、102,400 フレーム中 102,227 サンプルが非ゼロだった。
  - テスト後に Aggregate Device を削除し、出力を MacBook Pro のスピーカーに戻した。
- マイクと BlackHole 2ch の同時ミックスも確認した。
  - BlackHole 2ch はピーク 0.14999、RMS 0.1061。
  - マイクはピーク 0.02294、RMS 0.00610。
  - ミックス後はピーク 0.08600、RMS 0.05315。
  - スピーカーから出た 440 Hz の音をマイクが拾っており、スピーカー再生では同じ音が二重に入ることを確認した。
- 60 分の連続録音も成功した。
  - 3600 秒間、BlackHole 2ch、マイク、ミックスのフレーム数はすべて 73,728,000 で、欠落はなかった。
  - BlackHole 2ch はピーク 0.6359、RMS 0.07493、非ゼロ 69,215,153 サンプル。
  - マイクはピーク 1.0、RMS 0.004707、非ゼロ 73,488,920 サンプル。
  - ミックスはピーク 0.5958、RMS 0.03755、非ゼロ 73,698,106 サンプル。
  - マイクのピークが 1.0 に達しており、クリッピングの警告とゲイン調整が必要である。
  - テスト後に入力と出力のミュート状態を元に戻し、Aggregate Device を削除した。
- Bluetooth ヘッドホンの経路も確認した。
  - AirPods の出力 `sPods` は 48 kHz の A2DP、入力 `sPods` は 24 kHz の HFP で、別のデバイスとして見える。
  - 入力に MacBook Pro のマイクを選び、AirPods の出力と BlackHole 2ch の Multi-Output Device を作って 60 秒測定した。
  - BlackHole 2ch はピーク 0.4218、RMS 0.1011、1,228,800 フレームすべてが非ゼロだった。
  - マイクはピーク 0.127、ミックスはピーク 0.2105 だった。
  - テスト後に出力を AirPods に戻し、Aggregate Device を削除した。
- Zoom / Google Meet の実機テストも成功した（2026-10-29）。
  - テスト音を鳴らさず、実際の会議の音声だけを 300 秒間取得した。
  - BlackHole 2ch はピーク 0.3022、RMS 0.07467、非ゼロ 5,261,830 / 6,144,000 サンプル。
  - マイクはピーク 0.309、ミックスはピーク 0.2506。
  - BlackHole、マイク、ミックスのフレーム数はすべて 6,144,000 で、欠落はなかった。
  - テスト後に出力をスピーカーへ戻し、Aggregate Device を削除した。
- AirPods の入力を使うと HFP に切り替わり、出力の品質が下がる可能性がある。
  システム音声を録るときは、入力に AirPods を選ばず、内蔵マイクか USB マイクを使うよう案内する。
- 録音中に出力デバイスを Multi-Output Device からスピーカーへ切り替えるテストも行った。
  - BlackHole のフレームは届き続けたが、非ゼロのサンプル数は 132,246 で増えなくなり、無音になった。
  - マイクは最後まで非ゼロのサンプルが増え続けた。
  - 現在の判定はピークが一度でも出れば成功になるため、出力が外れたことを検知できない。
  - 直近のシステム音声レベルを監視し、一定時間無音が続いたら警告する必要がある。
- 録音中にディスプレイスリープを発生させ、10 秒後に自動で復帰させるテストも行った。
  - 90 秒間で BlackHole、マイク、ミックスのフレーム数はすべて 1,843,200 で、欠落はなかった。
- 録音中にシステムスリープを発生させ、19 秒後に復帰するテストも行った。
  - 11:53:56 に Software Sleep に入り、11:54:15 に Wake した。
  - 復帰後も BlackHole、マイク、ミックスのフレームは 3,684,352 で、180 秒の期待値 3,686,400 との差は 2,048 だった。
  - キャプチャは復帰後に再開したが、スリープ中の約 19 秒は音声が途切れる。
  - 録音中は `powerSaveBlocker` でシステムスリープを防ぐ必要がある。
- desktopCapturer と ScreenCaptureKit は、署名なしでは音声を取得できなかった。
  この結果は、TCC のシステム音声録音権限と Info.plist の権限が原因である可能性が高い。
  署名済みビルドでの再試験は、MVP の前提から外す。
- 利用者に BlackHole 2ch のインストールと Multi-Output Device の作成を求めるため、初回設定の負担が増える。
  設定画面のチェックリストとテスト録音で、つまずきを減らす必要がある。
- 画面収録権限が不要になり、プライバシーと配布の手間は小さくなる。
  音声は仮想デバイスの中だけを通り、ネットワークには出ない。
- BlackHole 2ch はシステム全体の音声を取得する。
  会議アプリの音声だけを分離するものではないため、通知音や他のアプリの音も録音に入る。
- Multi-Output Device を作らないと、BlackHole 2ch に出力した音を利用者が聞けない。
  スピーカーとヘッドホンのどちらを使う場合も、Multi-Output Device の設定が必要になる。
- スピーカーで再生しながら録音すると、マイクが同じ音を拾って二重に録音される。
  録音開始時にヘッドホンの使用を案内するか、エコーキャンセルを設定する必要がある。
- BlackHole 2ch のドライバは macOS のアップデートで再インストールが必要になる場合がある。
  起動時にデバイスの有無を確認し、見つからない場合は設定手順を出す。
- 入力デバイスのラベルは macOS の言語設定で変わる可能性がある。
  検出はラベルの完全一致ではなく、`BlackHole` を含むかどうかで行う。
- アプリは署名なしでも BlackHole 2ch を入力として取得できるが、配布には署名と公証が必要である（ADR-0014）。

## 未決事項

- BlackHole 2ch の M0 を、他の macOS バージョンでも行うか。
- Electron 45.1.0 以外の版でも、BlackHole 2ch の入力を再試験するか。
- Multi-Output Device の作成を、利用者の手動設定にするか、アプリから CoreAudio の Aggregate Device として作成するか。
- BlackHole 2ch の対応バージョンと、macOS のアップデート後の再インストール手順。
- BlackHole 2ch 以外の仮想オーディオデバイスを、どの程度サポートするか。
- 初回設定のチェックリストとテスト録音の内容。
- BlackHole 2ch が見つからない場合に、マイクだけの録音を許可するか。
- 録音中に出力デバイスや入力デバイスが変更された場合の挙動と、システム音声の無音検出の閾値。
- システムスリープ中の欠落を防ぐ `powerSaveBlocker` の実装と、復帰後の再接続の確認。
- スピーカーとヘッドホンを切り替えたときの Multi-Output Device の再設定。
- Bluetooth ヘッドホンで入力と出力を分け、HFP に切り替わらないようにする案内と設定。
- desktopCapturer を将来の選択肢として復活させる条件。
- BlackHole 2ch の GPLv3 と、アプリの配布物での表記。
