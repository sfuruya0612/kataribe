# M0 system audio verification

ADR-0003 のシステム音声検証ハーネス。

MVP は BlackHole 2ch を入力デバイスとしてシステム音声を取得する。
desktopCapturer と ScreenCaptureKit の検証は、将来の選択肢を確認するための予備的なものである。

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
- ログ: `~/Library/Logs/Kataribe M0/m0.log`

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
4. マイクと BlackHole 2ch を同時に取得し、ミックス後のピークと RMS を測る
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
最初の 15 秒だけテスト音を鳴らし、残りは無音でフレームの欠落を確認する。
終了後は出力を元のデバイスに戻し、ミュート状態を復元し、Aggregate Device を削除する。

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

- BlackHole 2ch 0.7.1 を入力デバイスとして使う経路は成功した。
  - トラックは `readyState: "live"`
  - ピーク 0.14999
  - RMS 0.1061
  - 102,400 フレーム中 102,101 サンプルが非ゼロ
- スピーカーと BlackHole 2ch の Multi-Output Device 経由でも成功した。
  - ピーク 0.14999
  - RMS 0.1059
  - 102,400 フレーム中 102,227 サンプルが非ゼロ
- マイクと BlackHole 2ch の同時ミックスも成功した。
  - BlackHole: ピーク 0.14999、RMS 0.1061
  - マイク: ピーク 0.02294、RMS 0.00610
  - ミックス: ピーク 0.08600、RMS 0.05315
- 60 分の連続録音も成功した。
  - BlackHole、マイク、ミックスのフレーム数はすべて 73,728,000
  - BlackHole: ピーク 0.6359、RMS 0.07493
  - マイク: ピーク 1.0、RMS 0.004707
  - ミックス: ピーク 0.5958、RMS 0.03755
  - マイクのピークが 1.0 に達したため、クリッピング警告とゲイン調整が必要
- Zoom / Google Meet の実機でも、テスト音なしで 300 秒間の会議音声を取得できた。
  - BlackHole: ピーク 0.3022、RMS 0.07467、非ゼロ 5,261,830 / 6,144,000
  - マイク: ピーク 0.309
  - ミックス: ピーク 0.2506
  - BlackHole、マイク、ミックスのフレーム数はすべて 6,144,000
- 録音中に出力を Multi-Output Device からスピーカーへ切り替えると、BlackHole は無音のフレームを返し続けた。
  非ゼロのサンプル数は 132,246 で増えなくなり、マイクだけが継続した。
  直近のシステム音声レベルを監視する無音検出が必要である。
- 録音中にディスプレイスリープを 10 秒間発生させ、自動で復帰させた。
  90 秒間で BlackHole、マイク、ミックスのフレーム数はすべて 1,843,200 で、欠落はなかった。
  システムスリープは 19 秒発生し、復帰後は取得を再開したが、スリープ中の音声は途切れた。
  録音中は `powerSaveBlocker` でスリープを防ぐ必要がある。
- Bluetooth の AirPods 出力と BlackHole 2ch の Multi-Output でも成功した。
  - BlackHole: ピーク 0.4218、RMS 0.1011
  - マイク: ピーク 0.127
  - ミックス: ピーク 0.2105
  - 1,228,800 フレームすべてが非ゼロ
- AirPods の入力は HFP の 24 kHz、出力は A2DP の 48 kHz で別デバイスである。
  入力に AirPods を選ぶと HFP に切り替わり、出力の品質が下がる。
- スピーカー再生中は、マイクが同じ 440 Hz の音を拾った。
  ヘッドホンを使うか、エコーキャンセルを設定する必要がある。
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
