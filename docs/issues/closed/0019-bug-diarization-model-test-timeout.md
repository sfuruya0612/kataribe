# 話者分離モデルの実 I/O テストが CI でタイムアウトする問題を修正する

- Requirements: なし (テスト基盤の修正であり、PRD の要求ではない)
- Priority: High
- Created: 2026-11-01
- Completed: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/bug-diarization-model-test-timeout

## 目的

CI で `tests/diarization-model.test.ts` の最初のテストが既定の 5 秒を超えて失敗するのを防ぐ。
ダウンロード、Range 再開、展開、SHA-256 照合、状態管理の検証内容は弱めない。

## 優先度根拠

CI が赤くなると、すべての変更の統合が止まる。
テストの検証内容ではなく実行時間の余裕を調整する修正であり、優先度は High とする。

## 現状

`tests/diarization-model.test.ts` は 1 MiB のダミーモデルを bzip2 で圧縮し、ローカル HTTP サーバから取得し、`/usr/bin/tar` で展開し、SHA-256 を照合する。
実 I/O と子プロセスを使うため、CI の並列実行では 5 秒の既定タイムアウトを超えることがある。
CI の実測では、最初のテストが 5083 ms でタイムアウトした。
ローカルでは同じテストが 933 ms で通過する。

## 設計方針

- フィクスチャのセグメンテーションモデルを 1 MiB から 64 KiB に減らす。圧縮、ダウンロード、展開、ハッシュの経路は変えず、実 I/O の検証を保つ。
- `vitest.config.mts` の `testTimeout` を 15 秒にする。実 I/O と子プロセスを使う統合テストが並列実行されても完了できる余裕を持たせる。ハングは 15 秒で検知できる。
- テストに、実 I/O を使うテストであることと、フィクスチャの大きさの理由をコメントで残す。
- テストの検証内容は変更しない。ダウンロード、Range 再開、展開、SHA-256、状態、重複排除、キャンセル、ファイル消失の確認を維持する。

## 完了条件

- [x] `tests/diarization-model.test.ts` の最初のテストが、フィクスチャ削減後もダウンロード、展開、SHA-256 照合、状態を検証する。
- [x] `tests/diarization-model.test.ts` を連続 10 回実行し、すべて通過する。
- [x] `npx tsc -p tsconfig.node.json --noEmit` と `npx tsc -p tsconfig.web.json --noEmit` が通る。
- [x] `npm test` が通る。
- [x] `npm run build` が通る。
- [x] CHANGES.md の `### misc` にテスト基盤の修正を記録する。

## 解決方法

- `tests/diarization-model.test.ts` のセグメンテーションモデルのバッファを 64 KiB にする。テストの目的と実 I/O の性質をコメントに書く。
- `vitest.config.mts` に `testTimeout: 15_000` を追加し、実 I/O テストのための余裕であることをコメントに書く。
- `CHANGES.md` の `### misc` に `[FIX]` エントリを追加する。

## 実施結果

セグメンテーションモデルのフィクスチャを 64 KiB に減らし、`vitest.config.mts` の `testTimeout` を 15 秒にした。
64 KiB のフィクスチャで `tests/diarization-model.test.ts` を 10 回連続実行し、すべて通過した。
各回のテストファイル全体の所要時間は約 340 ms だった。
CI の並列実行で 5 秒を超える余地を減らし、15 秒のタイムアウトでハングを検知する。
ダウンロード、Range 再開、展開、SHA-256、状態、重複排除、キャンセル、ファイル消失の検証は変更していない。
