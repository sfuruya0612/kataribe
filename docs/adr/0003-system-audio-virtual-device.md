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
- Kataribe は `enumerateDevices` で `BlackHole` を含む入力デバイスを探す。
  見つかった場合は、そのデバイスをシステム音声の入力として使う。
  見つからない場合は、システム音声と両方の選択肢を無効にし、README のセットアップ手順を案内する。
- システム音声とマイクを同時に録るときは、両方の `MediaStream` を同じ `AudioContext` で混合する（ADR-0002）。
  BlackHole 2ch はステレオで取得されるため、混合後にモノラルへ変換する（ADR-0005）。
- MVP では、画面収録権限とシステム音声録音権限を要求しない。
  `Info.plist` には `NSMicrophoneUsageDescription` と `NSDocumentsFolderUsageDescription` を残す。
- desktopCapturer は、将来 Developer ID で署名したビルドと TCC のシステム音声録音権限が使える場合の選択肢として残す。
  MVP の決定には含めない。
- アプリは BlackHole 2ch を同梱しない。
  利用者が公式の配布元からインストールする。
  BlackHole は GPLv3 のソフトウェアであり、アプリは再配布しない。
- 利用者向けの README にシステム音声のセットアップ手順を置き、BlackHole 2ch のインストール、Multi-Output Device の作成、出力の選択、短いテスト録音を案内する。
  アプリ内にセットアップ wizard は置かない。
- M0 で確認した範囲では、Bluetooth 出力は Multi-Output Device に含めて使える。
  AirPods では、Bluetooth 出力は A2DP の 48 kHz ステレオ、Bluetooth 入力は HFP の 24 kHz モノラルになる。
  これは M0 で確認した値であり、AirPods の機種とファームウェアは記録していない。
  他の Bluetooth ヘッドホンでは値が異なる場合がある。
  Bluetooth ヘッドホンのマイクを入力に使うと、macOS は HFP に切り替え、出力も HFP に切り替わり品質が下がる。
  HFP の出力品質の低下は、M0 では聴感で確認していない。
  一般に HFP は A2DP より帯域が狭い。
  Bluetooth ヘッドホンを入力と出力の両方に使わない。
- HFP は、Kataribe のマイクだけでなく、macOS の既定入力や会議アプリのマイクが AirPods を開いた場合にも起きる。
- Bluetooth 出力を使い、システム音声とマイクを同時に録る場合の推奨構成は、次のとおりとする。
  - 出力: AirPods などの Bluetooth ヘッドホン（A2DP）
  - 入力: 内蔵マイクまたは USB マイク
  - macOS の既定入力: 内蔵マイクまたは USB マイク
  - 会議アプリのマイク: 内蔵マイクまたは USB マイク
  - Kataribe のマイク入力: 内蔵マイクまたは USB マイク
  Multi-Output Device と Kataribe のシステム音声入力は、前述のとおり Bluetooth 出力と BlackHole 2ch にする。
- Electron の `enumerateDevices` は transport type を返さず、ラベル判定では他の Bluetooth 機器を拾えないことがあるため、MVP では Bluetooth 入力を自動検出しない。
- 録音中に BlackHole 2ch が見つからなくなった場合は、録音を継続せず、エラーとして停止する。
  マイクだけの録音に自動で切り替えない。
  マイクの消失時の扱いは issue 0012 に従う。

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

M0 のログの `frames` は、`docs/m0/0003-system-audio/renderer.js` の `measureMany` が 100 ms ごとに `AnalyserNode` から読んだ 2048 サンプルの累計である。
音声ストリームの実フレーム数ではない。
48 kHz では 100 ms に 4,800 サンプルあるため、半分以上を読んでいない。
M0 の記録にある「フレーム数」は、この読み取り回数を指す。
録音の継続性は、AudioWorklet の実フレーム数と `AudioContext.currentTime` で再測定する。

2026-10-29 に、M0 ハーネスを AudioWorklet のフレームカウンタに更新した。
10 秒の予備測定では、BlackHole、マイク、ミックスの `frames` と `expectedFrames` が 479,744、`gaps` と `missedFrames` が 0 だった。
60 分の再測定を実施した。

ウォームアップ 1 秒を入れる前の測定では、起動直後に 128〜256 フレームの gap が出た。
60 分テスト、ディスプレイスリープ、Zoom / Meet の 5 分テストで同じ種類の gap が出ていた。
ウォームアップ 1 秒を入れた 60 秒テストと 90 秒のディスプレイスリープテストでは、gaps と missedFrames が 0 だった。
128〜256 フレームの gap は、カウンタの起動時の数え落としだったと確認した。

