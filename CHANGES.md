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
- [ADD] システム音声の無音検出と設定を追加する
  - @shoichi.furuya
- [ADD] スリープ復帰時の録音再開と無音ギャップ補填を追加する
  - @shoichi.furuya
- [ADD] About に BlackHole 2ch の出典を追加する
  - @shoichi.furuya
- [ADD] L1 の絵札アイコンから .icns とメニューバー用テンプレート PNG を生成するコマンドを追加する
  - @shoichi.furuya

### FIX

- [FIX] 録音停止時に最終チャンクと停止通知が重複する問題を修正する
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
