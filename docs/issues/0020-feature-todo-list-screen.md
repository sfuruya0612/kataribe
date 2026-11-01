# 要約の ToDo を全会議横断で一覧表示し、完了状態を管理する

- Requirements: REQ-TODO-001, REQ-SUMMARY-001
- Priority: High
- Created: 2026-11-01
- Model: DeepSeek V4.1 Flash 1017
- Branch: feature/feature-todo-list-screen

## 目的

要約に含まれる ToDo を全会議横断で確認できる画面を追加し、完了状態を要約 Markdown のチェックボックスに保存する。
既存の要約を再生成するときは、上書きと ToDo の完了状態の消失を送信前の確認ダイアログで警告する。

## 優先度根拠

利用者が明示的に求めた画面であり、会議ごとの要約に埋もれている ToDo を日常的に確認する導線になる。
既存の `summary.md` を正本にするため、データ移行を伴わない。

## 現状

要約は `summary.md` の `## ToDo` セクションに `- [ ] 内容 (担当: ...、期限: ...)` の行を持つ (ADR-0011)。
会議詳細の要約ペインでしか確認できず、会議をまたいだ一覧はない。

要約の再生成は、既存の `summary.md` を `summary.previous.md` に退避してから新しい本文で上書きする (ADR-0011)。
完了状態はチェックボックスにあるため、再生成すると失われる。
現在の送信確認ダイアログは、上書きと完了状態の消失を表示しない。

会議一覧と検索は SQLite の索引を使うが、ToDo の完了状態は索引にない。
索引は会議フォルダから再構築する派生物であり、完了状態の正本にはできない (ADR-0010)。

## 設計方針

- ToDo 一覧は、各会議の `summary.md` の ToDo セクションにあるチェックボックス行から組み立てる。SQLite の索引に ToDo 専用のテーブルや完了状態の列を追加しない。
- 完了状態の正本は `summary.md` のチェックボックスとする。`meta.json` と SQLite 索引に完了状態を複製しない。
- 一覧からチェックを切り替えるとき、一覧が持つ行番号と本文を main プロセスへ渡す。main プロセスは `summary.md` を読み直し、行番号の行が ToDo セクションのチェックボックスであり、本文が一致するときだけ書き込む。一致しないときは書き込みを拒否し、一覧を再読み込みさせる。
- main プロセスは書き換える前に、`parseTodoItems` の結果に対象の行番号と本文を持つ項目が含まれることを確認する。ToDo セクション外のチェックボックスは書き換えない。
- 同じ会議へのチェック操作は、会議 ID ごとの write queue で read-modify-write 全体を直列化する。失敗した操作があっても queue は進め、別の会議の操作は待たせない。
- Renderer の ToDo 一覧の再取得は、最新の要求の応答だけを状態へ反映する。古い応答が後から届いても、最新の一覧とローディング状態を上書きしない。
- ToDo 一覧の取得は、会議一覧の順序 (Pin 止め、開始日時の降順) で各会議の `summary.md` を読み、ToDo セクションのチェックボックス行を返す。要約がない会議と ToDo がない会議は含めない。
- 表示は Renderer が担い、未完了、完了、すべての切り替えと、会議ごとのグルーピングを行う。UI の固定文言は日本語と英語の辞書に追加する。ToDo の本文は翻訳しない (ADR-0022)。
- 要約の再生成時は、既存の要約がある場合に限り、送信前の確認ダイアログへ「既存の要約を上書きする」「ToDo の完了状態を引き継がない」の警告を表示する。追加の確認ダイアログは出さず、既存の送信確認ダイアログに警告を置く。
- 再生成時に ToDo の完了状態を引き継ぐ処理は入れない。LLM が ToDo の表現を変えるため、本文の一致による対応付けは誤りやすい。
- 依存は追加しない。PBT のライブラリがないため、純粋関数は境界を網羅した Example-based test で固定する。既存プロジェクトのテスト構成に合わせる判断であり、PBT を採用しない理由をここに残す。
- 除外範囲は、期限や担当による並べ替え、通知、外部カレンダー連携、完了状態の引き継ぎとする。期限と担当は ToDo 本文の一部として表示する。
- `src/main/index.ts` と `src/renderer/src/MeetingDetail.tsx` は 1000 行を超えている。`index.ts` への追加は IPC ハンドラ 2 つの登録だけにし、処理本体は新しい module に置く。`MeetingDetail.tsx` への追加は警告コンポーネントの呼び出し 1 行にし、警告の表示は新しいファイルに置く。両ファイルの分割は issue 0018 の範囲とする。

## 完了条件

