# ADR-0014: 配布は electron-builder で署名と公証を行った DMG にする

Created: 2026-10-28
Model: DeepSeek V4.1 Flash 1017
Status: Accepted

## 背景

Kataribe は、署名と公証を済ませた .dmg で配布し、Gatekeeper の警告なしに起動できることを要件とする（PRD の「非機能要件」）。
配布物には Electron の本体、ffmpeg、whisper.cpp、`better-sqlite3` などのネイティブモジュールが含まれる。
文字起こしのモデルは初回起動後に別途ダウンロードするため、アプリ本体には含めない。
アプリ本体のサイズは 300 MB 以下を目標とする。

macOS では、署名のないアプリや公証を受けていないアプリは Gatekeeper に止められる。
子プロセスとして同梱するバイナリも署名の対象になる。
Apple Silicon のみを対象にするため、配布するアーキテクチャは arm64 とする。

## 決定

- 配布には electron-builder を使い、DMG を作る。
- アプリは Apple Developer ID Application の証明書で署名し、hardened runtime を有効にする。
- 公証は Apple の公証サービスに提出し、発行されたチケットをアプリに添付する。
  DMG 自体にも署名し、配布前に Gatekeeper の検査を通す。
- Apple Silicon 向けの arm64 の DMG を出す。
  Intel Mac は動作保証外とする。
- アプリのバンドルには、Electron の本体、Renderer の成果物、メインプロセスの成果物、preload の成果物を含める。
- ffmpeg と whisper.cpp は `resources/bin/<arch>/` に置き、`asar` の外に展開する。
  それぞれのバイナリを個別に署名する。
  `codesign --deep` に頼らず、署名の対象を列挙して順番に署名する。
- `better-sqlite3` などのネイティブモジュールは、Electron の版に合わせて再ビルドし、署名の対象に含める。
  `.node` ファイルは `asarUnpack` で `app.asar.unpacked` に展開し、実行時に読み込めることを確認する。
- Electron の fuses で、`RunAsNode` と `EnableNodeCliInspectArguments` を無効にし、`OnlyLoadAppFromAsar` を有効にする。
  preload の API と IPC の引数はメインプロセスで検証する（ADR-0001、ADR-0013）。
- `extraResources` は arm64 用の ffmpeg と whisper.cpp を含める。
- `Info.plist` に `LSMinimumSystemVersion` を設定し、macOS 14.2 Sonoma 以降を対象にする。
  マイクと書類フォルダの利用目的として、`NSMicrophoneUsageDescription` と `NSDocumentsFolderUsageDescription` を記載する。
  システム音声は BlackHole 2ch などの仮想オーディオデバイスを入力として使うため、画面収録権限とシステム音声録音権限は要求しない（ADR-0003）。
- アプリのバージョンはセマンティックバージョニングとし、ビルド番号を別に持つ。
  About 画面と `meta.json` にアプリのバージョンを記録する。
- モデルはアプリに同梱せず、初回起動後または設定画面でダウンロードする（ADR-0006）。
  ダウンロードしたモデルは署名の対象にしないが、SHA-256 のチェックサムで検証する。
- 配布の経路の第一候補は、GitHub Releases などの直接ダウンロードとする。
  Mac App Store は、サンドボックス、仮想オーディオデバイスの入力、子プロセスの起動の制約があるため、MVP では使わない。
- 署名と公証の処理は CI で行う。
  証明書と公証の資格情報は CI の秘密として管理し、リポジトリに置かない。
- リリースの前に、署名済みのアプリで次の項目を確認する。
  - Gatekeeper の警告なしに起動できる。
  - マイクの権限を要求できる。
  - BlackHole 2ch を入力デバイスとして検出し、システム音声を録音できる。
  - ffmpeg と whisper.cpp を子プロセスとして起動できる。
  - モデルをダウンロードして文字起こしができる。
  - アプリを終了したときに子プロセスが残らない。
