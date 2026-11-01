import { useState } from 'react';
import type { MeetingTodo } from '../../shared/types';
import { useI18n } from './i18n';
import { formatMeetingDate } from './recording-utils';
import {
  filterTodos,
  groupTodosByMeeting,
  type TodoFilter,
  type TodoGroup,
} from './todo-utils';

type TodoListProps = {
  todos: readonly MeetingTodo[];
  loading: boolean;
  error: string | null;
  processing: boolean;
  onToggle: (todo: MeetingTodo, checked: boolean) => Promise<void>;
  onOpenMeeting: (meetingId: string) => void;
};

const FILTERS: readonly TodoFilter[] = ['open', 'done', 'all'];

function todoKey(todo: MeetingTodo): string {
  return `${todo.meetingId}:${todo.lineNumber}`;
}

function TodoFilters({
  filter,
  onChange,
}: {
  filter: TodoFilter;
  onChange: (filter: TodoFilter) => void;
}) {
  const { t } = useI18n();
  const label = (value: TodoFilter): string => {
    switch (value) {
      case 'open':
        return t('未完了');
      case 'done':
        return t('完了');
      case 'all':
        return t('すべて');
    }
  };
  return (
    <div
      className="todo-filters"
      role="group"
      aria-label={t('ToDo の絞り込み')}
    >
      {FILTERS.map((value) => (
        <button
          type="button"
          className={`button button-secondary ${filter === value ? 'is-active' : ''}`}
          key={value}
          aria-pressed={filter === value}
          onClick={() => onChange(value)}
        >
          {label(value)}
        </button>
      ))}
    </div>
  );
}

function TodoItemRow({
  todo,
  disabled,
  onToggle,
}: {
  todo: MeetingTodo;
  disabled: boolean;
  onToggle: (todo: MeetingTodo, checked: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <li className="todo-item">
      <label className="todo-label">
        <input
          type="checkbox"
          checked={todo.checked}
          disabled={disabled}
          aria-label={
            todo.checked
              ? t('{text} を未完了に戻す', { text: todo.text })
              : t('{text} を完了にする', { text: todo.text })
          }
          onChange={(event) => onToggle(todo, event.target.checked)}
        />
        <span className={todo.checked ? 'todo-text is-done' : 'todo-text'}>
          {todo.text}
        </span>
      </label>
    </li>
  );
}

function TodoGroupView({
  group,
  processing,
  saving,
  onToggle,
  onOpenMeeting,
}: {
  group: TodoGroup;
  processing: boolean;
  saving: ReadonlySet<string>;
  onToggle: (todo: MeetingTodo, checked: boolean) => void;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <article className="todo-group">
      <div className="todo-group-head">
        <button
          type="button"
          className="link-button todo-meeting"
          data-meeting-id={group.meetingId}
          aria-label={t('{title} の会議詳細を開く', {
            title: group.meetingTitle,
          })}
          onClick={() => onOpenMeeting(group.meetingId)}
        >
          {group.meetingTitle}
        </button>
        <span className="muted">
          {formatMeetingDate(group.startedAt, locale)}
        </span>
      </div>
      <ul className="todo-list">
        {group.items.map((todo) => (
          <TodoItemRow
            key={todoKey(todo)}
            todo={todo}
            disabled={processing || saving.has(todoKey(todo))}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </article>
  );
}

/**
 * 全会議の ToDo を会議ごとに表示し、完了状態を切り替える画面。
 */
export function TodoList({
  todos,
  loading,
  error,
  processing,
  onToggle,
  onOpenMeeting,
}: TodoListProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<TodoFilter>('open');
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const groups = groupTodosByMeeting(filterTodos(todos, filter));

  const toggle = (todo: MeetingTodo, checked: boolean) => {
    const key = todoKey(todo);
    setSaving((current) => new Set(current).add(key));
    void onToggle(todo, checked)
      .catch(() => {
        // App が失敗を toast で通知し、一覧を再取得する。
      })
      .finally(() => {
        setSaving((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  };

  return (
    <section className="todo-panel" aria-labelledby="todo-title">
      <div className="todo-toolbar">
        <div>
          <p className="section-label">{t('ToDo')}</p>
          <h1 id="todo-title" className="table-title">
            {t('ToDo 一覧')}
          </h1>
        </div>
        <TodoFilters filter={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <p className="muted">{t('ToDo を読み込んでいます。')}</p>
      ) : null}

      {!loading && error ? (
        <p className="alert alert-error">
          {t('ToDo を読み込めませんでした: {error}', { error })}
        </p>
      ) : null}

      {!loading && !error && todos.length === 0 ? (
        <div className="empty-state">
          <p>{t('ToDo はまだありません。')}</p>
          <p className="muted">
            {t('会議の要約に ToDo を追加すると、ここに表示されます。')}
          </p>
        </div>
      ) : null}

      {!loading && !error && todos.length > 0 && groups.length === 0 ? (
        <p className="muted">{t('該当する ToDo はありません。')}</p>
      ) : null}

      {/* 再取得に失敗しても直前の一覧を消さず、エラーと併せて表示する。 */}
      {groups.map((group) => (
        <TodoGroupView
          key={group.meetingId}
          group={group}
          processing={processing}
          saving={saving}
          onToggle={toggle}
          onOpenMeeting={onOpenMeeting}
        />
      ))}
    </section>
  );
}