- [ ] REQ-TODO-001 の受入基準「サイドバーの ToDo から、ToDo 一覧を開ける」を満たす。
- [ ] REQ-TODO-001 の受入基準「一覧は、要約の ToDo セクションにあるチェックボックス項目を、会議のタイトルと日付付きで表示する」を満たす。
- [ ] REQ-TODO-001 の受入基準「未完了、完了、すべてを切り替えて表示できる」を満たす。
- [ ] REQ-TODO-001 の受入基準「チェックボックスを操作すると、その会議の要約のチェックボックスが更新され、アプリを再起動しても状態が残る」を満たす。
- [ ] REQ-TODO-001 の受入基準「一覧の項目から、その会議の詳細を開ける」を満たす。
- [ ] REQ-TODO-001 の受入基準「要約がない会議と、ToDo がない会議は一覧に表示しない」を満たす。
- [ ] REQ-TODO-001 の受入基準「表示言語を切り替えても、ToDo の本文は変更しない」を満たす。
- [ ] REQ-SUMMARY-001 の受入基準「既存の要約がある会議で要約を生成するとき、確認ダイアログに既存の要約を上書きする旨を表示する」を満たす。
- [ ] REQ-SUMMARY-001 の受入基準「同じ確認ダイアログに、ToDo の完了状態を引き継がない旨を表示する」を満たす。
- [ ] REQ-SUMMARY-001 の受入基準「既存の要約がない会議では、上書きと完了状態に関する警告を表示しない」を満たす。
- [ ] REQ-SUMMARY-001 の受入基準「警告は UI の表示言語に従う」を満たす。
- [ ] REQ-SUMMARY-001 の受入基準「確認ダイアログで送信操作をするまで、要約を上書きしない」を満たす。既存のプレビューが生成を実行せず、確認トークンなしでは生成できないことを既存テストで固定する。
- [ ] ToDo セクションの抽出、チェックボックス以外の行の除外、行番号と本文が一致しないときの書き込み拒否、front matter と他の行の保持、空の一覧、会議をまたぐ順序をテストで固定する。
- [ ] 未完了、完了、すべての絞り込みと、会議ごとのグルーピングをテストで固定する。
- [ ] UI の日本語と英語の文言、ToDo の項目、会議詳細への遷移に必要な情報が表示されることをテストで固定する。
- [ ] 既存の要約がある場合だけ警告を表示することと、日本語と英語の警告文をテストで固定する。
- [ ] 同じ会議の複数 ToDo を同時に切り替えても、両方の完了状態が保存されることをテストで固定する。
- [ ] ToDo セクション外のチェックボックスへの切り替えを拒否し、Markdown と `summary.md` を変えないことをテストで固定する。
- [ ] CRLF の要約を切り替えると LF に正規化され、front matter と内容が保持されることをテストで固定する。
- [ ] コードフェンス内の ToDo 見出しとチェックボックスを一覧に含めず、切り替えを拒否することをテストで固定する。
- [ ] 警告コンポーネントが `SummaryDocument | null` を受け取り、null のとき表示しないことをテストで固定する。
- [ ] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [ ] README と CHANGES.md を同じ変更で更新する。PRD と ADR は起票時に更新済みである。
- [ ] 依存パッケージを追加しない。

## 解決方法

- `src/shared/markdown.ts` に次の純粋関数と型を追加する。
  - `parseTodoItems(body: string): TodoItem[]` は ToDo セクションのチェックボックス行だけを返す。項目は本文中の 0 始まりの行番号、完了状態、本文を持つ。コードフェンス内の見出しとチェックボックスは除外する。
  - `setTodoChecked(markdown: string, lineNumber: number, expectedText: string, checked: boolean): SetTodoCheckedResult` は front matter を保持したまま、指定行の `[ ]` と `[x]` だけを書き換える。行がない、チェックボックスでない、本文が一致しない、ToDo セクションの項目でないときは `ok: false` と理由を返す。ToDo セクション外は `not-todo` を返す。改行コードは LF に正規化する。
  - 見出しの判定は既存の ToDo 見出しの別名を使う。チェックボックス行は行頭の空白、`-` または `*`、`[ ]`、`[x]`、`[X]` を許容する。本文が空の行は項目にしない。
- `src/shared/types.ts` に `MeetingTodo` を追加する。項目は `meetingId`、`meetingTitle`、`startedAt`、`lineNumber`、`checked`、`text` を持つ。
- `src/main/private-file.ts` を追加し、`processing.ts` の `writePrivateText` を移す。`processing.ts` は新しい module を import する。0600、fsync、rename の順序は変えず、一時ファイル名を呼び出しごとに一意にし、書き込み、chmod、rename のいずれかが失敗したら一時ファイルを削除する。
- `src/main/todos.ts` を追加する。
  - `listMeetingTodos(store: MeetingStore): Promise<MeetingTodo[]>` は会議一覧を順に読み、`summary.md` の本文から ToDo を集める。
  - `setMeetingTodoChecked(store: MeetingStore, meetingId: string, lineNumber: number, expectedText: string, checked: boolean): Promise<void>` は `summary.md` を読み直し、`setTodoChecked` が成功したときだけ `writePrivateText` で保存する。失敗時は再読み込みを促すエラーを返す。
  - `setMeetingTodoChecked` は会議 ID ごとの write queue を持ち、read-modify-write 全体を直列化する。`Map<string, Promise<void>>` に会議 ID ごとの tail を持ち、前段の成否に関係なく次の操作を実行する。tail が現在の tail のときだけ Map から削除する。
