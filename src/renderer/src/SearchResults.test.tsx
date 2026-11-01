/**
 * 検索結果の種別名と件数の表示言語を検証する。
 * 対応する要求: REQ-UI-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MeetingSearchResult, UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { SearchResults } from './SearchResults';

const result: MeetingSearchResult = {
  query: 'release',
  truncated: false,
  hits: [
    {
      meetingId: 'meeting-1',
      title: 'Weekly sync',
      startedAt: '2026-10-29T05:05:00.000Z',
      kind: 'transcript',
      lineNumber: 3,
      timestamp: '00:00:05',
      text: 'The release is ready.',
    },
  ],
};

function renderResults(locale: UiLanguage): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(SearchResults, {
        query: result.query,
        result,
        loading: false,
        onSelect: () => undefined,
      }),
    }),
  );
}

describe('req_ui_001_search_results_language', () => {
  it('renders the Japanese kind label and count', () => {
    const html = renderResults('ja');

    expect(html).toContain('>検索結果</h1>');
    expect(html).toContain('>文字起こし</span>');
    expect(html).toContain('1 件');
  });

  it('renders the English kind label and count', () => {
    const html = renderResults('en');

    expect(html).toContain('>Search results</h1>');
    expect(html).toContain('>Transcription</span>');
    expect(html).toContain('1 result');
    expect(html).not.toContain('文字起こし');
  });
});
