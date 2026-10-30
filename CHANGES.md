# 変更履歴

## develop

### ADD

- [ADD] Electron と React のアプリ基盤を追加する
  - @shoichi.furuya
- [ADD] マイクと BlackHole の録音中核、WAV チャンク、復旧を追加する
  - @shoichi.furuya
- [ADD] メニューバー、録音パネル、会議一覧、会議詳細、設定の土台を追加する
  - @shoichi.furuya
- [ADD] 録音中のデバイス消失とマイク権限拒否の処理を追加する
  - @shoichi.furuya
- [ADD] 署名済みビルド向けの entitlement と配布物検証コマンドを追加する
  - @shoichi.furuya
- [ADD] BlackHole 2ch の検出と入力デバイスの優先順位を追加する
  - @shoichi.furuya
- [ADD] マイク入力のクリッピング警告と設定を追加する
  - @shoichi.furuya
- [ADD] P6 の新 UI、会議一覧、波形オーディオプレイヤー、タブ式設定と設定保存を追加する
  - @shoichi.furuya
- [ADD] システム音声の無音検出と設定を追加する
  - @shoichi.furuya
- [ADD] スリープ復帰時の録音再開と無音ギャップ補填を追加する
  - @shoichi.furuya
- [ADD] About に BlackHole 2ch の出典を追加する
  - @shoichi.furuya
- [ADD] L1 の絵札アイコンから .icns とメニューバー用テンプレート PNG を生成するコマンドを追加する
  - @shoichi.furuya
- [ADD] 録音停止後の mp3 変換、16 kHz WAV 生成、波形保存を追加する
  - @shoichi.furuya
- [ADD] whisper モデルのダウンロード、SHA-256 検証、再開、削除を追加する
  - @shoichi.furuya
- [ADD] whisper.cpp による文字起こし、進捗、部分結果保存、自動再開、キャンセルを追加する
  - @shoichi.furuya
- [ADD] safeStorage による API キー保存と、OpenAI 互換 / Anthropic の要約生成を追加する
  - @shoichi.furuya
- [ADD] 文字起こしと要約の編集、コピー、送信前確認ダイアログを追加する
  - @shoichi.furuya
- [ADD] 同梱する whisper-cli と最小構成 ffmpeg のビルドスクリプト、ライセンス表示を追加する
  - @shoichi.furuya
- [ADD] 開発起動時とビルド済みアプリの Dock アイコンに L1 のアプリアイコンを反映する
  - @shoichi.furuya

### FIX

- [FIX] 録音停止時に最終チャンクと停止通知が重複する問題を修正する
  - @shoichi.furuya
- [FIX] WAV の fmt / data チャンクを解析して、波形と長さを正しく取得する
  - @shoichi.furuya

### misc

- [ADD] README とリリースチェックリストに録音と画面の確認手順を追加する
  - @shoichi.furuya
- [ADD] README に BlackHole 2ch のサポート情報と画面写真を追加する
  - @shoichi.furuya
- [ADD] 録音のリリース回帰テスト手順と結果テンプレートを追加する
  - @shoichi.furuya
- [CHANGE] 配布予定がないため署名・公証の検証を対象外にする
  - @shoichi.furuya
- [ADD] README に文字起こし、モデル取得、API キー、要約の利用手順を追加する
  - @shoichi.furuya
