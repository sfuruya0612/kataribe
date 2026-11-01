/**
 * 要約の再生成時に表示する警告の表示条件と言語を検証する。
 * 対応する要求: REQ-SUMMARY-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { SummaryRegenerationWarning } from './SummaryRegenerationWarning';

function renderWarning(locale: UiLanguage, visible: boolean): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(SummaryRegenerationWarning, { visible }),
    }),
  );
}

describe('req_summary_001_regeneration_warning', () => {
  it('shows the Japanese overwrite and todo warnings when a summary exists', () => {
    const html = renderWarning('ja', true);

    expect(html).toContain('既存の要約を上書きします');
    expect(html).toContain('ToDo の完了状態は引き継ぎません。');
    expect(html).toContain('直前の要約は summary.previous.md に退避します。');
  });

  it('shows the English warnings when the UI language is English', () => {
    const html = renderWarning('en', true);

    expect(html).toContain('This replaces the existing summary');
    expect(html).toContain('ToDo completion states are not carried over.');
    expect(html).toContain('summary.previous.md');
    expect(html).not.toContain('上書き');
  });

  it('renders nothing when there is no existing summary', () => {
    expect(renderWarning('ja', false)).toBe('');
    expect(renderWarning('en', false)).toBe('');
  });
});
