import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MeetingTitleGeneration,
  UiLanguage,
} from '../../shared/types';
import { I18nProvider } from './i18n';
import { TitleGenerationNotice } from './TitleGenerationNotice';

const failed: MeetingTitleGeneration = {
  state: 'failed',
  provider: 'fireworks',
  model: 'deepseek',
  generatedAt: '2026-11-05T05:16:29.482Z',
  error: 'LLM request timed out',
};

function render(
  locale: UiLanguage,
  titleGeneration: MeetingTitleGeneration | null,
  canRetry = true,
  busy = false,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(TitleGenerationNotice, {
        titleGeneration,
        canRetry,
        busy,
        onRetry: () => undefined,
      }),
    }),
  );
}

describe('title generation notice', () => {
  it('shows the failure reason and the retry action', () => {
    const html = render('ja', failed);
    expect(html).toContain('タイトルを自動生成できませんでした');
    expect(html).toContain('LLM request timed out');
    expect(html).toContain('タイトル生成を再試行');
  });

  it('shows a busy label while retrying', () => {
    const html = render('ja', failed, true, true);
    expect(html).toContain('生成中...');
    expect(html).toContain('disabled');
  });

  it('hides the notice when generation succeeded or has not run', () => {
    expect(render('ja', null)).toBe('');
    expect(
      render('ja', { ...failed, state: 'completed', error: null }),
    ).toBe('');
  });

  it('renders the notice in English', () => {
    const html = render('en', failed);
    expect(html).toContain('Could not generate the title automatically.');
    expect(html).toContain('Retry title generation');
  });
});
