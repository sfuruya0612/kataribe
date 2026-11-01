/**
 * 要約の再生成時に表示する警告の表示条件と言語を検証する。
 * 対応する要求: REQ-SUMMARY-001
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SummaryDocument, UiLanguage } from '../../shared/types';
import { I18nProvider } from './i18n';
import { SummaryRegenerationWarning } from './SummaryRegenerationWarning';

const SUMMARY: SummaryDocument = {
  markdown: [
    '---',
    'title: 週次定例',
    'language: ja',
    '---',
    '',
    '## 要約',
    '本文です。',
    '## ToDo',
    '- [ ] 資料をまとめる',
    '## 未決事項',
    '',
  ].join('\n'),
  body: '## 要約\n本文です。\n## ToDo\n- [ ] 資料をまとめる\n## 未決事項\n',
  language: 'ja',
  provider: 'claude',
  model: 'claude-sonnet-5-5',
  generatedAt: '2026-10-29T15:05:12+09:00',
  updatedAt: '2026-10-29T15:05:12+09:00',
};

function renderWarning(
  locale: UiLanguage,
  summary: SummaryDocument | null,
): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(SummaryRegenerationWarning, { summary }),
    }),
  );
}

describe('req_summary_001_regeneration_warning', () => {
  it('shows the Japanese overwrite and todo warnings when a summary exists', () => {
    const html = renderWarning('ja', SUMMARY);

    expect(html).toContain('既存の要約を上書きします');
    expect(html).toContain('ToDo の完了状態は引き継ぎません。');
    expect(html).toContain('直前の要約は summary.previous.md に退避します。');
  });

  it('shows the English warnings when the UI language is English', () => {
    const html = renderWarning('en', SUMMARY);

    expect(html).toContain('This replaces the existing summary');
    expect(html).toContain('ToDo completion states are not carried over.');
    expect(html).toContain('summary.previous.md');
    expect(html).not.toContain('上書き');
  });

  it('renders nothing when there is no existing summary', () => {
    expect(renderWarning('ja', null)).toBe('');
    expect(renderWarning('en', null)).toBe('');
  });
});
