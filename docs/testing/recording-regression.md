# 録音のリリース回帰テスト

Kataribe の録音経路をリリース前に確認するための手順です。
自動で確認できる項目と、実機と外部サービスが必要な手動項目に分けます。

## 対象と役割

- `docs/m0/0003-system-audio/` のハーネスは、BlackHole 2ch と Multi-Output Device の環境確認に残す。
- 製品の録音経路の回帰は、Kataribe のアプリで確認する。
  M0 ハーネスの `AnalyserNode` の読み取り回数をフレーム数として扱わない。
- 数値の合否は、AudioWorklet の `process()` で数えた実フレーム数、`expectedFrames`、`gaps`、`missedFrames` を使う。
- 長時間テストの前に 1 秒のウォームアップを置く。
  起動直後の 128 から 256 フレームの gap はカウンタの起動時の数え落としであり、ウォームアップ後の gap 0 を合格とする。

## 自動テスト

次のコマンドをリポジトリのルートで実行します。

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run test:window
npm run package
npm run verify:mac
```

合格条件:

- `npm run typecheck` が成功する。
- `npm test` が全件成功する。
- `npm run smoke` が `KATARIBE_SMOKE_TEST_OK` を出す。
- `npm run test:window` が `KATARIBE_WINDOW_TEST_OK` を出す。
- `npm run verify:mac` がすべてのローカル検査に成功する。
- 署名済みビルドでは `npm run verify:mac:release` が成功する。

M0 ハーネスの環境確認:

```sh
cd docs/m0/0003-system-audio
./run-blackhole.sh
./run-mix.sh
./run-long.sh
```

`run-blackhole.sh` は BlackHole 2ch の直接入力、`run-mix.sh` はマイクとのミックス、`run-long.sh` は長時間のフレーム連続性を確認する。
実行結果は `docs/testing/results/` に保存する。

## 手動テストの前提

| 項目 | 必要なもの |
| --- | --- |
| macOS | 14.2 以降。検証基準は 26.7.1 |
| アーキテクチャ | Apple Silicon |
| BlackHole | BlackHole 2ch 0.7.1 |
| マイク | 内蔵マイクと USB マイク |
| 出力 | スピーカーまたはヘッドホン、Bluetooth ヘッドホン |
| 会議 | Zoom と Google Meet のテスト会議 |
| 別デバイス | Zoom と Meet の相手役になる端末 |

## 数値の合格基準

| 項目 | 合格基準 |
| --- | --- |
| 実フレーム数 | ウォームアップ後の `gaps` が 0、`missedFrames` が 0 |
| 60 分の連続性 | 実フレーム数と `AudioContext.currentTime` の差が 1 秒以内 |
| 300 秒の Zoom と Meet | 300 秒に対して `gaps` が 0、`missedFrames` が 0 |
| ディスプレイスリープ 90 秒 | 復帰後に `gaps` が 0、`missedFrames` が 0 |
| システムスリープ | `meta.json` に suspend と resume の時刻が残り、復帰後に録音が続く |
| BlackHole の入力 | 音声再生中の RMS が 0 より大きく、非ゼロのフレームが 95% 以上 |
| マイクのピーク | 通常の会議では 1.0 に達しない。達した場合はクリッピング警告が出る |
| 無音警告 | 出力を外して猶予時間と監視ウィンドウが過ぎた後に警告が出る |
| 無音復旧 | 出力を戻すと警告が消え、録音が続く |

M0 の実測値は、BlackHole の Zoom と Meet 300 秒で RMS 0.03504、60 分で RMS 0.05686 だった。
無音検出の既定値は、この値を下回る 0.003 を使う。

## 手動テスト

### 1. BlackHole 2ch の直接入力

1. macOS の音声出力を BlackHole 2ch にする。
2. Kataribe の入力ソースをシステム音声にし、システム音声に BlackHole 2ch を選ぶ。
3. テスト音または会議音声を再生する。
4. 録音を開始し、入力レベルが 0 より大きいことを確認する。
5. 10 秒以上録音し、停止する。
6. `meta.json` の `actual_samples` と `chunks`、`audio.wav` の長さを確認する。

合格条件:

- BlackHole 2ch の入力レベルが 0 より大きい。
- `gaps` が 0、`missedFrames` が 0。
- `audio.wav` が 1 チャンネル、48 kHz、16-bit で再生できる。

### 2. Multi-Output Device 経由の入力

1. README の手順でスピーカーまたはヘッドホンと BlackHole 2ch の Multi-Output Device を作る。
2. macOS の音声出力を Multi-Output Device にする。
3. テスト音を再生し、スピーカーまたはヘッドホンから聞こえることを確認する。
4. Kataribe でシステム音声を録音する。
5. 入力レベルと `audio.wav` を確認する。

合格条件:

- スピーカーまたはヘッドホンから音が聞こえる。
- Kataribe の BlackHole 入力レベルが 0 より大きい。
- Kataribe が macOS の音声出力を変更しない。

### 3. マイクと BlackHole のミックス

1. 入力ソースを両方にする。
2. マイクと BlackHole 2ch を選ぶ。
3. マイクに向かって話し、同時にテスト音を再生する。
4. 録音を開始し、ピークと RMS を確認する。
5. 60 秒以上録音して停止する。

合格条件:

- マイクとシステム音声の両方が `audio.wav` に含まれる。
- `gaps` が 0、`missedFrames` が 0。
- 入力レベルが 0 dB に張り付かない。張り付く場合はクリッピング警告が出る。

### 4. 60 分の連続録音

1. 入力ソースを両方またはシステム音声にする。
2. 60 分の会議音声またはテスト音を再生する。
3. 録音を開始し、60 分待つ。
4. 停止し、`meta.json` と `audio.wav` を確認する。

合格条件:

- 音声時間が 3600 秒に近い。
- 実フレーム数と `AudioContext.currentTime` の差が 1 秒以内。
- ウォームアップ後の `gaps` が 0、`missedFrames` が 0。
- 10 秒ごとのチャンクが約 360 個ある。
- 停止後に一時ディレクトリが削除されている。

### 5. Bluetooth 出力とマイク

1. AirPods などの Bluetooth ヘッドホンを接続する。
2. Bluetooth 出力と BlackHole 2ch の Multi-Output Device を作る。
3. macOS の音声出力を Multi-Output Device にする。
4. macOS の既定入力、Zoom または Meet のマイク、Kataribe のマイクを内蔵マイクまたは USB マイクにする。
5. 両方の入力で録音する。
6. `audio.wav` と `meta.json` を確認する。

合格条件:

- Bluetooth 出力が A2DP のまま維持される。
- 入力が HFP に切り替わらない。
- `gaps` が 0、`missedFrames` が 0。
- Bluetooth 出力の遅延が録音の欠落にならない。

### 6. Bluetooth 入力の HFP

1. AirPods を macOS の入力に選ぶ。
2. Kataribe のマイクに AirPods を選ぶ。
3. 録音を開始し、入力レベルと音質を確認する。
4. 録音を停止する。

合格条件:

- HFP に切り替わることを確認できる。
- アプリがクラッシュしない。
- HFP を推奨構成として表示しない。
- 画面収録権限のダイアログが出ない。

### 7. 出力デバイスの変更

1. Multi-Output Device を macOS の出力にして、システム音声または両方で録音を開始する。
2. 録音中に macOS の出力をスピーカーまたはヘッドホンへ変更する。
3. 無音検出の猶予時間と監視ウィンドウが過ぎるまで待つ。
4. 警告が出ることを確認する。
5. macOS の出力を Multi-Output Device に戻す。
6. 警告が消えて録音が続くことを確認する。

合格条件:

- 出力を外すと無音警告が出る。
- 録音は停止しない。
- 入力ソースが自動でマイクだけに切り替わらない。
- 出力を戻すと警告が消える。
- `meta.json` に無音の発生と復旧が残る。

### 8. ディスプレイスリープ

1. 録音を開始する。
2. `docs/m0/0003-system-audio/run-display-sleep.sh` を実行する。
3. 90 秒待つ。
4. 復帰後に録音を停止する。

合格条件:

- 復帰後に録音が続いている。
- ウォームアップ後の `gaps` が 0、`missedFrames` が 0。
- `meta.json` とログにディスプレイスリープの時刻が残る。

### 9. システムスリープ

1. 録音を開始する。
2. `docs/m0/0003-system-audio/run-system-sleep.sh` を実行する。
3. 復帰後に録音を停止する。

合格条件:

- `meta.json` に suspend と resume の時刻が残る。
- 復帰後に録音が続く。
- 欠落区間が無音で埋められ、文字起こしのタイムスタンプが実時間と一致する。
- 録音終了後に欠落区間の警告が出る。
- 復帰後に BlackHole が見つからない場合は、録音が停止する。

Kataribe は録音中の suspend と resume を `meta.json` に記録し、復帰後の欠落区間を無音で補う。
復帰後に BlackHole 2ch が見つからない場合は、デバイス消失として録音を停止する。

### 10. Zoom と Google Meet

1. 別デバイスで Zoom と Google Meet のテスト会議を開始する。
2. 300 秒の会議音声を再生し、マイクからも話す。
3. Kataribe で両方の入力を録音する。
4. 停止し、`audio.wav`、`meta.json`、文字起こしのタイムスタンプを確認する。

合格条件:

- 300 秒の録音で `gaps` が 0、`missedFrames` が 0。
- 再生した音声とマイクの声が `audio.wav` に含まれる。
- 文字起こしのタイムスタンプが実時間と一致する。
- 会議アプリのマイクと Kataribe のマイクが同じ入力を使う。

### 11. 録音エラーの会議詳細表示

1. マイク権限を拒否した状態で録音を開始する、または録音中に BlackHole 2ch を切断する。
2. 会議一覧から該当する会議を開く。
3. 会議詳細に録音エラーと発生日時が表示されることを確認する。
4. アプリを再起動し、同じ会議を開く。

合格条件:

- 録音開始時と録音中のどちらのエラーも、会議詳細にメッセージが残る。
- アプリを再起動しても、会議詳細に同じメッセージが表示される。
- `meta.json` の `recording_error` にメッセージと日時が残る。

## 結果の記録

`docs/testing/recording-regression-template.md` をコピーし、`docs/testing/results/YYYY-MM-DD-<用途>.md` として保存する。
結果には、実行日、macOS、Electron、BlackHole、使用マイク、出力デバイス、各項目の合否、ログのパスを書く。

## 参照

- `docs/m0/0003-system-audio/README.md`
- `docs/issues/closed/0006-test-m0-regression-harness.md`
- `docs/issues/closed/0002-feat-system-audio-silence-detection.md`
- `docs/issues/closed/0012-feat-device-loss-and-permission-handling.md`
- `docs/release-checklist.md`
