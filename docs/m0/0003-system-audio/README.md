# M0 system audio verification

ADR-0003 のシステム音声検証ハーネス。

MVP は BlackHole 2ch を入力デバイスとしてシステム音声を取得する。
desktopCapturer と ScreenCaptureKit の検証は、将来の選択肢を確認するための予備的なものである。
リリース前の回帰テストは [録音のリリース回帰テスト](../../testing/recording-regression.md) を使う。

## BlackHole 2ch での検証

### 前提

- macOS 14.2 以降
- 検証は macOS 26.7.1 で行った。Intel Mac は対象外とする
- BlackHole 2ch 0.7.1 がインストールされている
- macOS の音声出力が BlackHole 2ch、または BlackHole 2ch を含む Multi-Output Device になっている
- 音声出力の音量が 0 ではない

### 実行

```sh
cd docs/m0/0003-system-audio
./run-blackhole.sh
```

出力を自動で BlackHole 2ch に切り替え、終了後に元へ戻す場合:

```sh
KATARIBE_M0_SET_OUTPUT=1 ./run-blackhole.sh
```

初回は macOS のマイク権限ダイアログが出る。
`Electron` を許可する。
録音にはマイクではなく BlackHole 2ch を使うが、入力デバイスの列挙にマイク権限が必要である。

### 判定

- 成功: `blackhole_summary` が `"ok": true` で、`peak` が 0 より大きい
- 失敗: `"ok": false`、または `peak` が 0
- フレームの連続性: 起動直後の 1 秒を除き、`frames` と `expectedFrames` が一致し、`gaps` と `missedFrames` が 0 である
- ログ: `~/Library/Logs/Kataribe M0/m0.log`

### フレーム数の測定

`renderer.js` は AudioWorklet のフレームカウンタを使い、音声グラフに実際に届いたフレーム数を数える。
`AnalyserNode` の読み取り回数は使わない。

各測定の結果には、次の値が入る。

- `frames`: AudioWorklet に届いた実フレーム数
- `expectedFrames`: `currentFrame` の差から計算した期待フレーム数
- `gaps`: 前のブロックより大きな間隔が空いた回数
- `maxGapFrames`: 最大の欠落フレーム数
- `missedFrames`: `expectedFrames - frames`
- `nonZeroFrames`: 1 つ以上のチャンネルが非ゼロだったフレーム数
- `samples`: 全チャンネルのサンプル数
- `nonZero`: 非ゼロのサンプル数
- `channels`: 入力の最大チャンネル数
- `warmupFrames`: 除外した起動直後のフレーム数（既定 48,000）

ウォームアップ 1 秒を入れた 10 秒の予備測定では、BlackHole、マイク、ミックスの `frames` と `expectedFrames` が 431,616、`gaps` と `missedFrames` が 0 だった。
`warmupFrames` は 48,000 である。
この予備測定は、フレームカウンタの動作確認であり、長時間の連続性の保証ではない。

ウォームアップ 1 秒を入れる前の測定では、起動直後に 128〜256 フレームの gap が出た。
60 分テスト、ディスプレイスリープ、Zoom / Meet の 5 分テストで同じ種類の gap が出ていた。
ウォームアップ 1 秒を入れた 60 秒テストと 90 秒のディスプレイスリープテストでは、gaps と missedFrames が 0 だった。
128〜256 フレームの gap は、カウンタの起動時の数え落としだったと確認した。

### マイク権限とラベル取得

M0 ハーネスは `systemPreferences.askForMediaAccess` でマイク権限を要求し、`enumerateDevices` で入力デバイスのラベルを取得する。
`getUserMedia({audio: true})` で既定の入力を開くプローブは使わない。

2026-10-29 の確認では、マイク権限が許可済みの状態で `microphoneGranted: true` とラベルが取得できた。
初回の TCC ダイアログから許可する場合のラベル取得は未検証である。

### Multi-Output Device とマイクのミックス

スピーカーと BlackHole 2ch を含む一時的な Multi-Output Device を作り、マイクと BlackHole の同時ミックスを測る。

```sh
cd docs/m0/0003-system-audio
./run-mix.sh
```

`run-mix.sh` は次の処理を行う。

