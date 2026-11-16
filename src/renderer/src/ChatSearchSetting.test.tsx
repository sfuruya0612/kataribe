/**
 * 会議チャットの Web 検索の既定値と説明を検証する。
 * 対応する要求: REQ-CHAT-002
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings';
import type { AppSettings, UiLanguage } from '../../shared/types';
import { ChatSearchSetting } from './ChatSearchSetting';
import { I18nProvider } from './i18n';

function render(
  locale: UiLanguage,
  chatWebSearchDefault: boolean,
): string {
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    chatWebSearchDefault,
  };
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(ChatSearchSetting, {
        settings,
        onUpdateSettings: async () => undefined,
      }),
    }),
  );
}

describe('req_chat_002_web_search_setting', () => {
  it('shows the default-off web search setting and privacy note', () => {
    const html = render('ja', false);
    expect(html).toContain('会議チャットで Web 検索を既定で使う');
    expect(html).toContain(
      '検索語は Brave Search または DuckDuckGo に送信されます。',
    );
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/u);
  });

  it('shows the checked state when enabled', () => {
    const html = render('ja', true);
    expect(html).toMatch(/type="checkbox"[^>]*checked/u);
  });

  it('renders the English labels', () => {
    const html = render('en', false);
    expect(html).toContain(
      'Use web search by default in meeting chat',
    );
    expect(html).toContain(
      'Search queries are sent to Brave Search or DuckDuckGo.',
    );
    expect(html).not.toContain('会議チャットで Web 検索を既定で使う');
  });
});