- 2026-10-28 に BlackHole 2ch 0.7.1 を使った M0 を実施し、成功した。
  - macOS 26.7.1 (25G241)、arm64、Electron 45.1.0、Chrome 156.0.8078.49。
  - 検証はこの Mac の macOS 26.7.1 のみで行う。
    macOS 14.2 での検証は行わない。
  - MVP の対応環境は macOS 14.2 以降を目標とするが、検証済みは macOS 26.7.1 のみとする。
    macOS 14.2 から 26.7.0 はベストエフォートとし、動作を保証しない。
  - Intel Mac は動作保証外とし、検証しない。
  - macOS の出力を BlackHole 2ch に設定し、60 秒の 440 Hz の音を再生した。
  - `getUserMedia` で BlackHole 2ch を入力として取得したところ、トラックは `readyState: "live"`、ピーク 0.14999、RMS 0.1061、102,400 サンプル中 102,101 サンプルが非ゼロだった。
  - テスト後に macOS の出力を MacBook Pro のスピーカーに戻した。
- Multi-Output Device の経路も確認した。
  - MacBook Pro のスピーカーと BlackHole 2ch を含む Aggregate Device を CoreAudio で作成し、macOS の出力に設定した。
  - BlackHole 2ch の入力は `readyState: "live"`、ピーク 0.14999、RMS 0.1059、102,400 サンプル中 102,227 サンプルが非ゼロだった。
  - テスト後に Aggregate Device を削除し、出力を MacBook Pro のスピーカーに戻した。
- マイクと BlackHole 2ch の同時ミックスも確認した。
  - BlackHole 2ch はピーク 0.14999、RMS 0.1061。
  - マイクはピーク 0.02294、RMS 0.00610。
  - ミックス後はピーク 0.08600、RMS 0.05315。
  - スピーカーから出た 440 Hz の音をマイクが拾っており、スピーカー再生では同じ音が二重に入ることを確認した。
- 2026-10-29 に、実フレーム数で 60 分の連続録音を再測定した。
  - macOS 26.7.1、arm64、Electron 45.1.0、BlackHole 2ch 0.7.1、FIFINE K670、MacBook Pro のスピーカー + BlackHole 2ch の Multi-Output Device。
  - 測定時間は 3599.58 秒で、3600 秒との差は 0.42 秒だった。
  - BlackHole: frames 172,779,648、expectedFrames 172,779,776、gaps 1、maxGapFrames 128、missedFrames 128、ピーク 0.34243、RMS 0.05686、nonZeroFrames 1,338,621 / 1,349,841。
  - マイク: frames 172,779,520、expectedFrames 172,779,520、gaps 0、missedFrames 0、ピーク 1.0、RMS 0.00503、nonZeroFrames 1,349,840 / 1,349,840。
  - ミックス: frames 172,779,520、expectedFrames 172,779,520、gaps 0、missedFrames 0、ピーク 0.53483、RMS 0.02854、nonZeroFrames 1,349,840 / 1,349,840。
  - BlackHole のカウンタで 128 フレーム（2.67 ms）の gap が 1 回検出された。
    BlackHole のカウンタは frame 0 から始まり、ミックスは frame 256 から始まっている。
    ミックス側は gap 0 だったため、音声グラフ全体の欠落ではなく、BlackHole カウンタが起動時に 1 ブロックを数え落とした可能性がある。
    ウォームアップ 1 秒を入れた 60 秒テストでは gaps 0 だったため、起動時の数え落としと確認した。
    60 分の長時間テストをウォームアップ付きで再試験するかは issue 0006 で決める。
  - BlackHole の非ゼロフレームは 99.17% で、15 秒のテスト音の後も非ゼロが続いた。
    背景音または DC オフセットの可能性がある。
    無音判定は非ゼロ率ではなく RMS で行う。
  - マイクのピークが 1.0 に達しており、クリッピングの警告と、入力ゲインの調整案内が必要である。
  - テスト後に出力を元の DELL U3821DW に戻し、Aggregate Device を削除した。
- Bluetooth ヘッドホンの経路も確認した。
  - AirPods の出力 `sPods` は 48 kHz の A2DP、入力 `sPods` は 24 kHz の HFP で、別のデバイスとして見える。
  - 入力に MacBook Pro のマイクを選び、AirPods の出力と BlackHole 2ch の Multi-Output Device を作って 60 秒測定した。
  - BlackHole 2ch はピーク 0.4218、RMS 0.1011、1,228,800 サンプルすべてが非ゼロだった。
  - マイクはピーク 0.127、ミックスはピーク 0.2105 だった。
  - テスト後に出力を AirPods に戻し、Aggregate Device を削除した。
- 2026-10-29 に Zoom / Google Meet の実機で 300 秒の会議音声を再測定した。
  - テスト音を鳴らさず、実際の会議の音声だけを取得した。
  - BlackHole: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 0.236、RMS 0.03504、nonZeroFrames 111,610 / 112,422。
  - マイク: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 1.0、RMS 0.01866、nonZeroFrames 112,422 / 112,422。
  - ミックス: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 0.58666、RMS 0.01985、nonZeroFrames 112,422 / 112,422。
  - 256 フレームの gap は、ディスプレイスリープを発生させていないこのテストでも出た。
    起動直後のカウンタの数え落としの可能性が高い。
  - ウォームアップ 1 秒を入れた 60 秒テストでは、BlackHole、マイク、ミックスが 2,831,104 / 2,831,104 フレーム、gaps 0、missedFrames 0 だった。
    256 フレームの gap は、起動時の数え落としだったと確認した。
  - マイクのピークが 1.0 に達しており、クリッピングの警告と入力ゲインの調整案内が必要である。
  - テスト後に出力を元の DELL U3821DW に戻し、Aggregate Device を削除した。