1. 現在の出力デバイスを保存する
2. スピーカーと BlackHole 2ch の Aggregate Device を作る
3. 440 Hz のテスト音を再生する
4. マイクと BlackHole 2ch を同時に取得し、実フレーム数、ピーク、RMS を測る
5. Aggregate Device を削除し、出力を元に戻す

`multi-output.swift` は Aggregate Device を作る補助 CLI である。

```sh
swiftc -O -parse-as-library -framework CoreAudio multi-output.swift -o multi-output
./multi-output list
./multi-output create "MacBook Proのスピーカー" "BlackHole 2ch"
./audio-device current
./multi-output destroy <audio-device current の defaultOutput の ID>
```

## 60 分連続テスト

```sh
cd docs/m0/0003-system-audio
./run-long.sh
```

`run-long.sh` は `caffeinate` でスリープを抑止し、3600 秒の連続取得を行う。
最初の 15 秒だけテスト音を鳴らし、残りは無音にする。
フレームの欠落は、`mix_summary` の `frames`、`expectedFrames`、`gaps`、`missedFrames` で確認する。
2026-10-29 に実フレーム数のカウンタへ更新し、60 分の再測定を実施した。
結果は上記の「2026-10-28 / 2026-10-29 の結果」に記載する。
終了後は出力を元のデバイスに戻し、ミュート状態を復元し、Aggregate Device を削除する。

## スリープの再測定

ディスプレイスリープとシステムスリープの再測定用のスクリプトがある。

```sh
cd docs/m0/0003-system-audio
./run-display-sleep.sh
./run-system-sleep.sh
```

`run-display-sleep.sh` は 90 秒の測定を開始し、10 秒後にディスプレイをスリープさせ、10 秒後に復帰させる。

`run-system-sleep.sh` は 20 秒後にシステムスリープする。
スリープしてから 20 秒ほどで、何かキーを押して起こす。
起床が遅れても、最大 15 分待って結果を回収する。

結果は `mix_summary` の `frames`、`expectedFrames`、`gaps`、`missedFrames` と、`main.js` が記録する `power_suspend`、`power_resume` で確認する。
システムスリープ中は `currentFrame` が止まるため、`gaps` が 0 でも音声は欠落している。
`power_suspend` と `power_resume` の時刻、`elapsedMs` と `elapsedAudioSeconds` の差を確認する。

## Bluetooth ヘッドホンでの検証

AirPods の出力と BlackHole 2ch で Multi-Output Device を作り、入力は内蔵マイクにする。

```sh
cd docs/m0/0003-system-audio
./audio-device set-input "MacBook Proのマイク"
KATARIBE_M0_OUTPUT_NAME="sPods" \
  KATARIBE_M0_MEASURE_MS=60000 \
  KATARIBE_M0_TONE_SECONDS=10 \
  ./run-mix.sh
./audio-device set-input "sPods"
```

AirPods の入力と出力は別デバイスで、入力は HFP の 24 kHz、出力は A2DP の 48 kHz になる。
入力に AirPods を選ぶと HFP に切り替わり、出力の品質が下がるため、入力は内蔵マイクか USB マイクにする。

## BlackHole 2ch のセットアップ

```sh
brew install --cask blackhole-2ch
```

インストール後に `coreaudiod` を再起動するか、Mac を再起動する。

音声出力と BlackHole 2ch を同時に使うには、Audio MIDI Setup で Multi-Output Device を作る。

1. Audio MIDI Setup を開く
2. 左下の `+` から `Create Multi-Output Device` を選ぶ
3. スピーカーまたはヘッドホンと BlackHole 2ch にチェックを入れる
4. macOS の音声出力でその Multi-Output Device を選ぶ

## 補助ツール

`audio-device` は、macOS の既定の出力デバイスを一覧、取得、変更する小さな CLI である。

```sh
swiftc -O -parse-as-library -framework CoreAudio audio-device.swift -o audio-device
./audio-device list
./audio-device current
./audio-device set-output "BlackHole 2ch"
./audio-device set-output "MacBook Proのスピーカー"
```

デバイス名は環境によって変わる。
`./audio-device list` で確認する。

## 2026-10-28 / 2026-10-29 の結果

