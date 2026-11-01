/**
 * ToDo の絞り込みと会議ごとのグルーピングを検証する。
 * 対応する要求: REQ-TODO-001
 */
import { describe, expect, it } from 'vitest';
import type { MeetingTodo } from '../../shared/types';
import { filterTodos, groupTodosByMeeting } from './todo-utils';

const TODOS: readonly MeetingTodo[] = [
  {
    meetingId: 'meeting-b',
    meetingTitle: '定例B',
    startedAt: '2026-10-29T06:00:00',
    lineNumber: 3,
    checked: false,
    text: 'B の資料',
  },
  {
    meetingId: 'meeting-a',
    meetingTitle: '定例A',
    startedAt: '2026-10-29T05:00:00',
    lineNumber: 3,
    checked: true,
    text: 'A の公開',
  },
  {
    meetingId: 'meeting-a',
    meetingTitle: '定例A',
    startedAt: '2026-10-29T05:00:00',
    lineNumber: 4,
    checked: false,
    text: 'A の確認',
  },
];

function snapshot(todos: readonly MeetingTodo[]): MeetingTodo[] {
  return todos.map((todo) => ({ ...todo }));
}

describe('req_todo_001_filter_todos', () => {
  it('filters open, done, and all items', () => {
    expect(filterTodos(TODOS, 'open').map((todo) => todo.text)).toEqual([
      'B の資料',
      'A の確認',
    ]);
    expect(filterTodos(TODOS, 'done').map((todo) => todo.text)).toEqual([
      'A の公開',
    ]);
    expect(filterTodos(TODOS, 'all')).toEqual(TODOS);
  });

  it('returns a new array and does not modify the input', () => {
    const before = snapshot(TODOS);
    const all = filterTodos(TODOS, 'all');

    expect(all).not.toBe(TODOS);
    expect(TODOS).toEqual(before);
  });

  it('returns an empty list for an empty input', () => {
    expect(filterTodos([], 'open')).toEqual([]);
    expect(filterTodos([], 'done')).toEqual([]);
    expect(filterTodos([], 'all')).toEqual([]);
  });
});

describe('req_todo_001_group_todos_by_meeting', () => {
  it('groups items by meeting in first appearance order and keeps item order', () => {
    expect(groupTodosByMeeting(TODOS)).toEqual([
      {
        meetingId: 'meeting-b',
        meetingTitle: '定例B',
        startedAt: '2026-10-29T06:00:00',
        items: [TODOS[0]],
      },
      {
        meetingId: 'meeting-a',
        meetingTitle: '定例A',
        startedAt: '2026-10-29T05:00:00',
        items: [TODOS[1], TODOS[2]],
      },
    ]);
  });

  it('does not modify the input array or its items', () => {
    const before = snapshot(TODOS);
    groupTodosByMeeting(TODOS);

    expect(TODOS).toEqual(before);
  });

  it('returns an empty list when there are no todos', () => {
    expect(groupTodosByMeeting([])).toEqual([]);
  });
});
