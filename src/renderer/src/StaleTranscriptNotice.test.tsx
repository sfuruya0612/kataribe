/**
 * 以前の文字起こしに基づく要約と翻訳の警告を検証する。
 * 対応する要求: REQ-ENHANCE-002
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { StaleTranscriptNotice } from './StaleTranscriptNotice';

function render(summaryStale: boolean, translationStale: boolean): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'ja',
      children: createElement(StaleTranscriptNotice, {
        summaryStale,
        translationStale,
      }),
    }),
  );
}

describe('StaleTranscriptNotice', () => {
  it('shows the warning when the summary or translation is stale', () => {
    expect(render(true, false)).toContain(
      'この要約と翻訳は以前の文字起こしに基づいています。',
    );
    expect(render(false, true)).toContain(
      'この要約と翻訳は以前の文字起こしに基づいています。',
    );
  });

  it('renders nothing when both are current', () => {
    expect(render(false, false)).toBe('');
  });
});
