# 要約後の会議チャットとキー不要 Web 検索を追加する

- Requirements: REQ-CHAT-001, REQ-CHAT-002, REQ-CHAT-003
- Priority: High
- Created: 2026-11-16
- Completed: 2026-11-16
- Model: DeepSeek V4.1 Flash 1017

## 目的

要約を生成した後、その会議の内容について AI とチャット形式でやりとりできるようにする。
会議の事実に関する質問には、要約と、相槌と擬音を除いた文字起こしを根拠に答える。
会議の外の情報が必要な質問には、利用者が明示的に有効にしたときだけキー不要の Web 検索を使う。

## 優先度根拠

要約は会議の全体像をつかむには十分だが、「この決定の背景は何だったか」「誰がこの案に反対したか」のような質問には、文字起こしの該当箇所が必要になる。
会議後に文字起こしを読み返す代わりに質問できるようにすると、録音から共有までの作業時間を短くできる。
Web 検索は会議の外の情報を調べるために必要だが、検索語と会議の内容が外部に送信されるため、既定では無効にする。

## 現状

- 要約生成時に相槌と擬音を除いた本文は `generateSummary` の戻り値に含まれるが、会議フォルダには保存していない。
- 会議詳細には文字起こしと要約のタブがあり、要約の生成、編集、コピーができる。
- LLM クライアントは system と user の 1 往復だけを送る。複数ターンの会話履歴は送れない。
- 会議ごとのチャット履歴を保存する場所はない。
- Web 検索の実装はない。

## 設計方針

### チャットのコンテキスト

- 必須のコンテキストは、要約 `summary.md` と、相槌と擬音を除いた文字起こし `transcript.cleaned.md` とする。
- 要約生成時に相槌と擬音を除く設定が有効なら、要約に使った本文を `transcript.cleaned.md` として保存する。
- 除去に失敗した場合は `transcript.cleaned.md` を削除し、チャットは元の `transcript.md` を使う。その旨を画面に表示する。
- 既存の会議で `transcript.cleaned.md` がない場合は、チャット画面から相槌と擬音の除去を実行できる。実行前に送信先と文字数を確認する。
- `transcript.md` を編集または再文字起こししたときは `transcript.cleaned.md` を削除する。話者名の変更とタイトル変更は `transcript.cleaned.md` にも反映する。
- 文字起こしが長い場合は、質問の語句と一致する行を中心に抜粋し、要約は常に全文を含める。
- 会話履歴は直近のメッセージを上限付きで含める。

### チャット履歴

- 会議フォルダの `chat.json` に保存する。`schema_version`、`messages`、`last_profile_id`、`context_hash`、`updated_at` を持つ。
- メッセージは `id`、`role`、`content`、`created_at`、`profile_id`、`model`、`web_search`、`sources`、`search_error` を持つ。
- 保存は 0600 の一時ファイルに書いて rename する。会議を削除すると `chat.json` も削除される。
- 履歴は 100 メッセージを上限とし、超えた場合は古いものから削除する。
- 要約または文字起こしが更新された場合は、次の回答から新しいコンテキストを使う。画面には更新されたことを表示する。

### Web 検索

- 検索はメッセージごとのチェックボックスで明示的に有効にする。既定は設定画面で選べる。
- API キーを要求しない簡易検索を使う。Brave Search の HTML を第一候補、DuckDuckGo の HTML を第二候補とし、Bing の RSS は CJK を含まないクエリだけ最後のフォールバックにする。
- 検索結果は最大 5 件とし、タイトル、URL、抜粋を回答のコンテキストに含める。
- 回答には `[1]` のような出典番号を付け、画面には URL 付きの出典一覧を表示する。URL はアプリ内で開かず、既定のブラウザで開く。
- 検索に失敗しても会議の要約と文字起こしだけで回答する。失敗したことを画面に表示する。
- 検索語はユーザーのメッセージを使い、会議タイトルや保存先は送らない。

### 送信とプライバシー

