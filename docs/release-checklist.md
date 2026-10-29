# リリースチェックリスト

Kataribe の配布ビルドをリリースする前に確認する項目です。
各項目は、署名と公証をしたビルドで確認します。

## ビルド

- [ ] `npm run build` が成功する
- [ ] `npm run dist` で DMG が作られる
- [ ] アプリのバージョンとビルド番号が正しい
- [ ] `meta.json` と About 画面のバージョンが一致する

## 署名と公証

- [ ] Apple Developer ID Application の証明書で署名されている
- [ ] hardened runtime が有効になっている
- [ ] DMG が署名されている
- [ ] 公証チケットがアプリに添付されている
- [ ] Gatekeeper の警告なしに起動できる

## 権限

- [ ] `Info.plist` に `NSMicrophoneUsageDescription` がある
- [ ] `Info.plist` に `NSDocumentsFolderUsageDescription` がある
- [ ] `Info.plist` に `NSAudioCaptureUsageDescription` がない
- [ ] `Info.plist` に `NSScreenCaptureUsageDescription` がない
- [ ] hardened runtime の entitlement に `com.apple.security.device.audio-input` がある
- [ ] 初回の入力デバイス検出時または録音開始時に、マイク権限のダイアログが出る
- [ ] 画面収録権限のダイアログが出ない

## 録音

- [ ] マイク、BlackHole 2ch、両方の入力で録音できる
- [ ] 10 秒ごとに WAV チャンクが作られ、`meta.json` のチャンク一覧と一致する
- [ ] 停止時にチャンクが `audio.wav` に結合され、一時ディレクトリが削除される
- [ ] 録音中にアプリを強制終了しても、次回起動時にチャンクから復旧できる
- [ ] 録音中は `powerSaveBlocker` が有効になり、停止後に解放される
- [ ] 入力レベルのピークと RMS が 100 ms 間隔で更新される
- [ ] 60 分の録音で、実フレーム数と `AudioContext.currentTime` の差が 1 秒以内である（issue 0006）

## システム音声

- [ ] README の手順で BlackHole 2ch をインストールできる
- [ ] README の手順で Multi-Output Device を作れる
- [ ] 署名済みビルドで BlackHole 2ch を検出できる
- [ ] 署名済みビルドでシステム音声を録音できる
- [ ] 録音中に出力を Multi-Output Device から外すと、無音警告が出る
- [ ] 出力を戻すと、警告が消えて録音が継続する
- [ ] 録音中に BlackHole 2ch を消すと、録音が停止してチャンクが保存される

## Bluetooth

- [ ] 推奨構成（Bluetooth 出力 + 内蔵 / USB マイク）で録音できる
- [ ] macOS の既定入力と会議アプリのマイクを内蔵 / USB にしても HFP にならない
- [ ] Bluetooth 入力（HFP）に切り替えたときの挙動を確認した
- [ ] Bluetooth 出力の切断と再接続後に、出力を選び直せる

## 子プロセスとモデル

- [ ] ffmpeg が子プロセスとして起動する
- [ ] whisper.cpp が子プロセスとして起動する
- [ ] whisper.cpp のモデルをダウンロードできる
- [ ] 文字起こしが完了する
- [ ] アプリ終了時に子プロセスが残らない

## 配布物

- [ ] BlackHole 2ch のバイナリやインストーラを含めていない
- [ ] ffmpeg、whisper.cpp、Electron、ネイティブモジュールのライセンス表示がある
- [ ] アプリ本体が 300 MB 以下である
- [ ] DMG のサイズを記録した
- [ ] リリースノートに変更点と既知の問題がある

## ドキュメント

- [ ] README の初期設定手順が最新である
- [ ] README の Bluetooth 推奨構成が最新である
- [ ] README のトラブルシューティングが最新である
- [ ] `docs/issues/0007-docs-blackhole-license-and-support.md` の README 作業が完了している
