# Electron + TypeScript + React + Vite のアプリ基盤を作る

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
Completed: 2026-10-29
優先度: P0
対応 ADR: ADR-0001 (docs/adr/0001-electron-typescript-react-vite.md)、ADR-0014 (docs/adr/0014-distribution-dmg-notarization.md)
関連 PRD: 非機能要件の対応環境、配布、権限
依存: なし

## 背景

リポジトリには設計文書と M0 の検証ハーネスしかなく、起動できるアプリがない。
ADR-0001 は Electron、TypeScript、React、Vite を採用し、ADR-0014 は hardened runtime と署名、公証を定めている。
以降の issue が乗るアプリ基盤を最初に作る必要がある。

## 目的

macOS で起動できる最小の Electron アプリを作り、開発、ビルド、署名の土台を整える。

## やること

- `package.json`、TypeScript、Vite、React、Electron の main、preload、renderer を作る。
- Renderer の Node.js 連携を無効にし、`nodeIntegration` を false、`contextIsolation` を true、`sandbox` を true にする。
  preload の `contextBridge` で必要な API だけを公開する。
- CSP を設定し、開発時と配布時で不要な権限を増やさない。
- アプリのインスタンスを 1 つに制限する。
- 開発、ビルド、パッケージの npm scripts を定義する。
  コマンド名は実装時に決める。
- `Info.plist` に `NSMicrophoneUsageDescription` と `NSDocumentsFolderUsageDescription` を入れ、`LSMinimumSystemVersion` を設定する。
  `NSAudioCaptureUsageDescription` と `NSScreenCaptureUsageDescription` は入れない。
- hardened runtime の設定に `com.apple.security.device.audio-input` entitlement を入れる。
  entitlement の一覧は issue 0013 で検証する。
- README の起動方法を、実際の Node.js のバージョンとコマンドで更新する。
- 配布版の README リンク先を決める。
  アプリに README を同梱するか、GitHub の README を開くかを選び、リンクを実装する。
- 起動、ビルド、Renderer の権限、`Info.plist` のキーをテストする。

## 完了条件

- `npm install` と `npm run dev` で、macOS 26.7.1 の arm64 でアプリが起動する。
- `npm run build` が成功する。
- Renderer から Node.js の API にアクセスできない。
  preload の API は動く。
- `Info.plist` にマイクと書類フォルダの用途説明があり、画面収録とシステム音声録音のキーがない。
- hardened runtime の設定に audio-input entitlement が入っている。
- README の起動方法が実際のコマンドで更新されている。
- 配布版の README リンク先が決まり、リンクが動く。

## 解決方法

2026-10-29 にアプリ基盤を実装し、開発版とパッケージ版の smoke test まで確認した。

- `npm install` と `npm run dev` で、Electron 45.1.0 のアプリが起動する。
  `KATARIBE_SMOKE_TEST=1 npm run dev` で、Renderer の読み込みと preload の IPC を確認した。
- `npm run typecheck`、`npm test`、`npm run build`、`npm run smoke` が成功する。
  テストは `isAllowedPermission` と `getMediaTypes` の 8 件。
- `npm run smoke` と、パッケージ済みの `Kataribe.app` の smoke test が成功する。
- `npm run package` で `release/mac-arm64/Kataribe.app` を作れる。
  - `Info.plist` に `NSMicrophoneUsageDescription`、`NSDocumentsFolderUsageDescription`、`LSMinimumSystemVersion` 14.2、`CFBundleDisplayName` がある。
  - `NSAudioCaptureUsageDescription`、`NSScreenCaptureUsageDescription`、`NSCameraUsageDescription` は `scripts/after-pack.cjs` で削除する。
  - `NSAppTransportSecurity.NSAllowsArbitraryLoads` は false にする。
  - `build/entitlements.mac.plist` に `com.apple.security.device.audio-input` がある。
    署名済みビルドでの検証は issue 0013 で行う。
  - `CFBundleIdentifier` は `com.kataribe.app` の仮値である。
    0013 と ADR-0014 で確定する。
- Renderer は `nodeIntegration` false、`contextIsolation` true、`sandbox` true で動く。
- アプリは 1 インスタンスに制限する。
- 権限は media の audio だけを許可し、video とその他の権限を拒否する。
- 新規ウィンドウと外部への遷移を制限する。
- CSP は開発時と配布時で分ける。配布時は `script-src 'self'`、`connect-src 'self'` とする。
- README の起動方法を、Node.js 24.21.0 以降の実際のコマンドに更新した。
- アプリアイコンは未設定で、Electron の既定アイコンを使う。
  配布前に issue 0013 または 0015 で用意する。

## 参照

- `docs/adr/0001-electron-typescript-react-vite.md`
- `docs/adr/0014-distribution-dmg-notarization.md`
- `docs/prd/kataribe.md` の非機能要件
- `README.md`