- AirPods の入力を使うと HFP に切り替わり、出力の品質が下がる。
- 録音中に出力デバイスを Multi-Output Device からスピーカーへ切り替えるテストも行った。
  - BlackHole の読み取りは続いたが、非ゼロのサンプル数は 132,246 で増えなくなり、無音になった。
  - マイクは最後まで非ゼロのサンプルが増え続けた。
  - 現在の判定はピークが一度でも出れば成功になるため、出力が外れたことを検知できない。
  - 直近のシステム音声レベルを監視し、一定時間無音が続いたら警告する必要がある。
- 2026-10-29 に、ウォームアップ 1 秒を入れてディスプレイスリープを再測定した。
  - 90 秒の測定で、BlackHole、マイク、ミックスの frames は 4,271,616、expectedFrames は 4,271,616、gaps は 0、missedFrames は 0 だった。
  - 音声時間は 88.992 秒で、90 秒との差はウォームアップ 1 秒を含む。
  - ディスプレイスリープと復帰の間にも、フレームの gap は出なかった。
  - ウォームアップなしの旧測定の 256 フレームの gap は、起動時のカウンタの数え落としだった。
- 2026-10-29 にシステムスリープを再測定した。
  - 120 秒の測定中に、`power_suspend` 06:13:45.518、`power_resume` 06:15:06.912 のシステムスリープが発生した。
  - スリープ時間は 81.394 秒である。
  - AudioWorklet の frames と expectedFrames は 5,411,072 で一致し、gaps と missedFrames は 0 だった。
  - これは音声グラフの currentFrame がスリープ中に停止し、再開後に連続して見えるためである。
  - レンダラーの elapsedMs 120,001 と elapsedAudioSeconds 112.731 の差は 7.27 秒で、スリープによる欠落の一部を示す。
  - スリープ時間の全体は power_suspend と power_resume で記録する。
  - 録音中は `powerSaveBlocker` でシステムスリープを防ぐ必要がある。
- desktopCapturer と ScreenCaptureKit は、署名なしでは音声を取得できなかった。
  この結果は、TCC のシステム音声録音権限と Info.plist の権限が原因である可能性が高い。
  署名済みビルドでの再試験は、MVP の前提から外す。
- 利用者に BlackHole 2ch のインストールと Multi-Output Device の作成を求めるため、初回設定の負担が増える。
  README のチェックリストとトラブルシュートで、つまずきを減らす必要がある。
- 画面収録権限が不要になり、プライバシーと配布の手間は小さくなる。
  音声は仮想デバイスの中だけを通り、ネットワークには出ない。
- BlackHole 2ch はシステム全体の音声を取得する。
  会議アプリの音声だけを分離するものではないため、通知音や他のアプリの音も録音に入る。
- Multi-Output Device を作らないと、BlackHole 2ch に出力した音を利用者が聞けない。
  スピーカーとヘッドホンのどちらを使う場合も、Multi-Output Device の設定が必要になる。
- スピーカーで再生しながら録音すると、マイクが同じ音を拾って二重に録音される。
  録音開始時にヘッドホンの使用を案内する。
  エコーキャンセルは会議アプリの音声には効かない場合があるため、MVP の対策に含めない。
- BlackHole 2ch のドライバは macOS のアップデートで再インストールが必要になる場合がある。
  起動時にデバイスの有無を確認し、見つからない場合は README の設定手順を案内する。
- 入力デバイスのラベルは macOS の言語設定で変わる可能性がある。
  検出はラベルの完全一致ではなく、`BlackHole` を含むかどうかで行う。
- アプリは署名なしでも BlackHole 2ch を入力として取得できるが、配布には署名と公証が必要である（ADR-0014）。

## 未決事項

- システムスリープ時の欠落を `powerSaveBlocker` で防ぎ、復帰後の再接続を確認する（issue 0003）。
- HFP に切り替えた状態で、Multi-Output Device と BlackHole 2ch の取得が続くかを検証する（issue 0006）。
- AirPods の機種とファームウェアを記録して再試験する。
- macOS 14.2 から 26.7.0 のベストエフォート範囲を、どこまで検証するか。
- Electron 45.1.0 以外の版でも、BlackHole 2ch の入力を再試験するか。
- MVP 後の Multi-Output Device の作成を、手動設定のままにするか、アプリから CoreAudio の Aggregate Device として自動作成するか（issue 0008）。
- BlackHole 2ch の対応バージョンと、macOS のアップデート後の再インストール手順。
- BlackHole 2ch 以外の仮想オーディオデバイスを、どの程度サポートするか。
- README の初回設定手順、短いテスト録音、トラブルシュートの内容。
- BlackHole 2ch が見つからない場合に、録音開始前にマイクだけを明示的に選べるようにするか。
- システム音声の無音検出の既定値（ウィンドウ長、閾値、猶予時間）。
- desktopCapturer を将来の選択肢として復活させる条件。
- BlackHole 2ch の GPLv3 と、アプリの配布物での表記。