- チャットの送信は、利用者が送信ボタンを押したときだけ実行する。
- 画面に、要約と文字起こしを LLM に送ること、Web 検索を有効にしたときは検索語を検索エンジンに送ることを表示する。
- チャットの応答は会議の要約と文字起こしを根拠にし、資料にない事実を推測しないようプロンプトで指示する。
- 文字起こし、要約、Web 検索結果はデータとして扱い、その中の指示に従わないようプロンプトで指示する。

### UI

- 会議詳細のタブに「チャット」を追加する。
- 要約がない会議では、先に要約を生成するよう案内する。
- プロファイルの選択、Web 検索のチェックボックス、送信、停止、履歴の消去を提供する。
- コンテキストの状態（除去済み、未除去、古い）と、送信する文字数の概算を表示する。

## 完了条件

- [x] 要約生成時に `transcript.cleaned.md` を保存し、除去に失敗したときと除去を無効にしたときは削除する。
- [x] `transcript.md` の編集、再文字起こしで `transcript.cleaned.md` を無効化する。
- [x] タイトル変更と話者名変更を `transcript.cleaned.md` に反映する。
- [x] `chat.json` の読み書き、検証、100 メッセージの上限、履歴の消去を実装する。
- [x] 複数ターンの履歴を送れるよう LLM クライアントを拡張する。
- [x] 要約と文字起こしをコンテキストにしたチャットの送信、停止、再読み込みを実装する。
- [x] 長い文字起こしから関連箇所を抜粋する処理を実装する。
- [x] キー不要の Web 検索を実装し、検索結果の出典を画面に表示する。
- [x] Web 検索の既定値を設定画面から変更できるようにする。
- [x] チャットの送信内容、検索語の送信、資料にない事実を推測しないことを画面と README に明記する。
- [x] チャット履歴、コンテキスト、Web 検索の解析、UI の表示のテストを追加する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] PRD、README、CHANGES.md、ADR を更新する。

## 解決方法

- `src/main/cleaned-transcript.ts` を追加し、`transcript.cleaned.md` の保存、読み込み、削除、`source_sha256` の計算を実装する。
- 要約生成時に相槌と擬音の除去に成功した本文を `transcript.cleaned.md` に保存し、失敗時と除去の設定が無効なときは削除する。
- `transcript.md` の編集、再文字起こし、比較セッションで `transcript.cleaned.md` を無効化する。
- タイトル変更で front matter の title を更新し、話者名変更で本文と `source_sha256` を更新する。
- `src/main/chat-store.ts` を追加し、`chat.json` の schema、検証、100 メッセージの上限、0600 の保存、消去を実装する。
- `src/main/chat-context.ts` を追加し、要約とクリーニング済み文字起こしの選択、長い文字起こしの抜粋、履歴の上限、nonce 付きのプロンプト、出典番号の指示を実装する。
- `src/main/web-search.ts` を追加し、Brave Search の HTML、DuckDuckGo の HTML、Bing の RSS の順に試すキー不要検索、CJK クエリでの Bing の除外、キャッシュ、出典 URL を実装する。
- `src/main/meeting-chat.ts` を追加し、チャットの送信、キャンセル、履歴の消去、相槌と擬音の除去、Web 検索の失敗時の継続を実装する。
- `LlmClient` に `history` を追加し、OpenAI 互換 API と Anthropic の両方で複数ターンの履歴を送れるようにする。
- IPC、preload、`env.d.ts` にチャットと外部 URL の API を追加する。
- 会議詳細に「チャット」タブ、`MeetingChat` コンポーネント、コンテキストの状態表示、送信、停止、履歴の消去、Web 検索の切り替え、出典一覧を追加する。
- 設定画面に会議チャットの Web 検索の既定値を追加する。
- `tests/chat-context.test.ts`、`tests/chat-store.test.ts`、`tests/cleaned-transcript.test.ts`、`tests/web-search.test.ts`、`tests/meeting-chat.test.ts`、`MeetingChat.test.tsx`、`ChatSearchSetting.test.tsx` を追加する。
- `npm run typecheck`、`npm test`（671 件）、`npm run build` が通ることを確認する。
- PRD、README、CHANGES.md、ADR-0028 を更新する。
