# 要約後の自動タイトルに日付 YYYY-MM-DD の接頭辞が付かない問題を修正する

- Requirements: REQ-SUMMARY-003
- Priority: High
- Created: 2026-11-16
- Completed: 2026-11-16
- Model: DeepSeek V4.1 Flash 1017

## 目的

要約の生成後に LLM が会議タイトルを付けるとき、会議の開始日 `YYYY-MM-DD` をタイトルの接頭辞として付ける。
会議フォルダ名は `YYYY-MM-DD_タイトル` の形式を保ち、タイトルに日付が付いたときに日付を重複させない。
日付のない古い会議フォルダをタイトル変更で改名するときも、会議の開始日を使って `YYYY-MM-DD_タイトル` にする。

## 優先度根拠

自動タイトルは会議一覧、会議詳細、検索結果で表示される。
日付の接頭辞がないと、同じような名前の会議を日付で見分けにくい。
既存のフォルダ命名規則とタイトルの表示が一致しないため、修正する。

## 再現手順

1. タイトルが `タイトル未入力` の会議で要約を生成する。
2. LLM が `ASM診断結果の対応方針確認` のような日付を含まないタイトルを返す。
3. 会議のタイトルが `ASM診断結果の対応方針確認` になり、`YYYY-MM-DD` の接頭辞が付かない。
4. 会議フォルダは `YYYY-MM-DD_ASM診断結果の対応方針確認` になるが、タイトルとフォルダ名が一致しない。

日付のないフォルダ `2026/週次定例` の会議でタイトルを変更すると、フォルダが `週次定例_新しい定例` のようになり、`YYYY-MM-DD` の接頭辞が付かない。

## 原因

- `generateAndSaveMeetingTitle` は LLM が返したタイトルをそのまま `MeetingStore.updateTitle` に渡す。
- `updateTitle` は `meta.title` に日付を付けず、フォルダ名だけに現在のフォルダの日付接頭辞を付ける。
- 現在のフォルダに日付接頭辞がない場合、`updateTitle` はフォルダ名から日付を推測できず、`startedAt` も使わない。

## 設計方針

- `src/shared/title.ts` に次の関数を追加する。
  - `formatMeetingDatePrefix(startedAt)` — 会議の開始日をローカル日付の `YYYY-MM-DD` にする。
  - `splitMeetingDatePrefix(title)` — タイトル先頭の `YYYY-MM-DD` と区切り文字を取り除き、日付と本文に分ける。
  - `addMeetingDatePrefix(title, startedAt)` — タイトル先頭の日付を会議の開始日に置き換え、`YYYY-MM-DD_` を付ける。
- `generateAndSaveMeetingTitle` は LLM のタイトルを `sanitizeMeetingTitle` した後、`addMeetingDatePrefix` で会議の開始日を付ける。
- `MeetingStore.updateTitle` は次の規則にする。
  - タイトルに日付接頭辞がある場合は、その日付と本文を正規化してタイトルとフォルダ名の両方に使う。日付を重複させない。
  - タイトルに日付接頭辞がない場合は、タイトルは入力のまま、フォルダ名は会議の開始日の `YYYY-MM-DD_` を付ける。
  - 現在のフォルダに日付がない場合も、会議の開始日をフォルダ名に使う。
- 既存の会議は自動で改名しない。次にタイトルを変更したときから新しい規則を適用する。

## 完了条件

- [x] 要約後の自動タイトルに `YYYY-MM-DD_` の接頭辞が付く。
- [x] LLM がタイトルに日付を付けている場合、会議の開始日の日付に置き換え、重複させない。
- [x] 日付接頭辞のない古いフォルダをタイトル変更すると、会議の開始日を使った `YYYY-MM-DD_タイトル` になる。
- [x] タイトルに日付接頭辞がある手動変更では、フォルダ名の日付が重複しない。
- [x] `formatMeetingDatePrefix`、`splitMeetingDatePrefix`、`addMeetingDatePrefix`、`updateTitle` のテストを追加する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README、CHANGES.md、PRD を更新する。

## 解決方法

- `src/shared/title.ts` に `formatMeetingDatePrefix`、`splitMeetingDatePrefix`、`addMeetingDatePrefix` を追加する。
- `generateAndSaveMeetingTitle` で、LLM のタイトルを `sanitizeMeetingTitle` した後に `addMeetingDatePrefix` で会議の開始日を付ける。
- `MeetingStore.updateTitle` で、タイトル先頭の日付を正規化し、タイトルに日付がある場合はフォルダ名に日付を重複させない。
- 現在のフォルダに日付接頭辞がない場合は、会議の `started_at` から `YYYY-MM-DD` を作り、フォルダ名の接頭辞に使う。
- タイトル生成のシステムプロンプトに、日付や時刻を含めない指示を追加する。
- `tests/title.test.ts`、`tests/meeting-title.test.ts`、`tests/meetings.test.ts`、`tests/processing.test.ts` を更新する。
- `npm run typecheck`、`npm test`、`npm run build` が通ることを確認する。