MacBook Pro、macOS 26.7.1 (25G241)、arm64、Electron 45.1.0、Chrome 156.0.8078.49 で検証した。

以下の 2026-10-28/29 の結果のうち、60 分の連続録音、ディスプレイスリープ、システムスリープ、Zoom / Google Meet の 300 秒は 2026-10-29 に実フレーム数で再測定した。
それ以外の項目は旧カウンタの結果であり、実フレーム数では未再測定である。
旧カウンタの `frames` は、`renderer.js` の `measureMany` が 100 ms ごとに `AnalyserNode` から読んだ 2048 サンプルの累計である。
音声ストリームの実フレーム数ではない。

- BlackHole 2ch 0.7.1 を入力デバイスとして使う経路は成功した。
  - トラックは `readyState: "live"`
  - ピーク 0.14999
  - RMS 0.1061
  - 102,400 サンプル中 102,101 サンプルが非ゼロ
- スピーカーと BlackHole 2ch の Multi-Output Device 経由でも成功した。
  - ピーク 0.14999
  - RMS 0.1059
  - 102,400 サンプル中 102,227 サンプルが非ゼロ
- マイクと BlackHole 2ch の同時ミックスも成功した。
  - BlackHole: ピーク 0.14999、RMS 0.1061
  - マイク: ピーク 0.02294、RMS 0.00610
  - ミックス: ピーク 0.08600、RMS 0.05315
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
  - マイクのピークが 1.0 に達したため、クリッピング警告と入力ゲインの調整案内が必要である。
- 2026-10-29 に Zoom / Google Meet の実機で 300 秒の会議音声を再測定した。
  - テスト音は鳴らさず、実際の会議の音声だけを取得した。
  - BlackHole: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 0.236、RMS 0.03504、nonZeroFrames 111,610 / 112,422。
  - マイク: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 1.0、RMS 0.01866、nonZeroFrames 112,422 / 112,422。
  - ミックス: frames 14,390,016、expectedFrames 14,390,272、gaps 1、maxGapFrames 256、missedFrames 256、ピーク 0.58666、RMS 0.01985、nonZeroFrames 112,422 / 112,422。
  - 256 フレームの gap は、ディスプレイスリープを発生させていないこのテストでも出た。
    起動直後のカウンタの数え落としの可能性が高い。
  - ウォームアップ 1 秒を入れた 60 秒テストでは、BlackHole、マイク、ミックスが 2,831,104 / 2,831,104 フレーム、gaps 0、missedFrames 0 だった。
    256 フレームの gap は、起動時の数え落としだったと確認した。
  - マイクのピークが 1.0 に達しており、クリッピング警告と入力ゲインの調整案内が必要である。
- 録音中に出力を Multi-Output Device からスピーカーへ切り替えると、BlackHole は無音のサンプルを返し続けた。
  非ゼロのサンプル数は 132,246 で増えなくなり、マイクだけが継続した。
  直近のシステム音声レベルを監視する無音検出が必要である。
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
- Bluetooth の AirPods 出力と BlackHole 2ch の Multi-Output でも成功した。
  - BlackHole: ピーク 0.4218、RMS 0.1011
  - マイク: ピーク 0.127
  - ミックス: ピーク 0.2105
  - 1,228,800 サンプルすべてが非ゼロ
- AirPods の入力は HFP の 24 kHz、出力は A2DP の 48 kHz で別デバイスである。
  入力に AirPods を選ぶと HFP に切り替わり、出力の品質が下がる。
- スピーカー再生中は、マイクが同じ 440 Hz の音を拾った。
  ヘッドホンを使う。
  エコーキャンセルは会議アプリの音声には効かない場合がある。
- desktopCapturer は、署名なしの Electron では音声トラックが `ended` になり、サンプルが届かなかった。
- ScreenCaptureKit の CLI でも、署名なしではオーディオバッファが 0 だった。

詳細は `docs/adr/0003-system-audio-virtual-device.md` を参照する。

## desktopCapturer の予備検証

`run.sh` は desktopCapturer の経路を、Developer ID で署名した .app で検証するための古いハーネスである。
MVP では使わない。
Developer ID Application の証明書が Keychain にある場合だけ実行する。

```sh
./run.sh
```
