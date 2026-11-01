/**
 * 起動時の初回描画が保存された UI 言語で行われることを検証する。
 * 対応する要求: REQ-UI-001、REQ-TODO-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiLanguage } from '../../shared/types';
import App from './App';
import { I18nProvider } from './i18n';

function renderApp(locale: UiLanguage): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(App, { initialUiLanguage: locale }),
    }),
  );
}

describe('req_ui_001_app_initial_language', () => {
  it('renders the initial view in English', () => {
    const html = renderApp('en');

    expect(html).toContain('>Start recording</button>');
    expect(html).toContain('All meetings');
    expect(html).not.toContain('録音を開始');
  });

  it('renders the initial view in Japanese', () => {
    const html = renderApp('ja');

    expect(html).toContain('>録音を開始</button>');
    expect(html).toContain('会議一覧');
    expect(html).not.toContain('Start recording');
  });

  it('req_todo_001_renders the sidebar todo entry in both languages', () => {
    const japanese = renderApp('ja');
    const english = renderApp('en');

    expect(japanese).toContain('data-testid="nav-todos"');
    expect(japanese).toContain('ToDo 一覧');
    expect(english).toContain('data-testid="nav-todos"');
    expect(english).toContain('ToDo list');
  });
});
