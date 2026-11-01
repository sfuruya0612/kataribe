import { join } from 'node:path';
import { parseTodoItems, setTodoChecked } from '../shared/markdown';
import type { MeetingTodo } from '../shared/types';
import { t } from './i18n';
import type { MeetingStore } from './meetings';
import { writePrivateText } from './private-file';

const writeQueues = new Map<string, Promise<void>>();

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

async function applyMeetingTodoChecked(
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

/**
 * 一覧が持つ行番号と本文が要約のチェックボックスと一致するときだけ、完了状態を保存する。
 *
 * 同じ会議への書き込みは read-modify-write の間だけ直列化し、別の会議の書き込みは
 * 待たせない。失敗した操作があっても後続の操作は実行する。
 */
export function setMeetingTodoChecked(
  store: MeetingStore,
  meetingId: string,
  lineNumber: number,
  expectedText: string,
  checked: boolean,
): Promise<void> {
  const previous = writeQueues.get(meetingId) ?? Promise.resolve();
  const run = () =>
    applyMeetingTodoChecked(
      store,
      meetingId,
      lineNumber,
      expectedText,
      checked,
    );
  const operation = previous.then(run, run);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(meetingId, tail);
  void tail.then(() => {
    if (writeQueues.get(meetingId) === tail) {
      writeQueues.delete(meetingId);
    }
  });
  return operation;
}
