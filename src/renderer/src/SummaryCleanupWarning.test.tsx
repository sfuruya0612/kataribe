import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { SummaryCleanupWarning } from './SummaryCleanupWarning';

/**
 * 対応する要求: REQ-SUMMARY-002
 */

function render(locale: UiLanguage, enabled: boolean): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(SummaryCleanupWarning, { enabled }),
    }),
  );
}

describe('req_summary_002_cleanup_warning', () => {
  it('shows the two-request warning when cleanup is enabled', () => {
    const html = render('ja', true);
    expect(html).toContain(
      '相槌と擬音の除去でも文字起こしを送信するため、送信は 2 回になります。',
    );
  });

  it('shows nothing when cleanup is disabled', () => {
    expect(render('ja', false)).toBe('');
  });

  it('renders the warning in English', () => {
    const html = render('en', true);
    expect(html).toContain(
      'Filler and interjection removal also sends the transcript, so the transcript is sent twice.',
    );
  });
});
