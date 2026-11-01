import type { MeetingTodo } from '../../shared/types';

/** ToDo 一覧の絞り込み。 */
export type TodoFilter = 'open' | 'done' | 'all';

/** 会議ごとにまとめた ToDo の項目。 */
export type TodoGroup = {
  meetingId: string;
  meetingTitle: string;
  startedAt: string;
  items: MeetingTodo[];
};

/**
 * 完了状態で ToDo を絞り込む。
 *
 * 入力の配列は変更しない。
 */
export function filterTodos(
  todos: readonly MeetingTodo[],
  filter: TodoFilter,
): MeetingTodo[] {
  switch (filter) {
    case 'open':
      return todos.filter((todo) => !todo.checked);
    case 'done':
      return todos.filter((todo) => todo.checked);
    case 'all':
      return [...todos];
  }
}

/**
 * ToDo を会議ごとにまとめる。
 *
 * 会議の順序は入力での初出順、項目の順序は入力順を保つ。入力の配列は変更しない。
 */
export function groupTodosByMeeting(
  todos: readonly MeetingTodo[],
): TodoGroup[] {
  const groups = new Map<string, TodoGroup>();
  for (const todo of todos) {
    const group = groups.get(todo.meetingId);
    if (group) {
      group.items.push(todo);
      continue;
    }
    groups.set(todo.meetingId, {
      meetingId: todo.meetingId,
      meetingTitle: todo.meetingTitle,
      startedAt: todo.startedAt,
      items: [todo],
    });
  }
  return [...groups.values()];
}