- `src/main/index.ts` に IPC を追加する。
  - `meetings:list-todos` は `listMeetingTodos` を呼ぶ。
  - `meetings:set-todo-checked` は処理中なら拒否し、保存後に `refreshMeetingIndex` と `meetings:updated` の broadcast を行う。
- `src/preload/index.ts` と `src/renderer/src/env.d.ts` に `listMeetingTodos` と `setMeetingTodoChecked` を追加する。
- `src/renderer/src/todo-utils.ts` を追加し、`TodoFilter`、`TodoGroup`、`filterTodos`、`groupTodosByMeeting` を定義する。入力の配列は変更しない。
- `src/renderer/src/TodoList.tsx` を追加する。
  - 既定の絞り込みは未完了とする。未完了、完了、すべてのボタンを `aria-pressed` 付きで表示する。
  - 会議ごとにタイトル、日付、項目を表示する。会議タイトルは会議詳細を開くボタンにする。
  - チェックボックスは処理中と保存中に無効化する。チェック操作は `onToggle` を await し、失敗時は App が toast を出して一覧を再取得する。
  - 読み込み中、空の一覧、絞り込み結果が空の場合、エラーの表示を分ける。
- `src/renderer/src/App.tsx` に `todos` view と `todos`、`todosLoading`、`todosError` の状態を追加する。起動時、会議更新時、保存先変更時、会議削除時に `listMeetingTodos` を呼ぶ。`onMeetingUpdated` と `onMeetingsChanged` でも再取得する。会議詳細への遷移は既存の `selectedMeetingId` と `view` を使う。
- `src/renderer/src/latest-request.ts` を追加し、`createLatestRequest(): { begin(): number; isCurrent(id: number): boolean }` を定義する。`App.tsx` の `refreshTodos` は `useRef(createLatestRequest())` で要求 ID を発行し、`await` 後に最新でない応答では `todos`、`todosError`、`todosLoading` を更新しない。
- `src/renderer/src/Sidebar.tsx` の「操作」に ToDo 一覧へのボタンと未完了件数を追加する。`view` の union に `todos` を追加する。
- `src/renderer/src/SummaryRegenerationWarning.tsx` を追加する。`summary: SummaryDocument | null` を受け取り、null でないとき、既存の要約を上書きすること、ToDo の完了状態を引き継がないこと、直前の要約を `summary.previous.md` に退避することを表示する。`MeetingDetail.tsx` の要約送信確認ダイアログで `summary` を渡す。
- `src/shared/i18n.ts` に ToDo 一覧、絞り込み、空状態、エラー、警告の日本語と英語の文言を追加する。
- `src/renderer/src/styles.css` に ToDo 一覧のスタイルを追加する。
- テストを追加する。
  - `tests/markdown.test.ts` に `parseTodoItems` と `setTodoChecked` の境界を追加する。ToDo 以外のセクションのチェックボックスを無視すること、日本語と英語の見出し、インデント、`*`、`[x]`、空本文、行番号の範囲外、非整数の行番号、チェックボックスでない行、本文の不一致、ToDo セクション外の拒否、コードフェンス内の除外、CRLF の LF への正規化、front matter と他の行の保持を含める。
  - `tests/meetings.test.ts` に `listMeetingTodos` と `setMeetingTodoChecked` の統合テストを追加する。要約なし、ToDo なし、複数会議の順序、チェック状態の保存、再読み込み、本文不一致時の拒否、ToDo セクション外の拒否、同じ会議の同時トグルを含める。
  - `src/renderer/src/todo-utils.test.ts` に絞り込みとグルーピングのテストを追加する。
  - `src/renderer/src/TodoList.test.tsx` に日本語と英語の表示、既定の未完了絞り込み、会議タイトルと日付、空状態の表示を追加する。
  - `src/renderer/src/SummaryRegenerationWarning.test.tsx` に警告の表示、非表示、日本語と英語の文言を追加する。表示条件は `SummaryDocument | null` の fixture で固定する。
  - `tests/private-file.test.ts` に、同じ path への同時書き込みで一時ファイルの衝突が起きず、一時ファイルが残らないことを追加する。
  - `src/renderer/src/latest-request.test.ts` に、最新の要求だけが current になることを追加する。
  - `src/renderer/src/App.test.tsx` にサイドバーの ToDo ボタンが日本語と英語で表示されることを追加する。
  - `tests/i18n.test.ts` と `tests/i18n-usage.test.ts` の既存検査で、追加した辞書のプレースホルダと UI リテラルを検証する。
- README の画面説明に ToDo 一覧と再生成時の警告を追加する。CHANGES.md の `## develop` の `### ADD` の末尾に、ToDo 一覧の追加と再生成警告の追加を記録する。
