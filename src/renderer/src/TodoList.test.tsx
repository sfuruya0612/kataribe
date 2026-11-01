/**
 * ToDo 一覧の表示言語、既定の絞り込み、会議の情報、空状態とエラーを検証する。
 * 対応する要求: REQ-TODO-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MeetingTodo, UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { TodoList } from './TodoList';

const TODOS: readonly MeetingTodo[] = [
  {
    meetingId: 'meeting-1',
    meetingTitle: '週次定例',
    startedAt: '2026-10-29T14:00:00',
    lineNumber: 3,
    checked: false,
    text: '資料をまとめる',
  },
  {
    meetingId: 'meeting-1',
    meetingTitle: '週次定例',
    startedAt: '2026-10-29T14:00:00',
    lineNumber: 4,
    checked: true,
    text: '公開する',
  },
];

function renderTodoList({
  locale,
  todos = TODOS,
  loading = false,
  error = null,
}: {
  locale: UiLanguage;
  todos?: readonly MeetingTodo[];
  loading?: boolean;
  error?: string | null;
}): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(TodoList, {
        todos,
        loading,
        error,
        processing: false,
        onToggle: async () => undefined,
        onOpenMeeting: () => undefined,
      }),
    }),
  );
}

describe('req_todo_001_todo_list', () => {
  it('renders the Japanese labels, the open items, and the meeting information', () => {
    const html = renderTodoList({ locale: 'ja' });

    expect(html).toContain('>ToDo 一覧</h1>');
    expect(html).toContain('>未完了</button>');
    expect(html).toContain('>完了</button>');
    expect(html).toContain('>すべて</button>');
    expect(html).toContain('週次定例');
    expect(html).toContain('10-29 14:00');
    expect(html).toContain('資料をまとめる');
    expect(html).toContain('data-meeting-id="meeting-1"');
    expect(html).toContain('週次定例 の会議詳細を開く');
  });

  it('shows only open items with the default filter', () => {
    const html = renderTodoList({ locale: 'ja' });

    expect(html).toContain('資料をまとめる');
    expect(html).not.toContain('公開する');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('renders the English labels without translating the todo text', () => {
    const html = renderTodoList({ locale: 'en' });

    expect(html).toContain('>ToDo list</h1>');
    expect(html).toContain('>Open</button>');
    expect(html).toContain('>Done</button>');
    expect(html).toContain('>All</button>');
    expect(html).toContain('資料をまとめる');
    expect(html).not.toContain('未完了');
  });

  it('shows the empty state when there are no todos', () => {
    const html = renderTodoList({ locale: 'ja', todos: [] });

    expect(html).toContain('ToDo はまだありません。');
    expect(html).not.toContain('該当する ToDo はありません。');
  });

  it('shows a distinct message when the filter matches no todos', () => {
    const html = renderTodoList({ locale: 'ja', todos: [TODOS[1]] });

    expect(html).toContain('該当する ToDo はありません。');
    expect(html).not.toContain('ToDo はまだありません。');
  });

  it('shows loading and error messages separately', () => {
    const loading = renderTodoList({ locale: 'ja', loading: true });
    const failed = renderTodoList({
      locale: 'ja',
      todos: [],
      error: 'disk error',
    });

    expect(loading).toContain('ToDo を読み込んでいます。');
    expect(loading).not.toContain('ToDo はまだありません。');
    expect(failed).toContain('ToDo を読み込めませんでした: disk error');
    expect(failed).not.toContain('ToDo はまだありません。');
  });
});