- ffmpeg、whisper.cpp、Electron、ネイティブモジュールのライセンスと著作権表示をアプリに同梱する。
- 自動更新の仕組みは未決事項とする。
  入れる場合は、録音中に更新を適用せず、更新の確認で会議の内容を送らないことを ADR-0013 に合わせて決める。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| Mac App Store で配布する | サンドボックスの中でシステム音声を取得し、ffmpeg と whisper.cpp を子プロセスで起動する構成が制約を受ける。審査と配布の手間も増える |
| 署名なしの zip で配布する | Gatekeeper の警告が出て、PRD の「Gatekeeper の警告なしに起動できる」を満たせない |
| Homebrew Cask だけで配布する | Cask は配布の入口としては便利だが、アプリ自体の署名と公証は別に必要になる。直接ダウンロードを第一候補にする |
| Intel 向けの x64 DMG も出す | Intel Mac は動作保証外なので作らない。テストと署名の対象を増やさない |
| 自動更新を最初から入れる | 更新の配信と署名の経路が増え、通信の方針も増える。必要になった時点で、送る情報を明記して入れる |
| Tauri や Swift のネイティブアプリで配布する | アプリ基盤の決定（ADR-0001）と、録音と文字起こしの構成が変わる。配布だけを理由に基盤を変えない |
| モデルをアプリに同梱する | large-v3-turbo だけで約 1.6 GB になり、アプリ本体のサイズ目標を満たせない（ADR-0006） |

## 結果

- Apple Developer Program への登録と、Developer ID Application の証明書が必要になる。
  証明書の有効期限と、CI の秘密の更新を管理する。
- 公証には時間がかかる。
  リリースの直前に公証を始めると間に合わないため、CI の段階で余裕を持つ。
- 署名の対象がアプリ本体、子プロセス、ネイティブモジュールに分かれる。
  1 つでも署名漏れがあると、hardened runtime のアプリから起動できないか、Gatekeeper に止められる。
- arm64 の DMG を 1 つビルドするため、CI と配布物の数を抑えられる。
  子プロセスのバイナリとネイティブモジュールは arm64 用を揃える。
- アプリのサイズは、Electron、ffmpeg、whisper.cpp、ネイティブモジュールの合計になる。
  ビルドのたびにインストール後の `.app` のサイズを測り、300 MB 以下を確認する。
  DMG は圧縮されるため、DMG のサイズは別に記録する。
  300 MB を超える場合は、ffmpeg の最小ビルド、Electron のロケールの削減、不要なソースマップの削除で対応する。
- モデルを別にダウンロードするため、初回起動時のネットワークとディスクの案内が必要になる。
- 自動更新を入れない場合、利用者は新しい版を手動でダウンロードする。
  更新の通知をアプリ内で出すかは未決事項とする。
- Mac App Store を使わないため、配布は開発元のサイトか GitHub Releases に依存する。
  ダウンロードの経路と、配布物のハッシュの公開を決める必要がある。
- 署名と公証の検証をリリースのチェックリストに入れることで、Gatekeeper の警告や子プロセスの起動失敗をリリース前に見つけられる。
- BlackHole 2ch はアプリに同梱せず、利用者がインストールする。
  配布物と署名の対象は変わらない（ADR-0003）。

## 未決事項

- アプリの bundle identifier、Team ID、配布用のドメイン。
- hardened runtime で必要な entitlement の正確な一覧。
  Electron と子プロセスの起動に必要な項目を、署名の検証で確定する。
- 自動更新の仕組みを入れるか。
  入れる場合の配信経路、署名、録音中の適用の保留。
- 配布の経路を GitHub Releases にするか、独自のサイトにするか。
- CI の提供元と、証明書と公証の資格情報の管理方法。
- アプリのサイズを測る基準と、300 MB を超えた場合の削減方法。
- 初回起動時のモデルのダウンロードの案内と、ダウンロードに失敗した場合の導線。
- 更新の通知をアプリ内で出すか。
- Mac App Store を将来の選択肢として残すか。
