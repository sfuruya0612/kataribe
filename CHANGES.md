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
- [ADD] 文字起こしの日本語訳・英語訳を確認付きで生成し、transcript.ja.md / transcript.en.md に保存する
  - @shoichi.furuya
- [ADD] 保存先フォルダを設定画面から変更できるようにする
  - @shoichi.furuya
- [ADD] 会議タイトルの編集、フォルダ改名、front matter の更新を追加する
  - @shoichi.furuya
- [ADD] タイトル、文字起こし、翻訳、要約を横断する全文検索を追加する
  - @shoichi.furuya
- [ADD] 2〜10 人の話者分離、話者数の指定、話者名の変更を追加する
  - 話者分離モデルは初回利用時にダウンロードする
  - @shoichi.furuya
- [ADD] Multi-Output Device をアプリから自動作成・削除するヘルパーと設定画面を追加する
  - @shoichi.furuya
- [ADD] mp3 の 64 / 128 kbps 設定、whisper の用語集、会議ごとの要約言語を追加する
  - @shoichi.furuya
- [ADD] 処理速度比の実測保存、ハードリミットの継続確認、小さいモデルでの再実行を追加する
  - @shoichi.furuya
- [ADD] 検索結果から音声の該当位置へジャンプできるようにする
  - @shoichi.furuya
- [ADD] SQLite と FTS5 による会議索引と全文検索を追加する
  - @shoichi.furuya
- [ADD] 既存 mp3 / wav の取り込み、要約プロンプト編集を追加する
  - @shoichi.furuya
- [ADD] バックグラウンド通信の無効化と、起動時の孤児子プロセス掃除を追加する
  - @shoichi.furuya
- [ADD] 会議一覧からの Pin 止めと会議の削除を追加する
  - @shoichi.furuya
- [ADD] サイドバーを年 -> 月の階層で絞り込めるようにする
  - @shoichi.furuya
- [ADD] タイトル未入力の会議に、要約生成時の LLM でタイトルを付ける
  - @shoichi.furuya
- [ADD] ヘッダーのアプリ名の左にアプリアイコンを表示する
  - @shoichi.furuya
- [ADD] mise のタスクから npm スクリプトを実行できるようにする
  - @shoichi.furuya
- [ADD] OS のダークモードに追従する配色と、システム / ライト / ダークを選べる外観設定を追加する
  - @shoichi.furuya
- [ADD] 録音開始時と録音中のエラーを会議ごとに保存し、会議詳細に表示する
  - @shoichi.furuya
- [ADD] LLM プロファイルを ID、Provider、エンドポイント URL、モデル、API キーの単位で保存し、既定と要約に使うプロファイルを選べるようにする
  - @shoichi.furuya
- [ADD] GitHub Actions で Pull Request と main ブランチの型検査、テスト、ビルドを実行する
  - @shoichi.furuya
- [ADD] バージョンと一致するタグの push で、署名なしの DMG を添付した GitHub Release を自動作成する
  - @shoichi.furuya
- [ADD] 同じ音声と話者分離設定の再文字起こしで、初回の話者分離結果を再利用し、話者名を保持する
  - 音声や話者分離の設定が変わると再分離する
  - @shoichi.furuya
- [ADD] 設定画面で UI の表示言語を日本語と英語から選べるようにする
  - 画面、メニューバー、アプリケーションメニュー、確認ダイアログ、エラーメッセージに反映する
  - アプリケーションメニューの標準項目も選んだ言語で表示する
  - @shoichi.furuya

### CHANGE

- [CHANGE] グローバルショートカット機能を削除する
  - @shoichi.furuya

### FIX

- [FIX] 設定画面を開き直したときに LLM の設定が既定に戻る問題を修正する
  - @shoichi.furuya
- [FIX] 録音停止時に最終チャンクと停止通知が重複する問題を修正する
  - @shoichi.furuya
- [FIX] WAV の fmt / data チャンクを解析して、波形と長さを正しく取得する
  - @shoichi.furuya

### misc

- [ADD] ADR-0019 を追加し、ADR-0017 の配布と DMG の決定を改訂する
  - @shoichi.furuya
- [ADD] リリースチェックリストと録音回帰テストに録音エラー表示の確認手順を追加する
  - @shoichi.furuya
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
- [ADD] ADR-0018 を追加し、ADR-0001 と ADR-0003 を Multi-Output Device の自動作成に合わせて改訂する
  - @shoichi.furuya
- [ADD] issue 0008 の解決方法を記録し、closed に移動する
  - @shoichi.furuya
- [ADD] MIT ライセンスを追加する
  - @sfuruya0612
- [ADD] issue 0018 を起票し、1000 行を超えるソースファイルの分割方針を記録する
  - @shoichi.furuya
- [ADD] ADR-0022 を追加し、UI の表示言語の切り替えを記録する
  - @shoichi.furuya
- [ADD] issue 0017 の解決方法を記録し、closed に移動する
  - @shoichi.furuya
- [ADD] README とリリースチェックリストに UI の言語の確認手順を追加する
  - @shoichi.furuya
