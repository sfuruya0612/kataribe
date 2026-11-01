import { join } from 'node:path';
import { parseTodoItems, setTodoChecked } from '../shared/markdown';
import type { MeetingTodo } from '../shared/types';
import { t } from './i18n';
import type { MeetingStore } from './meetings';
import { writePrivateText } from './private-file';

/**
 * 会議一覧の順序で各会議の summary.md を読み、ToDo セクションの項目を集める。
 *
 * 要約がない会議と、ToDo がない会議は含めない。
 */
export async function listMeetingTodos(
  store: MeetingStore,
): Promise<MeetingTodo[]> {
  const meetings = await store.list();
  const todos: MeetingTodo[] = [];
  for (const meeting of meetings) {
    const summary = await store.readSummary(meeting);
    if (!summary) {
      continue;
    }
    for (const item of parseTodoItems(summary.body)) {
      todos.push({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        startedAt: meeting.startedAt,
        lineNumber: item.lineNumber,
        checked: item.checked,
        text: item.text,
      });
    }
  }
  return todos;
}

/**
 * 一覧が持つ行番号と本文が要約のチェックボックスと一致するときだけ、完了状態を保存する。
 *
 * 外部のエディタで行が変わっている場合は書き込まず、一覧の再読み込みを促す。
 */
export async function setMeetingTodoChecked(
  store: MeetingStore,
  meetingId: string,
  lineNumber: number,
  expectedText: string,
  checked: boolean,
): Promise<void> {
  const meeting = await store.find(meetingId);
  if (!meeting) {
    throw new Error(t('会議が見つかりません。'));
  }
  const summary = await store.readSummary(meeting);
  if (!summary) {
    throw new Error(t('要約がありません。'));
  }
  const result = setTodoChecked(
    summary.markdown,
    lineNumber,
    expectedText,
    checked,
  );
  if (!result.ok) {
    throw new Error(
      t('要約の ToDo が変更されました。一覧を再読み込みしてください。'),
    );
  }
  await writePrivateText(join(meeting.meetingDir, 'summary.md'), result.markdown);
}
