# 会議詳細の要約ペインの幅をドラッグで変更できるようにする

- Requirements: REQ-UI-002
- Priority: Medium
- Created: 2026-11-16
- Completed: 2026-11-16
- Model: DeepSeek V4.1 Flash 1017

## 目的

会議詳細の右側にある要約ペインは幅が 280px に固定されており、長い要約や表を含む Markdown を読むときに窮屈である。
一方で、文字起こしを広く読みたいときは要約ペインを狭くしたい。
左右のペインの境界をドラッグして幅を変えられるようにし、選んだ幅を次回起動時にも使う。

## 優先度根拠

機能追加ではないが、要約の閲覧性と文字起こしの編集のしやすさに直接効く。
会議詳細の主要な画面であり、長い要約を扱う利用者ほど効果が大きい。

## 現状

- `src/renderer/src/styles.css` の `.detail-body` は `grid-template-columns: minmax(0, 1fr) 280px` で、要約ペインの幅が固定されている。
- 画面幅が狭いときは 1 カラムに切り替わり、要約ペインが下に表示される。
- 幅を保存する仕組みはない。

## 設計方針

- 文字起こし側のペインと要約ペインの間に、幅 6px のドラッグ用の境界を置く。
- `.detail-body` の CSS 変数 `--summary-pane-width` で要約ペインの幅を指定する。
- ドラッグ中は `pointermove` と `pointerup` を window に登録し、ポインタが境界の外に出ても追従する。
- 幅は 240px 以上、左のペインに 420px 以上を残す範囲に制限する。
- 選んだ幅は `localStorage` の `kataribe.summaryPaneWidth` に保存し、次回起動時に復元する。
- 境界をダブルクリックすると既定の 280px に戻す。
- 境界にフォーカスした状態で左右の矢印キーを押すと 16px ずつ変更する。Home キーで既定値に戻す。
- 画面幅が狭いときは境界を非表示にし、既存の 1 カラム表示を維持する。
- 幅の計算、保存値の読み込み、範囲の制限は純粋な関数に分け、テストする。

## 完了条件

- [x] 会議詳細の左右のペインの境界をドラッグして要約ペインの幅を変更できる。
- [x] 幅が 240px 未満にならず、左のペインに 420px 以上が残る。
- [x] 変更した幅が再起動後も復元される。
- [x] 境界をダブルクリックすると 280px に戻る。
- [x] キーボードの左右の矢印キーと Home キーで幅を変更できる。
- [x] 画面幅が狭いときは 1 カラム表示のままで、境界が表示されない。
- [x] 幅の計算と保存値の読み込みのテストを追加する。
- [x] `npm run typecheck`、`npm test`、`npm run build` が通る。
- [x] README、CHANGES.md、PRD を更新する。

## 解決方法

- `src/renderer/src/summary-pane-width.ts` を追加し、幅の制限、`localStorage` の読み書き、既定値、最小幅、最大幅、矢印キーの刻み幅を定義する。
- `MeetingDetail` に `detailBodyRef`、要約ペインの幅の state、ドラッグ、キーボード、ダブルクリック、ウィンドウリサイズの処理を追加する。
- `.detail-body` のグリッドを `minmax(0, 1fr) 6px var(--summary-pane-width, 280px)` に変更し、境界に `.detail-resizer` を置く。
- ドラッグ中は `pointermove`、`pointerup`、`pointercancel`、`blur` を window に登録し、終了時に保存する。
- 画面幅が狭いときは既存の 1 カラム表示を維持し、境界を非表示にする。
- `MeetingDetail.test.tsx` に既定幅と境界の表示のテスト、`summary-pane-width.test.ts` に幅の制限と保存のテストを追加する。
- `npm run typecheck`、`npm test`、`npm run build` が通ることを確認する。
