# ADR-0019: タグ作成時に署名なしの開発版 DMG を GitHub Releases で配布する

Created: 2026-10-31
Model: DeepSeek V4.1 Flash 1017
Status: Accepted

## 背景

ADR-0017 は、Kataribe を配布せず、ローカルの開発ビルドのみを使うと決めていた。
そのため、DMG の作成、Apple Developer ID Application での署名、Apple の公証、Gatekeeper の評価を行わない方針だった。

タグを切った時点のビルドを GitHub Releases から取得できるようにしたいという要件が加わった。
利用者は Apple Silicon の Mac で開発版を試すために DMG をダウンロードする。
Apple Developer Program の資格情報は用意せず、署名と公証は引き続き行わない。

## 決定

- `v<package.json のバージョン>` タグの push を契機に、GitHub Actions の macOS ランナーで arm64 の DMG を作る。
- DMG は `electron-builder` の `npm run dist` で作り、`npm run verify:mac` と `hdiutil verify` で検査する。
  DMG をマウントし、含まれるアプリも `npm run verify:mac` で検査する。
- 検査に成功した場合だけ GitHub Release を作成し、DMG と SHA-256 チェックサムを添付する。
- DMG は署名も公証も行わない。
  Gatekeeper の警告なしに起動できることは保証しない。
- リリースノートに、署名と公証を行っていないこと、対象が macOS 14.2 以降の Apple Silicon であることを明記する。
- Release の作成は、テストと DMG の作成が成功した後にだけ行う。
- ローカルの開発ビルドを署名なしで使う決定は残す。

## 検討した選択肢

| 選択肢 | 採用しない理由 |
| --- | --- |
| ADR-0017 のとおり DMG を配布しない | タグ時点のビルドを GitHub Releases から取得できず、利用者が毎回ローカルでビルドする必要がある |
| Developer ID で署名し、公証する | Apple Developer Program の資格情報と外部サービスへの提出が必要で、今回は用意しない |
| ad-hoc 署名だけを行う | Gatekeeper の警告を避けられず、署名と公証の代わりにならない |
| 手元で DMG を作って Release に添付する | ビルドと添付の手順が属人化し、タグと成果物が一致しなくなる |
| Intel Mac 向けの DMG も作る | 同梱バイナリと動作検証が arm64 のみで、Intel Mac は対象外である |

## 結果

- タグと一致するバージョンの DMG を GitHub Releases からダウンロードできる。
- 利用者は Gatekeeper の警告を許可する必要がある。
  起動できない場合は、Applications にコピーしたアプリを Finder で右クリックして開くか、システム設定の「プライバシーとセキュリティ」から許可する。
- 署名と公証は行わないため、Gatekeeper の警告なしの起動、公証、Developer ID の検証は完了条件に含めない。
- macOS ランナーで DMG を作る時間と、DMG を Artifact として受け渡す時間が CI に加わる。
- 将来 Developer ID を用意する場合は、この ADR を改訂し、ADR-0014 の署名と公証の決定を再開する。
